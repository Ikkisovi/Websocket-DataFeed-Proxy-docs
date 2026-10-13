const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PostgresCommerceStore, privateConnectionFile } = require('./store.cjs');

const connectionString = privateConnectionFile(process.env.COMMERCE_TEST_DATABASE_URL_FILE);
const target = new URL(connectionString);
assert.equal(target.hostname, '127.0.0.1');
assert.ok(target.pathname.endsWith('_test'), 'Only a dedicated loopback test database is allowed');
const store = new PostgresCommerceStore({ connectionString });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-store-'));
function order(id, patch = {}) {
  return { id: `pay_${id}`, kind: 'renewal', user_id: 'fixture-user', provider: 'local_mock',
    bundle_id: 'standard-1m', bundle: { amount_cny_fen: 1000, currency: 'CNY' },
    provider_charge: { amount_minor: 1000, currency: 'CNY' },
    payment_method: 'alipay', status: 'PENDING', payment_status: 'UNPAID',
    created_at: '2026-10-13T00:00:00Z', resume_token_hash: 'fixture-hash', ...patch };
}
before(async () => {
  await store.pool.query('DROP SCHEMA IF EXISTS commerce CASCADE');
  await store.migrate();
});
after(async () => { await store.close(); fs.rmSync(temp, { recursive: true }); });

test('import preserves every field and accepts only an identical replay', async () => {
  const source = [order('import', { provider_charge: { amount_minor: 1499, currency: 'CAD' },
    checkout_locale: 'en', extension: { preserve: [null, 1, 'raw'] },
    status: 'COMPLETED', payment_status: 'PAID', provider_payment_id: 'receipt-import' })];
  const file = path.join(temp, 'orders.json'); fs.writeFileSync(file, JSON.stringify(source));
  assert.deepEqual(await store.importFile(file), { source_sha256: require('crypto').createHash('sha256')
    .update(fs.readFileSync(file)).digest('hex'), orders: 1, exact_readback: true });
  await store.importFile(file); await store.ready();
  assert.deepEqual(await store.list(), source);
  const job = await store.pool.query('SELECT state FROM commerce.fulfillment_jobs WHERE order_id=$1', ['pay_import']);
  assert.equal(job.rows[0].state, 'done');
  source[0].extension.preserve.push('changed'); fs.writeFileSync(file, JSON.stringify(source));
  await assert.rejects(store.importFile(file), /empty database or an identical/);
  assert.equal((await store.get('pay_import')).extension.preserve.length, 3);
});

test('paid transition atomically creates payment, event and recovery job', async () => {
  await store.create(order('atomic'));
  await store.update('pay_atomic', current => ({ ...current, payment_status: 'PAID',
    status: 'PAID', provider_payment_id: 'receipt-atomic' }));
  const result = await store.pool.query(`SELECT p.state AS payment,j.state AS job,
    (SELECT count(*)::int FROM commerce.order_events e WHERE e.order_id=p.order_id) AS events
    FROM commerce.payments p JOIN commerce.fulfillment_jobs j USING(order_id) WHERE p.order_id='pay_atomic'`);
  assert.deepEqual(result.rows[0], { payment: 'PAID', job: 'queued', events: 2 });
});

test('duplicate provider receipt rolls back the entire second transaction', async () => {
  await store.create(order('duplicate'));
  await assert.rejects(store.update('pay_duplicate', current => ({ ...current,
    status: 'PAID', payment_status: 'PAID', provider_payment_id: 'receipt-atomic' })), { code: '23505' });
  assert.equal((await store.get('pay_duplicate')).payment_status, 'UNPAID');
  const result = await store.pool.query("SELECT count(*)::int AS count FROM commerce.fulfillment_jobs WHERE order_id='pay_duplicate'");
  assert.equal(result.rows[0].count, 0);
});

test('concurrent updates retain all increments and reject snapshot or paid-state changes', async () => {
  await store.create(order('parallel', { counter: 0 }));
  await Promise.all(Array.from({ length: 25 }, () => store.update('pay_parallel',
    current => ({ ...current, counter: current.counter + 1 }))));
  assert.equal((await store.get('pay_parallel')).counter, 25);
  await assert.rejects(store.update('pay_parallel', current => ({ ...current,
    provider_charge: { amount_minor: 1, currency: 'CAD' } })), /immutable/);
  await assert.rejects(store.update('pay_atomic', current => ({ ...current, payment_status: 'UNPAID' })), /cannot be reversed/);
  await assert.rejects(store.update('pay_import', current => ({ ...current, status: 'PAID' })), /cannot regress/);
});

