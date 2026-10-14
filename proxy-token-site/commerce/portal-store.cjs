const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { isDeepStrictEqual } = require('util');
const { Pool } = require('pg');
const { privateConnectionFile } = require('./store.cjs');

const migration = fs.readFileSync(path.join(__dirname, '002-portal.sql'), 'utf8');
const schemaHash = crypto.createHash('sha256').update(migration).digest('hex');
const tables = { accounts: 'accounts', pending: 'registrations', bulk_orders: 'bulk_orders', registry: 'principals' };
const defaults = { accounts: [], pending: [], bulk_orders: [], registry: { users: [] } };
const busy = () => Object.assign(new Error('Portal database writer is unavailable'), { code: 'PORTAL_UNAVAILABLE', statusCode: 503 });

function validate(name, value) {
  if (!Object.hasOwn(tables, name)) throw new Error('Unknown portal document');
  const rows = name === 'registry' ? value?.users : value;
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Invalid portal document');
  }
  return rows;
}

class PostgresPortalStore {
  constructor({ pool, connectionFile, project } = {}) {
    this.ownsPool = !pool;
    this.pool = pool || new Pool({ connectionString: privateConnectionFile(connectionFile),
      max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
      statement_timeout: 10000, application_name: 'leandata-portal-core' });
    if (this.ownsPool) this.pool.on('error', () => { console.error('[PORTAL] database unavailable'); });
    this.scope = new AsyncLocalStorage();
    this.project = project;
    this.failed = false;
    this.tail = Promise.resolve();
  }

  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(67101303)');
      const exists = await client.query("SELECT to_regclass('portal.migrations') AS name");
      if (!exists.rows[0].name) {
        await client.query(migration);
        await client.query('INSERT INTO portal.migrations(version,sha256) VALUES(2,$1)', [schemaHash]);
      } else await this.checkSchema(client);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async checkSchema(client = this.pool) {
    const result = await client.query('SELECT version,sha256 FROM portal.migrations');
    if (result.rowCount !== 1 || result.rows[0].version !== 2 || result.rows[0].sha256 !== schemaHash) {
      throw new Error('Portal schema is not admitted');
    }
  }

  async ready() {
    await this.checkSchema();
    const imported = await this.pool.query('SELECT count(*)::int AS count FROM portal.import_receipts');
    if (!imported.rows[0].count) throw new Error('Portal import has not been accepted');
    if (!this.guard) {
      const client = await this.pool.connect();
      try {
        const result = await client.query('SELECT pg_try_advisory_lock(67101304) AS owned');
        if (!result.rows[0].owned) throw busy();
        this.guard = client;
        client.on('error', () => { this.failed = true; console.error('[PORTAL] sole-writer connection lost'); });
      } catch (error) { client.release(); throw error; }
    }
    await this.flush({ verifyAll: true });
  }

  async read(name) {
    if (this.failed) throw busy();
    if (!Object.hasOwn(tables, name)) throw new Error('Unknown portal document');
    const client = this.scope.getStore()?.client || this.pool;
    if (name === 'registry') {
      const result = await client.query(`SELECT extra,COALESCE((SELECT jsonb_agg(payload ORDER BY ordinal)
        FROM portal.principals),'[]'::jsonb) AS users FROM portal.documents WHERE name='registry'`);
      return { ...result.rows[0].extra, users: result.rows[0].users };
    }
    const rows = await client.query(`SELECT payload FROM portal.${tables[name]} ORDER BY ordinal`);
    return rows.rows.map(row => row.payload);
  }

  async write(name, value) {
    if (!this.scope.getStore()) return this.mutate(() => this.write(name, value));
    const rows = validate(name, value);
    if (isDeepStrictEqual(await this.read(name), value)) return;
    const client = this.scope.getStore().client;
    await client.query(`DELETE FROM portal.${tables[name]}`);
    for (const [ordinal, row] of rows.entries()) {
      await client.query(`INSERT INTO portal.${tables[name]}(ordinal,payload) VALUES($1,$2)`, [ordinal, row]);
    }
    const { users, ...extra } = name === 'registry' ? value : {};
    const updated = await client.query('UPDATE portal.documents SET version=version+1,extra=$2 WHERE name=$1 RETURNING version', [name, extra]);
    await client.query('INSERT INTO portal.events(document,version,row_count) VALUES($1,$2,$3)', [name, updated.rows[0].version, rows.length]);
  }

  async snapshot() {
    const value = {};
    for (const name of Object.keys(tables)) value[name] = await this.read(name);
    return value;
  }

  mutate(action) {
    if (this.scope.getStore()) return action();
    const result = this.tail.then(async () => {
      if (this.failed) throw busy();
      const client = await this.pool.connect();
      let result;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(67101303)');
        result = await this.scope.run({ client }, action);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
      await this.flush();
      return result;
    });
    this.tail = result.catch(() => {});
    return result;
  }

