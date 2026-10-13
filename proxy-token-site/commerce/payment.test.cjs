const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');
const request = require('supertest');
const { PostgresCommerceStore, privateConnectionFile } = require('./store.cjs');

const connectionString = privateConnectionFile(process.env.COMMERCE_TEST_DATABASE_URL_FILE);
const target = new URL(connectionString);
assert.equal(target.hostname, '127.0.0.1'); assert.ok(target.pathname.endsWith('_test'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-payment-'));
const data = path.join(temp, 'data'); fs.mkdirSync(data);
const proxy = path.join(temp, 'registry.json'); fs.writeFileSync(proxy, '{"users":[]}');
Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: data, PROXY_USERS_FILE: proxy,
  COMMERCE_BACKEND: 'postgres', COMMERCE_DATABASE_URL_FILE: process.env.COMMERCE_TEST_DATABASE_URL_FILE,
  PAYMENT_MOCK_ENABLED: 'true', BYPASS_SYNC: 'true', PROXY_REST_URL: 'http://127.0.0.1:1',
  PROXY_RT_URL: 'http://127.0.0.1:1', PROXY_WS_HOST: '127.0.0.1', PROXY_WS_PORT: '1',
  ARCHIVE_WRITER_URL: 'http://127.0.0.1:1', ARCHIVE_READER_URL: 'http://127.0.0.1:1',
  PAYMENT_USD_CAD_RATE: '1.37' });
let server;
const admin = new PostgresCommerceStore({ connectionString });
before(async () => {
  await admin.pool.query('DROP SCHEMA IF EXISTS commerce CASCADE'); await admin.migrate();
  const empty = path.join(temp, 'empty.json'); fs.writeFileSync(empty, '[]'); await admin.importFile(empty);
  server = require('../server.js'); await server.commerceStore.ready();
});
after(async () => { await server?.commerceStore.close(); await admin.close(); fs.rmSync(temp, { recursive: true }); });

async function registration(name) {
  const token = crypto.randomBytes(24).toString('base64url');
  const entry = { id: crypto.randomUUID(), type: 'registration', username: name,
    phone: '6045550199', email: `${name}@example.com`, tier: 'standard', status: 'payment_pending',
    registered_at: new Date().toISOString(), requested_at: new Date().toISOString(),
    checkout_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
    checkout_token_issued_at: new Date().toISOString() };
  const pending = path.join(data, 'pending.json');
  const rows = fs.existsSync(pending) ? JSON.parse(fs.readFileSync(pending)) : [];
  rows.push(entry); fs.writeFileSync(pending, JSON.stringify(rows));
  const result = await request(server.app).post('/api/payment/orders').send({
    checkout_token: token, bundle_id: 'standard-1m', payment_method: 'alipay', amount_cny_fen: 1 });
  assert.equal(result.status, 201); assert.equal(result.body.order.bundle.amount_cny_fen, 10000);
  return result.body;
}

test('Postgres checkout retains access checks and duplicate fulfillment never reissues a token', async () => {
  const checkout = await registration('postgres-checkout');
  const url = `/api/payment/mock/${checkout.order.id}/complete`;
  const first = await request(server.app).post(url).send({ resume_token: checkout.resume_token });
  assert.equal(first.status, 200); assert.equal(first.body.order.status, 'COMPLETED');
  const before = fs.readFileSync(proxy, 'utf8');
  const repeated = await request(server.app).post(url).send({ resume_token: checkout.resume_token });
  assert.equal(repeated.status, 200); assert.equal(repeated.body.issued_token, first.body.issued_token);
  assert.equal(fs.readFileSync(proxy, 'utf8'), before);
  assert.equal((await request(server.app).get(`/api/payment/orders/${checkout.order.id}`)).status, 404);
  assert.equal(fs.existsSync(path.join(data, 'payment-orders.json')), false);
  const login = await request(server.app).post('/api/admin/login').send({ password: 'admin123' });
  assert.equal(login.status, 200);
  const overview = await request(server.app).get('/api/admin/payments/overview').set('X-Admin-Token', login.body.token);
  assert.equal(overview.status, 200);
});