test('lease excludes concurrent projection and crashed jobs resume after expiry', async () => {
  const peer = new PostgresCommerceStore({ connectionString });
  try {
    await store.withFulfillment('pay_atomic', async () => {
      await assert.rejects(peer.withFulfillment('pay_atomic', async () => {}), { code: 'COMMERCE_BUSY' });
      throw Object.assign(new Error('fixture interruption'), { code: 'TEST_INTERRUPTION' });
    }).catch(error => assert.equal(error.code, 'TEST_INTERRUPTION'));
    await store.pool.query("UPDATE commerce.fulfillment_jobs SET state='running',lease_token=gen_random_uuid(),lease_until=now()-interval '1 second',next_attempt_at=now() WHERE order_id='pay_atomic'");
    assert.ok((await peer.dueJobs()).includes('pay_atomic'));
    await peer.withFulfillment('pay_atomic', async () => {
      await peer.update('pay_atomic', current => ({ ...current, status: 'COMPLETED' }));
    });
    assert.ok(!(await store.dueJobs()).includes('pay_atomic'));
  } finally { await peer.close(); }
});

test('price validation rejects floating minor units and connection files cannot be world readable', async () => {
  await assert.rejects(store.create(order('bad-money', { provider_charge: { amount_minor: 1.5, currency: 'CAD' } })), /price snapshot/);
  const file = path.join(temp, 'connection'); fs.writeFileSync(file, connectionString, { mode: 0o644 });
  assert.throws(() => privateConnectionFile(file), /private/);
});


test('runtime role can transact but cannot change schema, imports, or audit history', async () => {
  const { execFileSync } = require('child_process');
  const password = require('crypto').randomBytes(32).toString('hex');
  const secret = path.join(temp, 'runtime-password'); fs.writeFileSync(secret, password, { mode: 0o600 });
  const existing = await store.pool.query("SELECT 1 FROM pg_roles WHERE rolname='leandata_commerce_app'");
  if (existing.rowCount) {
    await store.pool.query('DROP OWNED BY leandata_commerce_app');
    await store.pool.query('DROP ROLE leandata_commerce_app');
  }
  execFileSync(process.execPath, [path.join(__dirname, 'admin.cjs'), 'grant-runtime', secret],
    { env: { ...process.env, COMMERCE_DATABASE_URL_FILE: process.env.COMMERCE_TEST_DATABASE_URL_FILE }, stdio: 'pipe' });
  const url = new URL(connectionString); url.username = 'leandata_commerce_app'; url.password = password;
  const runtime = new PostgresCommerceStore({ connectionString: url.toString() });
  try {
    await runtime.ready(); await runtime.create(order('runtime'));
    await assert.rejects(runtime.pool.query('DELETE FROM commerce.orders'), { code: '42501' });
    await assert.rejects(runtime.pool.query('UPDATE commerce.order_events SET action=\'edited\''), { code: '42501' });
    await assert.rejects(runtime.pool.query("INSERT INTO commerce.import_receipts VALUES('forged',0,now())"), { code: '42501' });
    await assert.rejects(runtime.pool.query('CREATE TABLE commerce.unauthorized(id int)'), { code: '42501' });
    await assert.rejects(runtime.pool.query(`UPDATE commerce.orders SET payload=jsonb_set(payload,'{bundle_id}','"forged"'::jsonb),version=version+1 WHERE id='pay_runtime'`), { code: '23514' });
  } finally { await runtime.close(); }
});

test('rollback export preserves exact payloads and refuses to overwrite any existing file', async () => {
  const { execFileSync, spawnSync } = require('child_process');
  const file = path.join(temp, 'rollback.json');
  const options = { env: { ...process.env, COMMERCE_DATABASE_URL_FILE: process.env.COMMERCE_TEST_DATABASE_URL_FILE }, stdio: 'pipe' };
  execFileSync(process.execPath, [path.join(__dirname, 'admin.cjs'), 'export', file], options);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), await store.list());
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.notEqual(spawnSync(process.execPath, [path.join(__dirname, 'admin.cjs'), 'export', file], options).status, 0);
});
