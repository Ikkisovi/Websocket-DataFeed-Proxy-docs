const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');
const request = require('supertest');
const { PostgresPortalStore } = require('./portal-store.cjs');
const { PostgresCommerceStore, privateConnectionFile } = require('./store.cjs');

const ownerUrl = privateConnectionFile(process.env.PORTAL_TEST_DATABASE_URL_FILE);
const target = new URL(ownerUrl);
assert.equal(target.hostname, '127.0.0.1'); assert.ok(target.pathname.endsWith('_test'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-api-'));
const data = path.join(temp, 'data'); fs.mkdirSync(data);
const registryFile = path.join(temp, 'registry.json');
const role = 'portal_fixture_'+process.pid;
const owner = new PostgresCommerceStore({ connectionString: ownerUrl });
const importer = new PostgresPortalStore({ pool: owner.pool });
let server;
let cookie;
let adminToken;
const fixture = {
  accounts: [{ username: 'portal-fixture', phone: '0000000000', tier: 'free', role: 'free' }],
  pending: [], bulk_orders: [],
  registry: { users: [{ user_id: 'portal-fixture', token: 'fixture-existing-token', role: 'free', permissions: { rest: { stocks_history: true } } }] },
};
before(async () => {
  await owner.pool.query('DROP SCHEMA IF EXISTS commerce CASCADE'); await owner.migrate();
  const empty = path.join(temp, 'orders.json'); fs.writeFileSync(empty, '[]'); await owner.importFile(empty);
  await owner.pool.query('DROP SCHEMA IF EXISTS portal CASCADE'); await importer.migrate();
  const snapshot = path.join(temp, 'snapshot.json'); fs.writeFileSync(snapshot, JSON.stringify(fixture)); await importer.importFile(snapshot);
  const password = crypto.randomBytes(32).toString('hex');
  const sql = await owner.pool.query("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text,$2::text) AS sql", [role,password]);
  await owner.pool.query(sql.rows[0].sql);
  await owner.pool.query(`GRANT USAGE ON SCHEMA commerce,portal TO ${role};
    GRANT SELECT ON commerce.migrations,commerce.import_receipts,portal.migrations,portal.import_receipts TO ${role};
    GRANT SELECT,INSERT,UPDATE ON commerce.orders,commerce.payments,commerce.fulfillment_jobs TO ${role};
    GRANT SELECT,INSERT ON commerce.order_events,portal.events TO ${role};
    GRANT SELECT,INSERT,UPDATE,DELETE ON portal.accounts,portal.principals,portal.registrations,portal.bulk_orders,portal.sessions TO ${role};
    GRANT SELECT,UPDATE ON portal.documents TO ${role};
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA commerce,portal TO ${role}`);
  const runtime = new URL(ownerUrl); runtime.username=role; runtime.password=password;
  const runtimeFile = path.join(temp, 'runtime-url'); fs.writeFileSync(runtimeFile,runtime.href,{mode:0o600});
  for (const [name,value] of Object.entries(fixture)) fs.writeFileSync(name==='registry'?registryFile:path.join(data,name==='accounts'?'users.json':name==='bulk_orders'?'bulk-orders.json':'pending.json'),JSON.stringify(value));
  Object.assign(process.env,{ NODE_ENV:'test', DATA_DIR:data, PROXY_USERS_FILE:registryFile,
    COMMERCE_BACKEND:'postgres', PORTAL_BACKEND:'postgres', COMMERCE_DATABASE_URL_FILE:runtimeFile,
    PAYMENT_MOCK_ENABLED:'true', USD_CAD_RATE_OVERRIDE:'1.37', EMAIL_TEST_MODE:'memory', EMAIL_VERIFY_SECRET:'fixture-email-secret',
    BYPASS_SYNC:'true', PROXY_REST_URL:'http://127.0.0.1:1', PROXY_WS_HOST:'127.0.0.1',PROXY_WS_PORT:'1',
    ARCHIVE_READER_URL:'http://127.0.0.1:1',ARCHIVE_WRITER_URL:'http://127.0.0.1:1',PROXY_RT_URL:'http://127.0.0.1:1', PORTAL_BIND_HOST:'127.0.0.1' });
  server=require('../server.js'); await server.commerceStore.ready(); await server.portalStore.ready();
  const admin=await request(server.app).post('/api/admin/login').send({password:'admin123'});assert.equal(admin.status,200);adminToken=admin.body.token;
});
after(async () => {
  await server?.portalStore.close();await server?.commerceStore.close();
  await owner.pool.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);await importer.close();await owner.close();
  fs.rmSync(temp,{recursive:true});
});

test('canonical database login works despite stale compatibility files and repairs projections', async () => {
  fs.writeFileSync(path.join(data,'users.json'),'[]');fs.writeFileSync(registryFile,'{"users":[]}');
  const login=await request(server.app).post('/api/account/login').send({credential:{username:'portal-fixture',phone:'0000000000',token:'fixture-existing-token'}});
  assert.equal(login.status,200);cookie=login.headers['set-cookie'][0].split(';')[0];
  const overview=await request(server.app).get('/api/account/overview').set('Cookie',cookie);assert.equal(overview.status,200);assert.equal(overview.body.account.expiry,null);
  await server.portalStore.flush({verifyAll:true});assert.deepEqual(JSON.parse(fs.readFileSync(registryFile)),fixture.registry);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data,'users.json'))),fixture.accounts);
});

