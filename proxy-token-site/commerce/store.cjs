const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { Pool } = require('pg');

const migration = fs.readFileSync(path.join(__dirname, '001-commerce.sql'), 'utf8');
const schemaHash = crypto.createHash('sha256').update(migration).digest('hex');
const immutableFields = ['id', 'kind', 'registration_id', 'registration', 'user_id',
  'bundle_id', 'bundle', 'provider', 'provider_charge', 'payment_method', 'created_at',
  'resume_token_hash', 'checkout_token_hash'];

function privateConnectionFile(file) {
  if (!file) throw new Error('COMMERCE_DATABASE_URL_FILE is required');
  const stat = fs.statSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('Commerce connection file must be private');
  const value = fs.readFileSync(file, 'utf8').trim();
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || /[\r\n]/.test(value)) {
    throw new Error('Invalid commerce connection configuration');
  }
  return value;
}

function validate(order, previous) {
  if (!order || typeof order.id !== 'string' || !order.id.startsWith('pay_')
      || !['registration', 'renewal'].includes(order.kind)
      || !['PENDING','PAID','FULFILLING','COMPLETED','FAILED','CANCELLED','MANUAL_REVIEW'].includes(order.status)
      || !['UNPAID','PAID','PAID_MISMATCH'].includes(order.payment_status)) {
    throw new Error('Invalid payment order');
  }
  const charge = order.provider_charge || { amount_minor: order.bundle?.amount_cny_fen, currency: order.bundle?.currency };
  if (!Number.isSafeInteger(charge.amount_minor) || charge.amount_minor <= 0
      || !['CNY','USD','CAD'].includes(charge.currency)) throw new Error('Invalid payment price snapshot');
  if (previous) {
    for (const field of immutableFields) {
      if (!isDeepStrictEqual(order[field], previous[field])) throw new Error('Payment snapshot is immutable');
    }
    if (previous.payment_status === 'PAID' && order.payment_status !== 'PAID') {
      throw new Error('Confirmed payment cannot be reversed by an order update');
    }
    if (previous.provider_payment_id && previous.payment_status === 'PAID'
        && previous.provider_payment_id !== order.provider_payment_id) throw new Error('Payment receipt is immutable');
    if (previous.status === 'COMPLETED' && order.status !== 'COMPLETED') throw new Error('Completed order cannot regress');
  }
  if (order.status === 'COMPLETED' && order.payment_status !== 'PAID') throw new Error('Completion requires payment');
}

