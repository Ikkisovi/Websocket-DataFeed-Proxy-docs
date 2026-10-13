const fs = require('fs');
const { PostgresCommerceStore } = require('./store.cjs');

async function main() {
  const [action, file] = process.argv.slice(2);
  if (!['migrate','import','export','verify','grant-runtime'].includes(action)) {
    throw new Error('Usage: admin.cjs migrate|import FILE|export NEW_FILE|verify|grant-runtime PASSWORD_FILE');
  }
  const store = new PostgresCommerceStore({ connectionFile: process.env.COMMERCE_DATABASE_URL_FILE });
  try {
    if (action === 'migrate') {
      await store.migrate();
      console.log(JSON.stringify({ schema: 1, migrated: true }));
    } else if (action === 'import') {
      console.log(JSON.stringify(await store.importFile(file)));
    } else if (action === 'export') {
      await store.ready();
      const orders = await store.list();
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(orders, null, 2)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      console.log(JSON.stringify({ exported: orders.length }));
    } else if (action === 'grant-runtime') {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.mode & 0o077) throw new Error('Runtime password file must be private');
      const password = fs.readFileSync(file, 'utf8').trim();
      if (password.length < 32 || /[\r\n]/.test(password)) throw new Error('Invalid runtime password');
      await store.transaction(async client => {
        const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname='leandata_commerce_app'");
        if (exists.rowCount) throw new Error('Runtime role already exists; do not rotate implicitly');
        const command = await client.query("SELECT format('CREATE ROLE leandata_commerce_app LOGIN PASSWORD %L', $1::text) AS sql", [password]);
        await client.query(command.rows[0].sql);
        await client.query(`GRANT USAGE ON SCHEMA commerce TO leandata_commerce_app;
          GRANT SELECT ON commerce.migrations,commerce.import_receipts TO leandata_commerce_app;
          GRANT SELECT,INSERT,UPDATE ON commerce.orders,commerce.payments,commerce.fulfillment_jobs TO leandata_commerce_app;
          GRANT SELECT,INSERT ON commerce.order_events TO leandata_commerce_app;
          GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA commerce TO leandata_commerce_app`);
      });
      console.log(JSON.stringify({ runtime_role_granted: true }));
    } else {
      await store.ready();
      const result = await store.pool.query(`SELECT
        (SELECT count(*) FROM commerce.orders)::int AS orders,
        (SELECT count(*) FROM commerce.payments)::int AS payments,
        (SELECT count(*) FROM commerce.fulfillment_jobs WHERE state='done')::int AS completed,
        (SELECT count(*) FROM commerce.fulfillment_jobs WHERE state IN ('queued','running'))::int AS pending_jobs`);
      console.log(JSON.stringify({ schema: 1, ...result.rows[0] }));
    }
  } finally { await store.close(); }
}

if (require.main === module) main().catch(() => {
  console.error('Commerce administration failed; no credentials or order payloads are logged.');
  process.exitCode = 1;
});
