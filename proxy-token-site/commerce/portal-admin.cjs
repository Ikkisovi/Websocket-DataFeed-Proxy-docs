const fs = require('fs');
const { PostgresPortalStore } = require('./portal-store.cjs');

async function main() {
  const [action, file] = process.argv.slice(2);
  if (!['migrate','import','export','verify','grant-runtime'].includes(action)) throw new Error('Unknown portal administration action');
  const store = new PostgresPortalStore({ connectionFile: process.env.COMMERCE_DATABASE_URL_FILE });
  try {
    if (action === 'migrate') {
      await store.migrate(); console.log(JSON.stringify({ schema: 2, migrated: true }));
    } else if (action === 'import') {
      console.log(JSON.stringify(await store.importFile(file)));
    } else if (action === 'export') {
      await store.checkSchema(); console.log(JSON.stringify(await store.exportFile(file)));
    } else if (action === 'grant-runtime') {
      await store.pool.query(`GRANT USAGE ON SCHEMA portal TO leandata_commerce_app;
        GRANT SELECT ON portal.migrations,portal.import_receipts TO leandata_commerce_app;
        GRANT SELECT,INSERT,UPDATE,DELETE ON portal.accounts,portal.principals,portal.registrations,portal.bulk_orders,portal.sessions TO leandata_commerce_app;
        GRANT SELECT,UPDATE ON portal.documents TO leandata_commerce_app;
        GRANT SELECT,INSERT ON portal.events TO leandata_commerce_app;
        GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA portal TO leandata_commerce_app`);
      console.log(JSON.stringify({ existing_runtime_role_extended: true }));
    } else {
      await store.checkSchema();
      const counts = {};
      for (const name of ['accounts','pending','bulk_orders','registry']) {
        const value = await store.read(name); counts[name] = name === 'registry' ? value.users.length : value.length;
      }
      const pending = await store.pool.query('SELECT count(*)::int AS count FROM portal.documents WHERE projected_version<version');
      console.log(JSON.stringify({ schema: 2, counts, pending_projections: pending.rows[0].count }));
    }
  } finally { await store.close(); }
}

if (require.main === module) main().catch(() => {
  console.error('Portal administration failed; identity and credential payloads are withheld.');
  process.exitCode = 1;
});