class PostgresCommerceStore {
  constructor({ connectionString, connectionFile } = {}) {
    this.pool = new Pool({ connectionString: connectionString || privateConnectionFile(connectionFile),
      max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
      statement_timeout: 10000, application_name: 'leandata-commerce' });
    this.pool.on('error', () => { console.error('[COMMERCE] database connection unavailable'); });
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async migrate() {
    return this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(67101301)');
      const found = await client.query("SELECT to_regclass('commerce.migrations') AS name");
      if (!found.rows[0].name) {
        await client.query(migration);
        await client.query('INSERT INTO commerce.migrations(version,sha256) VALUES(1,$1)', [schemaHash]);
      } else {
        const version = await client.query('SELECT version,sha256 FROM commerce.migrations');
        if (version.rowCount !== 1 || version.rows[0].version !== 1 || version.rows[0].sha256 !== schemaHash) {
          throw new Error('Commerce migration checksum mismatch');
        }
      }
    });
  }

  async ready() {
    const result = await this.pool.query('SELECT version,sha256 FROM commerce.migrations');
    if (result.rowCount !== 1 || result.rows[0].version !== 1 || result.rows[0].sha256 !== schemaHash) {
      throw new Error('Commerce schema is not admitted');
    }
    const receipt = await this.pool.query('SELECT count(*)::int AS count FROM commerce.import_receipts');
    if (!receipt.rows[0].count) throw new Error('Commerce import has not been accepted');
  }

  async list() {
    const result = await this.pool.query('SELECT payload FROM commerce.orders ORDER BY ordinal');
    return result.rows.map(row => row.payload);
  }

  async get(id) {
    const result = await this.pool.query('SELECT payload FROM commerce.orders WHERE id=$1', [id]);
    return result.rows[0]?.payload || null;
  }

  async persist(client, order, version, action) {
    validate(order);
    const charge = order.provider_charge || { amount_minor: order.bundle.amount_cny_fen, currency: order.bundle.currency };
    await client.query(`INSERT INTO commerce.payments(order_id,provider,provider_transaction_id,amount_minor,currency,state)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id) DO UPDATE SET
      provider_transaction_id=EXCLUDED.provider_transaction_id,state=EXCLUDED.state,updated_at=now()`,
      [order.id,order.provider,order.provider_payment_id || null,charge.amount_minor,charge.currency,order.payment_status]);
    await client.query('INSERT INTO commerce.order_events(order_id,version,action,status,payment_status) VALUES($1,$2,$3,$4,$5)',
      [order.id, version, action, order.status, order.payment_status]);
    if (order.payment_status === 'PAID') {
      const state = order.status === 'COMPLETED' ? 'done' : 'queued';
      await client.query(`INSERT INTO commerce.fulfillment_jobs(order_id,state) VALUES($1,$2)
        ON CONFLICT(order_id) DO UPDATE SET state=CASE WHEN EXCLUDED.state='done' THEN 'done'
        ELSE commerce.fulfillment_jobs.state END,updated_at=now()`, [order.id, state]);
    }
  }

  async create(order) {
    validate(order);
    return this.transaction(async client => {
      await client.query('INSERT INTO commerce.orders(id,payload) VALUES($1,$2)', [order.id, order]);
      await this.persist(client, order, 0, 'created');
      return order;
    });
  }

  async update(id, updater) {
    return this.transaction(async client => {
      const result = await client.query('SELECT payload,version FROM commerce.orders WHERE id=$1 FOR UPDATE', [id]);
      if (!result.rowCount) return null;
      const previous = result.rows[0].payload;
      const next = updater(structuredClone(previous));
      validate(next, previous);
      if (isDeepStrictEqual(next, previous)) return previous;
      const version = Number(result.rows[0].version) + 1;
      await client.query('UPDATE commerce.orders SET payload=$2,version=$3,updated_at=now() WHERE id=$1', [id, next, version]);
      await this.persist(client, next, version, 'updated');
      return next;
    });
  }

  async importFile(file) {
    const bytes = fs.readFileSync(file);
    const orders = JSON.parse(bytes);
    if (!Array.isArray(orders)) throw new Error('Expected payment order array');
    const sourceHash = crypto.createHash('sha256').update(bytes).digest('hex');
    orders.forEach(order => validate(order));
    if (new Set(orders.map(order => order.id)).size !== orders.length) throw new Error('Duplicate imported order');
    return this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(67101301)');
      const existing = await client.query('SELECT id,payload FROM commerce.orders');
      if (existing.rowCount && (existing.rowCount !== orders.length
          || orders.some(order => !isDeepStrictEqual(order, existing.rows.find(row => row.id === order.id)?.payload)))) {
        throw new Error('Import requires an empty database or an identical accepted snapshot');
      }
      if (!existing.rowCount) {
        for (const order of orders) {
          await client.query('INSERT INTO commerce.orders(id,payload) VALUES($1,$2)', [order.id, order]);
          await this.persist(client, order, 0, 'imported');
        }
      }
      const readback = await client.query('SELECT id,payload FROM commerce.orders');
      if (readback.rowCount !== orders.length || orders.some(order =>
        !isDeepStrictEqual(order, readback.rows.find(row => row.id === order.id)?.payload))) {
        throw new Error('Commerce import readback mismatch');
      }
      await client.query('INSERT INTO commerce.import_receipts(source_sha256,order_count) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [sourceHash, orders.length]);
      return { source_sha256: sourceHash, orders: orders.length, exact_readback: true };
    });
  }

  async cancelSiblings(order, completedAt) {
    const siblings = await this.pool.query(`SELECT id FROM commerce.orders WHERE id<>$1
      AND payload->>'registration_id'=$2 AND payload->>'status'='PENDING'
      AND payload->>'payment_status'='UNPAID'`, [order.id, order.registration_id]);
    for (const sibling of siblings.rows) {
      await this.update(sibling.id, current => current.status === 'PENDING' && current.payment_status === 'UNPAID'
        ? { ...current, status: 'CANCELLED', cancelled_at: completedAt, last_error: '同一注册流程已由其他订单完成。' }
        : current);
    }
  }

  async withFulfillment(id, fn) {
    const client = await this.pool.connect();
    let token;
    let locked = false;
    try {
      const lock = await client.query('SELECT pg_try_advisory_lock(67101302) AS locked');
      locked = lock.rows[0].locked;
      if (!locked) throw Object.assign(new Error('Fulfillment is busy'), { code: 'COMMERCE_BUSY', statusCode: 503 });
      const order = await this.get(id);
      if (order?.status === 'COMPLETED') return fn();
      token = crypto.randomUUID();
      const job = await client.query(`UPDATE commerce.fulfillment_jobs SET state='running',
        lease_token=$2,lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now()
        WHERE order_id=$1 AND state IN ('queued','running')
        AND (lease_until IS NULL OR lease_until<=now()) RETURNING order_id`, [id, token]);
      if (!job.rowCount) throw Object.assign(new Error('Fulfillment is not available'), { code: 'COMMERCE_BUSY', statusCode: 503 });
      const result = await fn();
      if ((await this.get(id))?.status !== 'COMPLETED') throw new Error('Fulfillment has no completion receipt');
      await client.query(`UPDATE commerce.fulfillment_jobs SET state='done',lease_token=NULL,
        lease_until=NULL,last_error_code=NULL,updated_at=now() WHERE order_id=$1 AND lease_token=$2`, [id, token]);
      return result;
    } catch (error) {
      if (token) {
        await client.query(`UPDATE commerce.fulfillment_jobs SET state='queued',lease_token=NULL,lease_until=NULL,
          next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*GREATEST(attempts,1))),
          last_error_code=$3,updated_at=now() WHERE order_id=$1 AND lease_token=$2`,
        [id, token, error.code === 'COMMERCE_BUSY' ? 'busy' : 'projection_failed']).catch(() => {});
      }
      throw error;
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(67101302)').catch(() => {});
      client.release();
    }
  }

  async dueJobs() {
    const result = await this.pool.query(`SELECT order_id FROM commerce.fulfillment_jobs
      WHERE state IN ('queued','running') AND next_attempt_at<=now()
      AND (lease_until IS NULL OR lease_until<=now()) ORDER BY next_attempt_at LIMIT 10`);
    return result.rows.map(row => row.order_id);
  }

  async duePayments() {
    const result = await this.pool.query(`SELECT o.id FROM commerce.orders o JOIN commerce.payments p ON p.order_id=o.id
      WHERE p.state='UNPAID' AND p.next_check_at<=now() AND (p.check_until IS NULL OR p.check_until<=now())
      AND o.payload->>'status' IN ('PENDING','FAILED')
      AND ((p.provider='stripe_checkout' AND o.payload->>'stripe_checkout_session_id' IS NOT NULL)
        OR (p.provider='zpay' AND o.payload->>'zpay_subject' IS NOT NULL)) ORDER BY p.next_check_at LIMIT 3`);
    return result.rows.map(row => row.id);
  }

  async withPaymentCheck(id, fn) {
    const token = crypto.randomUUID();
    const claimed = await this.pool.query(`UPDATE commerce.payments SET check_token=$2,
      check_until=now()+interval '30 seconds',next_check_at=now()+interval '5 minutes'
      WHERE order_id=$1 AND state='UNPAID' AND (check_until IS NULL OR check_until<=now()) RETURNING order_id`, [id, token]);
    if (!claimed.rowCount) return;
    try { return await fn(); }
    finally {
      await this.pool.query('UPDATE commerce.payments SET check_token=NULL,check_until=NULL WHERE order_id=$1 AND check_token=$2', [id, token]);
    }
  }

  async close() { await this.pool.end(); }
}