  async flush({ verifyAll = false } = {}) {
    if (!this.project) return;
    if (this.failed) throw busy();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(67101303)');
      const due = await client.query('SELECT name,version FROM portal.documents WHERE projected_version<version OR $1 ORDER BY name', [verifyAll]);
      for (const row of due.rows) {
        const value = await this.scope.run({ client }, () => this.read(row.name));
        await this.project(row.name, value);
        await client.query('UPDATE portal.documents SET projected_version=version WHERE name=$1 AND version=$2', [row.name, row.version]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw Object.assign(new Error('Account access is temporarily unavailable. Please retry.'), { code: 'PORTAL_PROJECTION_PENDING', statusCode: 503 });
    }
    finally { client.release(); }
  }

  async importFile(file) {
    const bytes = fs.readFileSync(file);
    const snapshot = JSON.parse(bytes);
    if (Object.keys(snapshot).length !== 4) throw new Error('Expected four portal documents');
    for (const name of Object.keys(tables)) validate(name, snapshot[name]);
    const sourceHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const previousProject = this.project;
    this.project = null;
    try {
      return await this.mutate(async () => {
        const client = this.scope.getStore().client;
        const receipt = await client.query('SELECT count(*)::int AS count FROM portal.import_receipts');
        const current = await this.snapshot();
        const empty = Object.keys(tables).every(name => isDeepStrictEqual(current[name], defaults[name]));
        if ((!empty || receipt.rows[0].count) && !isDeepStrictEqual(current, snapshot)) {
          throw new Error('Portal import requires empty custody or identical state');
        }
        for (const name of Object.keys(tables)) await this.write(name, snapshot[name]);
        const readback = await this.snapshot();
        if (!isDeepStrictEqual(snapshot, readback)) throw new Error('Portal exact readback mismatch');
        const counts = Object.fromEntries(Object.keys(tables).map(name => [name, validate(name, snapshot[name]).length]));
        // Existing compatibility files already contain this fenced snapshot.
        await client.query('UPDATE portal.documents SET projected_version=version');
        await client.query('INSERT INTO portal.import_receipts(source_sha256,counts) VALUES($1,$2) ON CONFLICT DO NOTHING', [sourceHash, counts]);
        return { source_sha256: sourceHash, counts, exact_readback: true };
      });
    } finally { this.project = previousProject; }
  }

  async exportFile(file) {
    const value = await this.mutate(() => this.snapshot());
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    return { exported: Object.fromEntries(Object.keys(tables).map(name => [name, validate(name, value[name]).length])) };
  }

  async createSession(userId, sessionId, ttl) {
    if (this.failed) throw busy();
    await this.pool.query('INSERT INTO portal.sessions(token_sha256,user_id,expires_at) VALUES($1,$2,$3)',
      [crypto.createHash('sha256').update(sessionId).digest('hex'), userId, new Date(Date.now()+ttl)]);
  }

  async resolveSession(sessionId, ttl) {
    if (this.failed) throw busy();
    const result = await this.pool.query('UPDATE portal.sessions SET expires_at=$2 WHERE token_sha256=$1 AND expires_at>now() RETURNING user_id,expires_at',
      [crypto.createHash('sha256').update(sessionId).digest('hex'), new Date(Date.now()+ttl)]);
    const row = result.rows[0];
    return row ? { sessionId, session: { user_id: row.user_id, expires_at: row.expires_at.getTime() } } : null;
  }

  async deleteSession(sessionId) {
    if (this.failed) throw busy();
    await this.pool.query('DELETE FROM portal.sessions WHERE token_sha256=$1', [crypto.createHash('sha256').update(sessionId).digest('hex')]);
  }

  async pruneSessions() {
    await this.pool.query('DELETE FROM portal.sessions WHERE token_sha256 IN (SELECT token_sha256 FROM portal.sessions WHERE expires_at<=now() LIMIT 100)');
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.tail;
    if (this.guard) {
      await this.guard.query('SELECT pg_advisory_unlock(67101304)').catch(() => {});
      this.guard.release(); this.guard = null;
    }
    if (this.ownsPool) await this.pool.end();
  }
}

class FilePortalStore {
  constructor({ read, write }) { this.readFile = read; this.writeFile = write; this.tail = Promise.resolve(); this.scope = new AsyncLocalStorage(); this.sessions = new Map(); }
  async ready() {}
  async read(name) { return this.readFile(name, defaults[name]); }
  async write(name, value) { validate(name, value); return this.writeFile(name, value); }
  mutate(action) {
    if (this.scope.getStore()) return action();
    const result = this.tail.then(() => this.scope.run(true, action)); this.tail = result.catch(() => {}); return result;
  }
  async flush() {}
  async createSession(userId, sessionId, ttl) { this.sessions.set(sessionId, { user_id: userId, expires_at: Date.now()+ttl }); }
  async resolveSession(sessionId, ttl) {
    const session = this.sessions.get(sessionId);
    if (!session || session.expires_at<=Date.now()) { this.sessions.delete(sessionId); return null; }
    session.expires_at = Date.now()+ttl; return { sessionId, session };
  }
  async deleteSession(sessionId) { this.sessions.delete(sessionId); }
  async pruneSessions() {}
  async close() { await this.tail; }
}

function createPortalStore(options) {
  if (process.env.NODE_ENV === 'production' && !process.env.PORTAL_BACKEND) throw new Error('Production portal backend must be explicit');
  const backend = process.env.PORTAL_BACKEND || 'file';
  if (backend === 'file') return new FilePortalStore(options);
  if (backend !== 'postgres' || !options.pool) throw new Error('Postgres portal requires the admitted commerce database');
  return new PostgresPortalStore(options);
}

module.exports = { createPortalStore, PostgresPortalStore, schemaHash, tables };
