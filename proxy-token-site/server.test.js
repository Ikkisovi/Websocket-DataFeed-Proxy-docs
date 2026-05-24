const fs = require('fs');
const path = require('path');
const os = require('os');

// Set up isolated temp dirs BEFORE requiring server
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-test-'));
const TEST_DATA_DIR = path.join(TEST_DIR, 'data');
const TEST_PROXY_FILE = path.join(TEST_DIR, 'proxy-users.json');
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.PROXY_USERS_FILE = TEST_PROXY_FILE;
process.env.THINKCENTRE_HOST = 'nobody@127.0.0.1'; // prevent real sync

const request = require('supertest');
const { app, TIERS, computeExpiry } = require('./server');

const USERS_FILE = path.join(TEST_DATA_DIR, 'users.json');
const PENDING_FILE = path.join(TEST_DATA_DIR, 'pending.json');

function resetTestData() {
  fs.writeFileSync(USERS_FILE, '[]');
  fs.writeFileSync(PENDING_FILE, '[]');
  fs.writeFileSync(TEST_PROXY_FILE, '{"users":[]}');
}

beforeEach(() => {
  resetTestData();
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// ============================================================
// Tier definitions
// ============================================================
describe('Tier definitions', () => {
  it('should have all 5 tiers', () => {
    expect(Object.keys(TIERS)).toEqual(['trial', 'basic', 'value', 'standard', 'premium']);
  });

  it('trial tier maps to standard role with 3-day expiry', () => {
    expect(TIERS.trial.role).toBe('standard');
    expect(TIERS.trial.expiryDays).toBe(3);
  });

  it('basic tier is REST-only (all WS false)', () => {
    const ws = TIERS.basic.permissions.ws;
    expect(Object.values(ws).every(v => v === false)).toBe(true);
  });

  it('basic tier maps to basic role with 30-day expiry', () => {
    expect(TIERS.basic.role).toBe('basic');
    expect(TIERS.basic.expiryDays).toBe(30);
  });

  it('value tier maps to value role with mode-based permissions', () => {
    expect(TIERS.value.role).toBe('value');
    expect(TIERS.value.expiryDays).toBe(30);
    expect(TIERS.value.modes.stocks.ws.stocks).toBe(true);
    expect(TIERS.value.modes.stocks.ws.options).toBe(false);
    expect(TIERS.value.modes.options.ws.options).toBe(true);
    expect(TIERS.value.modes.options.ws.stocks).toBe(false);
  });

  it('standard tier has stocks + options WS', () => {
    expect(TIERS.standard.permissions.ws.stocks).toBe(true);
    expect(TIERS.standard.permissions.ws.options).toBe(true);
    expect(TIERS.standard.permissions.ws.crypto).toBe(false);
  });

  it('premium tier has all WS + REST enabled', () => {
    const ws = TIERS.premium.permissions.ws;
    expect(ws.stocks).toBe(true);
    expect(ws.options).toBe(true);
    expect(ws.overnight).toBe(true);
    expect(ws.crypto).toBe(true);
    expect(ws.news).toBe(true);
    expect(TIERS.premium.permissions.rest.crypto_orderbooks).toBe(true);
    expect(TIERS.premium.permissions.rest.news_history).toBe(true);
  });

  it('no tier grants admin_token_lookup', () => {
    for (const [, tier] of Object.entries(TIERS)) {
      expect(tier.permissions.rest.admin_token_lookup).toBe(false);
    }
  });
});

// ============================================================
// computeExpiry
// ============================================================
describe('computeExpiry', () => {
  it('trial tier expires in ~3 days', () => {
    const expiry = new Date(computeExpiry(TIERS.trial));
    const now = new Date();
    const diffDays = (expiry - now) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(2.9);
    expect(diffDays).toBeLessThan(3.1);
  });

  it('premium tier expires in ~30 days', () => {
    const expiry = new Date(computeExpiry(TIERS.premium));
    const now = new Date();
    const diffDays = (expiry - now) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(29.9);
    expect(diffDays).toBeLessThan(30.1);
  });
});

// ============================================================
// Registration
// ============================================================
describe('POST /api/register', () => {
  it('returns 400 for missing fields', async () => {
    const res = await request(app).post('/api/register').send({ username: 'test' });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for invalid tier', async () => {
    const res = await request(app).post('/api/register').send({
      username: 'test', phone: '123', tier: 'nonexistent'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/无效/);
  });

  it('accepts all 5 tier IDs', async () => {
    for (const tier of ['trial', 'basic', 'value', 'standard', 'premium']) {
      resetTestData();
      const body = { username: `user_${tier}`, phone: '123', tier };
      if (tier === 'value') body.mode = 'stocks';
      const res = await request(app).post('/api/register').send(body);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
      expect(pending.find(p => p.username === `user_${tier}`).tier).toBe(tier);
    }
  });

  it('rejects duplicate pending username', async () => {
    await request(app).post('/api/register').send({ username: 'dup', phone: '1', tier: 'trial' });
    const res = await request(app).post('/api/register').send({ username: 'dup', phone: '2', tier: 'basic' });
    expect(res.statusCode).toBe(409);
  });

  it('defaults to standard when tier omitted', async () => {
    await request(app).post('/api/register').send({ username: 'noTier', phone: '1' });
    const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    expect(pending[0].tier).toBe('standard');
  });

  it('rejects value tier without mode', async () => {
    const res = await request(app).post('/api/register').send({
      username: 'valueNoMode', phone: '1', tier: 'value'
    });
    expect(res.statusCode).toBe(400);
  });

  it('stores mode for value tier', async () => {
    const res = await request(app).post('/api/register').send({
      username: 'valueUser', phone: '1', tier: 'value', mode: 'options'
    });
    expect(res.statusCode).toBe(200);
    const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    expect(pending[0].mode).toBe('options');
  });
});

// ============================================================
// Check status
// ============================================================
describe('POST /api/check-status', () => {
  it('returns 400 for missing fields', async () => {
    const res = await request(app).post('/api/check-status').send({});
    expect(res.statusCode).toBe(400);
  });

  it('returns not_found for unknown user', async () => {
    const res = await request(app).post('/api/check-status').send({ username: 'nobody', phone: '000' });
    expect(res.body.status).toBe('not_found');
  });

  it('returns pending for registered user', async () => {
    await request(app).post('/api/register').send({ username: 'pend', phone: '111', tier: 'trial' });
    const res = await request(app).post('/api/check-status').send({ username: 'pend', phone: '111' });
    expect(res.body.status).toBe('pending');
  });
});

// ============================================================
// Admin auth
// ============================================================
describe('Admin auth', () => {
  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/admin/login').send({ password: 'wrong' });
    expect(res.statusCode).toBe(401);
  });

  it('returns token for correct password', async () => {
    const res = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects admin endpoints without token', async () => {
    const res = await request(app).get('/api/admin/pending');
    expect(res.statusCode).toBe(401);
  });
});

// ============================================================
// Admin approve — writes to isolated proxy file
// ============================================================
describe('POST /api/admin/approve', () => {
  let adminToken;

  beforeEach(async () => {
    resetTestData();
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    adminToken = login.body.token;
  });

  it('approves and writes correct role for each tier', async () => {
    const tierTests = [
      { tier: 'trial', expectedRole: 'standard' },
      { tier: 'basic', expectedRole: 'basic' },
      { tier: 'value', expectedRole: 'value', mode: 'options' },
      { tier: 'standard', expectedRole: 'standard' },
      { tier: 'premium', expectedRole: 'premium' },
    ];

    for (const { tier, expectedRole, mode: m } of tierTests) {
      resetTestData();
      const body = { username: `u_${tier}`, phone: '123', tier };
      if (m) body.mode = m;
      const reg = await request(app).post('/api/register').send(body);
      const id = reg.body.id;

      const res = await request(app).post('/api/admin/approve')
        .set('x-admin-token', adminToken)
        .send({ id });

      expect(res.body.success).toBe(true);

      // Check users.json has correct role
      const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      const user = users.find(u => u.username === `u_${tier}`);
      expect(user.role).toBe(expectedRole);
      expect(user.tier).toBe(tier);

      // Check proxy users file has the token
      const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
      const proxyUser = proxy.users.find(u => u.user_id === `u_${tier}`);
      expect(proxyUser).toBeDefined();
      expect(proxyUser.role).toBe(expectedRole);
      expect(res.body.token).toBeDefined();
    }
  });

  it('trial tier gets 3-day expiry in proxy', async () => {
    const reg = await request(app).post('/api/register').send({
      username: 'trial_exp', phone: '123', tier: 'trial'
    });
    await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id: reg.body.id });

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const user = proxy.users.find(u => u.user_id === 'trial_exp');
    const diffDays = (new Date(user.expires_at) - new Date()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(2.9);
    expect(diffDays).toBeLessThan(3.1);
  });

  it('returns 404 for invalid id', async () => {
    const res = await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id: 'nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});

// ============================================================
// Admin reject
// ============================================================
describe('POST /api/admin/reject', () => {
  it('rejects a pending registration', async () => {
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    const adminToken = login.body.token;

    const reg = await request(app).post('/api/register').send({
      username: 'rejectme', phone: '999', tier: 'trial'
    });

    const res = await request(app).post('/api/admin/reject')
      .set('x-admin-token', adminToken)
      .send({ id: reg.body.id, reason: 'test rejection' });

    expect(res.body.success).toBe(true);

    const check = await request(app).post('/api/check-status').send({ username: 'rejectme', phone: '999' });
    expect(check.body.status).toBe('rejected');
  });
});

// ============================================================
// Generate token
// ============================================================
describe('POST /api/generate-token', () => {
  it('returns 400 for missing fields', async () => {
    const res = await request(app).post('/api/generate-token').send({ phone: '123' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 for unknown user', async () => {
    const res = await request(app).post('/api/generate-token').send({ username: 'nobody', phone: '000' });
    expect(res.statusCode).toBe(401);
  });

  it('generates token for approved user', async () => {
    // Pre-populate an approved user
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'gentest', phone: '555', role: 'premium', tier: 'premium',
      permissions: TIERS.premium.permissions
    }]));

    const res = await request(app).post('/api/generate-token').send({ username: 'gentest', phone: '555' });
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.role).toBe('premium');

    // Token should be in proxy file
    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    expect(proxy.users.find(u => u.user_id === 'gentest')).toBeDefined();
  });
});