class FileCommerceStore {
  constructor({ read, write }) { this.read = read; this.write = write; this.tail = Promise.resolve(); }
  async ready() {}
  async list() { return this.read(); }
  async get(id) { return this.read().find(order => order.id === id) || null; }
  async create(order) { const orders = this.read(); orders.push(order); this.write(orders); return order; }
  async update(id, updater) {
    const orders = this.read();
    const index = orders.findIndex(order => order.id === id);
    if (index < 0) return null;
    orders[index] = updater(orders[index]); this.write(orders); return orders[index];
  }
  async cancelSiblings(order, completedAt) {
    const orders = this.read();
    for (const sibling of orders) {
      if (sibling.id !== order.id && sibling.registration_id === order.registration_id
          && sibling.status === 'PENDING' && sibling.payment_status === 'UNPAID') {
        Object.assign(sibling, { status: 'CANCELLED', cancelled_at: completedAt,
          last_error: '同一注册流程已由其他订单完成。' });
      }
    }
    this.write(orders);
  }
  withFulfillment(_id, fn) {
    const result = this.tail.then(fn); this.tail = result.catch(() => {}); return result;
  }
  async dueJobs() { return []; }
  async duePayments() { return []; }
  async close() {}
}

function createCommerceStore(options) {
  if (process.env.NODE_ENV === 'production' && !process.env.COMMERCE_BACKEND) {
    throw new Error('Production commerce backend must be explicit');
  }
  const backend = process.env.COMMERCE_BACKEND || 'file';
  if (backend === 'file') return new FileCommerceStore(options);
  if (backend !== 'postgres') throw new Error('Unknown commerce backend');
  return new PostgresCommerceStore({ connectionFile: process.env.COMMERCE_DATABASE_URL_FILE });
}

module.exports = { createCommerceStore, PostgresCommerceStore, privateConnectionFile, schemaHash };