test('runtime role cannot forge imports, change schema or rewrite audit history', async () => {
  for (const sql of ["INSERT INTO portal.import_receipts(source_sha256,counts) VALUES('forged','{}')",
    'DELETE FROM portal.events','ALTER TABLE portal.accounts ADD COLUMN forged text','DELETE FROM commerce.orders']) {
    await assert.rejects(server.commerceStore.pool.query(sql), error=>error.code==='42501');
  }
});

async function checkout(bundle='premium-1m') {
  const result=await request(server.app).post('/api/payment/orders').set('Cookie',cookie).send({bundle_id:bundle,payment_method:'stripe_card',stripe_currency:'usd'});
  assert.equal(result.status,201);return result.body;
}
test('payment and entitlement commit together and duplicate completion retains original token and expiry', async () => {
  const order=await checkout();const url='/api/payment/mock/'+order.order.id+'/complete';
  const first=await request(server.app).post(url).send({resume_token:order.resume_token});assert.equal(first.status,200);
  const before=await server.portalStore.read('registry');assert.equal(before.users[0].token,'fixture-existing-token');
  assert.equal(before.users[0].role,'premium');
  assert.deepEqual((await server.portalStore.read('accounts'))[0].fulfilled_payment_orders,[order.order.id]);
  const repeated=await request(server.app).post(url).send({resume_token:order.resume_token});assert.equal(repeated.status,200);
  assert.deepEqual(await server.portalStore.read('registry'),before);
});

test('a lost projection after payment is recovered without a second expiry extension', async () => {
  const order=await checkout('standard-1m');const url='/api/payment/mock/'+order.order.id+'/complete';
  const project=server.portalStore.project;server.portalStore.project=async()=>{throw new Error('fixture write failure')};
  const response=await request(server.app).post(url).send({resume_token:order.resume_token});assert.equal(response.status,503);
  assert.equal((await server.commerceStore.get(order.order.id)).status,'COMPLETED');
  const before=await server.portalStore.read('registry');server.portalStore.project=project;await server.portalStore.flush();
  const repeated=await request(server.app).post(url).send({resume_token:order.resume_token});assert.equal(repeated.status,200);
  assert.deepEqual(await server.portalStore.read('registry'),before);assert.deepEqual(JSON.parse(fs.readFileSync(registryFile)),before);
  assert.equal((await server.commerceStore.dueJobs()).length,0);
});

test('admin failure rolls back both account and principal before returning a failed response', async () => {
  const before=await importer.snapshot();const write=server.portalStore.write.bind(server.portalStore);
  server.portalStore.write=async(name,value)=>{if(name==='accounts')throw new Error('fixture account failure');return write(name,value)};
  const response=await request(server.app).post('/api/admin/users/set-role').set('X-Admin-Token',adminToken).send({user_id:'portal-fixture',role:'china'});
  assert.equal(response.status,500);server.portalStore.write=write;assert.deepEqual(await importer.snapshot(),before);
});