test('process restart resumes a paid order after an interrupted registry projection', async () => {
  const checkout = await registration('postgres-recovery');
  const actual = await server.commerceStore.get(checkout.order.id);
  await server.commerceStore.update(actual.id, current => ({ ...current,
    status: 'PAID', payment_status: 'PAID', provider_payment_id: 'fixture-restart-receipt' }));
  // Simulate a crash after registry publication but before local account/order completion.
  const raw = JSON.parse(fs.readFileSync(proxy));
  raw.users.push({ user_id: 'postgres-recovery', token: 'preserved-recovery-token', role: 'standard',
    permissions: ['market'], expires_at: '2027-01-01T00:00:00Z', fulfilled_payment_orders: [actual.id] });
  fs.writeFileSync(proxy, JSON.stringify(raw));
  await server.commerceStore.pool.query(`UPDATE commerce.fulfillment_jobs SET state='running',
    lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE order_id=$1`, [actual.id]);
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    let completed = false;
    for (let i = 0; i < 60; i++) {
      if ((await server.commerceStore.get(actual.id)).status === 'COMPLETED') { completed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(completed, true, 'Restarted owner must finish the durable job');
    const user = JSON.parse(fs.readFileSync(proxy)).users.find(row => row.user_id === 'postgres-recovery');
    assert.equal(user.token, 'preserved-recovery-token'); assert.equal(user.expires_at, '2027-01-01T00:00:00Z');
    assert.deepEqual(user.fulfilled_payment_orders, [actual.id]);
    assert.ok(JSON.parse(fs.readFileSync(path.join(data, 'users.json'))).some(row => row.username === 'postgres-recovery'));
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited;
  }
});


test('missed Stripe and Z-Pay callbacks are recovered only after matching provider queries', async () => {
  const originalFetch = global.fetch;
  const stripe = await registration('stripe-query');
  const zpay = await registration('zpay-query');
  // Create provider-bound fixtures through the store rather than rewriting immutable snapshots.
  const stripeSource = await server.commerceStore.get(stripe.order.id);
  const zpaySource = await server.commerceStore.get(zpay.order.id);
  await server.commerceStore.create({ ...stripeSource, id: 'pay_stripe-query-bound', provider: 'stripe_checkout',
    stripe_checkout_session_id: 'cs_test_query', provider_charge: { amount_minor: 2500, currency: 'USD' } });
  await server.commerceStore.create({ ...zpaySource, id: 'pay_zpay-query-bound', provider: 'zpay',
    zpay_out_trade_no: 'pay_zpay-query-bound', zpay_subject: 'Leandata Standard 1M' });
  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    ZPAY_PID: 'fixture-merchant', ZPAY_KEY: 'fixture-key' });
  let calls = 0;
  global.fetch = async (url, options) => {
    assert.ok(!options.method || options.method === 'GET'); calls++;
    if (String(url).startsWith('https://api.stripe.com/')) {
      return { ok: true, json: async () => ({ id: 'cs_test_query', payment_status: 'paid',
        payment_intent: 'pi_fixture_query', amount_total: 2500, currency: 'usd',
        metadata: { order_id: 'pay_stripe-query-bound', bundle_id: 'standard-1m' } }) };
    }
    assert.equal(new URL(url).origin, 'https://zpayz.cn');
    return { ok: true, json: async () => ({ code: 1, status: 1, pid: 'fixture-merchant',
      type: 'alipay', out_trade_no: 'pay_zpay-query-bound', trade_no: 'fixture-zpay-query',
      name: 'Leandata Standard 1M', money: '100.00' }) };
  };
  try {
    await server.reconcilePayment('pay_stripe-query-bound');
    await server.reconcilePayment('pay_zpay-query-bound');
    assert.equal((await server.commerceStore.get('pay_stripe-query-bound')).status, 'COMPLETED');
    assert.equal((await server.commerceStore.get('pay_zpay-query-bound')).status, 'COMPLETED');
    await server.reconcilePayment('pay_zpay-query-bound'); assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','ZPAY_PID','ZPAY_KEY']) delete process.env[key];
  }
});
