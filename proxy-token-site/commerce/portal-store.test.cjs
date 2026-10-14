const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PostgresPortalStore } = require('./portal-store.cjs');
const { PostgresCommerceStore, privateConnectionFile } = require('./store.cjs');

const url = privateConnectionFile(process.env.PORTAL_TEST_DATABASE_URL_FILE);
const target = new URL(url);
assert.equal(target.hostname, '127.0.0.1'); assert.ok(target.pathname.endsWith('_test'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-store-'));
const projected = {};
let failProjection = false;
const store = new PostgresPortalStore({ connectionFile: process.env.PORTAL_TEST_DATABASE_URL_FILE,
  project: async (name, value) => { if (failProjection) throw new Error('fixture publication failure'); projected[name] = structuredClone(value); } });
const commerce = new PostgresCommerceStore({ connectionString: url });
commerce.sharedClient = () => store.scope.getStore()?.client;
const snapshot = {
  accounts: [{ username: 'duplicate', phone: '1', role: 'free', odd: { nested: null } }, { username: 'duplicate', phone: '2', role: 'premium' }],
  pending: [{ id: 'pending-fixture', type: 'renewal', username: 'duplicate', status: 'pending', checkout_token_hash: 'opaque-hash' }],
  bulk_orders: [{ id: 'bulk-fixture', status: 'pending', quoted_price: 0, custom_request: 'fixture' }],
  registry: { generation_metadata: { keep: true }, users: [{ user_id: 'duplicate', token: 'fixture-token', role: 'free', permissions: { rest: true } }] },
};
before(async () => {
  await store.pool.query('DROP SCHEMA IF EXISTS portal CASCADE'); await store.migrate();
  await commerce.pool.query('DROP SCHEMA IF EXISTS commerce CASCADE'); await commerce.migrate();
  const empty = path.join(temp, 'orders.json'); fs.writeFileSync(empty, '[]'); await commerce.importFile(empty);
});
after(async () => { await store.close(); await commerce.close(); fs.rmSync(temp, { recursive: true }); });

test('exact import retains duplicate identities, field nulls, registry metadata and row order', async () => {
  const file = path.join(temp, 'snapshot.json'); fs.writeFileSync(file, JSON.stringify(snapshot));
  const receipt = await store.importFile(file); assert.equal(receipt.exact_readback, true);
  assert.deepEqual(receipt.counts, { accounts: 2, pending: 1, bulk_orders: 1, registry: 1 });
  for (const name of Object.keys(snapshot)) assert.deepEqual(await store.read(name), snapshot[name]);
  const fields = await store.pool.query('SELECT account_id,phone,role FROM portal.accounts ORDER BY ordinal');
  assert.deepEqual(fields.rows, [{ account_id: 'duplicate', phone: '1', role: 'free' }, { account_id: 'duplicate', phone: '2', role: 'premium' }]);
  await store.ready();
  const other = new PostgresPortalStore({ connectionFile: process.env.PORTAL_TEST_DATABASE_URL_FILE });
  await assert.rejects(other.ready(), { code: 'PORTAL_UNAVAILABLE' }); await other.close();
});

test('failed multi-document mutation rolls back accounts, registry and audit together', async () => {
  const before = await store.read('accounts');
  await assert.rejects(store.mutate(async () => {
    await store.write('accounts', [{ username: 'should-not-exist' }]);
    await store.write('registry', { users: [] }); throw new Error('fixture crash before commit');
  }));
  assert.deepEqual(await store.read('accounts'), before);
  assert.deepEqual(await store.read('registry'), snapshot.registry);
});

test('concurrent read-modify-write transactions retain every extension', async () => {
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.mutate(async () => {
    const rows = await store.read('accounts'); rows.push({ username: 'concurrent-'+i }); await store.write('accounts', rows);
  })));
  assert.equal((await store.read('accounts')).length, 12);
});

test('projection failure keeps committed state and is repaired without a second entitlement update', async () => {
  failProjection = true;
  await assert.rejects(store.mutate(async () => {
    const registry = await store.read('registry'); registry.users[0].role = 'premium'; registry.users[0].fulfilled_payment_orders = ['once']; await store.write('registry', registry);
  }));
  assert.equal((await store.read('registry')).users[0].role, 'premium');
  const pending = await store.pool.query("SELECT version>projected_version AS pending FROM portal.documents WHERE name='registry'");
  assert.equal(pending.rows[0].pending, true);
  failProjection = false; await store.flush();
  assert.deepEqual(projected.registry.users[0].fulfilled_payment_orders, ['once']);
  const repaired = await store.pool.query("SELECT version=projected_version AS done FROM portal.documents WHERE name='registry'");
  assert.equal(repaired.rows[0].done, true);
});

test('payment completion shares the account transaction and cannot commit ahead of a rolled-back entitlement', async () => {
  const order = { id: 'pay_portal_atomic', kind: 'renewal', user_id: 'duplicate', provider: 'local_mock',
    bundle: { amount_cny_fen: 100, currency: 'CNY' }, status: 'PAID', payment_status: 'PAID', provider_payment_id: 'fixture-receipt' };
  await commerce.create(order);
  await assert.rejects(store.mutate(async () => {
    await commerce.update(order.id, row => ({ ...row, status: 'COMPLETED' }));
    await store.write('accounts', []); throw new Error('fixture crash');
  }));
  assert.equal((await commerce.get(order.id)).status, 'PAID'); assert.equal((await store.read('accounts')).length, 12);
  await store.mutate(async () => {
    await commerce.update(order.id, row => ({ ...row, status: 'COMPLETED' }));
    const rows = await store.read('accounts'); rows[0].fulfilled_payment_orders = [order.id]; await store.write('accounts', rows);
  });
  assert.equal((await commerce.get(order.id)).status, 'COMPLETED');
  assert.deepEqual((await store.read('accounts'))[0].fulfilled_payment_orders, [order.id]);
});

test('fenced export is exact, refuses replacement and rejects an import over newer accepted state', async () => {
  const file = path.join(temp, 'export.json'); await store.exportFile(file);
  for (const [name, value] of Object.entries(JSON.parse(fs.readFileSync(file)))) assert.deepEqual(value, await store.read(name));
  await assert.rejects(store.exportFile(file), { code: 'EEXIST' });
  await assert.rejects(store.importFile(path.join(temp, 'snapshot.json')), /identical state/);
});