test('registration stores a permanent Free account and never exposes a token before publication', async () => {
  const email='registration-fixture@example.invalid';const requested=await request(server.app).post('/api/register/request-code').send({email});assert.equal(requested.status,202);
  const response=await request(server.app).post('/api/register').send({username:'new-fixture',phone:'0000000001',email,tier:'free',
    verification_id:requested.body.challenge_id,verification_code:server.getLastTestVerificationEmail().code});
  assert.equal(response.status,201);assert.ok(response.body.token);
  const principal=(await server.portalStore.read('registry')).users.find(x=>x.user_id==='new-fixture');assert.equal(principal.token,response.body.token);assert.equal(principal.expires_at,undefined);
  assert.ok(JSON.parse(fs.readFileSync(registryFile)).users.some(x=>x.token===response.body.token));
});

test('database failure rejects login instead of using the compatibility registry', async () => {
  server.portalStore.failed=true;
  const denied=await request(server.app).post('/api/account/login').send({credential:{username:'portal-fixture',phone:'0000000000',token:'fixture-existing-token'}});
  assert.equal(denied.status,503);server.portalStore.failed=false;
});

test('China checkout preserves the market clock and each expired grant falls back independently', async () => {
  const original=(await server.portalStore.read('registry')).users[0];
  const order=await checkout('china-1m');const url='/api/payment/mock/'+order.order.id+'/complete';
  const completed=await request(server.app).post(url).send({resume_token:order.resume_token});assert.equal(completed.status,200);
  const combined=(await server.portalStore.read('registry')).users[0];
  assert.equal(combined.token,original.token);
  assert.deepEqual(combined.subscriptions.market,original.subscriptions.market);
  assert.equal(combined.subscriptions.china.tier,'china');
  assert.equal(completed.body.order.account.capabilities.rest.cn_archive,true);
  const repeated=await request(server.app).post(url).send({resume_token:order.resume_token});assert.equal(repeated.status,200);
  assert.deepEqual((await server.portalStore.read('registry')).users[0],combined);
  await server.portalStore.mutate(async()=>{
    const registry=await server.portalStore.read('registry');
    registry.users[0].subscriptions.market.expires_at='2020-01-01T00:00:00.000Z';
    registry.users[0].expires_at='2020-01-01T00:00:00.000Z';
    await server.portalStore.write('registry',registry);
  });
  const overview=await request(server.app).get('/api/account/overview').set('Cookie',cookie);
  assert.equal(overview.status,200);assert.equal(overview.body.account.market_expiry,null);
  assert.ok(overview.body.account.china_expiry);assert.equal(overview.body.account.capabilities.rest.cn_archive,true);
  assert.equal(overview.body.account.capabilities.rest.financial,false);assert.equal(overview.body.account.capabilities.ws.stocks,true);
  const spectral=await request(server.app).post('/api/research-data/checkout').set('Cookie',cookie).send({product_id:'spectral-tick-flow'});
  assert.equal(spectral.status,200);
  // A public catalog and retired plan rejection must not create an order or principal.
  const beforeOrders=await server.commerceStore.list();
  const catalog=await request(server.app).get('/api/product-catalog');assert.equal(catalog.status,200);
  assert.equal(catalog.body.tiers.trial,undefined);assert.equal(catalog.body.tiers.test,undefined);
  const retired=await request(server.app).post('/api/account/renew').set('Cookie',cookie).send({tier:'trial',months:1});assert.equal(retired.status,410);
  assert.deepEqual(await server.commerceStore.list(),beforeOrders);
});

test('restart retains hashed sessions, restores generated files and keeps paid entitlement exactly', async () => {
  await server.downgradeExpiredToFree();
  const before=await importer.snapshot();await server.portalStore.close();await server.commerceStore.close();
  fs.writeFileSync(registryFile,'{"users":[]}');
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const child=spawn(process.execPath,['--max-old-space-size=128','server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port)},stdio:'ignore'});
  try {
    let healthy=false;
    for(let i=0;i<60;i++){
      try{const res=await fetch('http://127.0.0.1:'+port+'/api/account/session',{headers:{Cookie:cookie}});if(res.status===200){healthy=true;break}}catch{}
      if(child.exitCode!==null)throw new Error('Fixture process exited before admission');
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(healthy,true);assert.deepEqual(await importer.snapshot(),before);assert.deepEqual(JSON.parse(fs.readFileSync(registryFile)),before.registry);
    const sessionRows=await owner.pool.query('SELECT token_sha256 FROM portal.sessions');assert.ok(sessionRows.rows.every(x=>/^[a-f0-9]{64}$/.test(x.token_sha256)));
  } finally {child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
});
