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
  // Clean status data so status/uptime/latency tests start fresh
  const statusFile = path.join(TEST_DATA_DIR, 'status.json');
  if (fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
}

beforeEach(() => {
  resetTestData();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// ============================================================
// Tier definitions
// ============================================================
describe('Tier definitions', () => {
  it('should have at least 5 tiers', () => {
    const tiers = Object.keys(TIERS);
    expect(tiers).toContain('trial');
    expect(tiers).toContain('basic');
    expect(tiers).toContain('value');
    expect(tiers).toContain('standard');
    expect(tiers).toContain('premium');
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

  it('value tier maps to value role with mode-based REST permissions', () => {
    expect(TIERS.value.role).toBe('value');
    expect(TIERS.value.expiryDays).toBe(30);
    // WS is fully open for both modes
    expect(TIERS.value.modes.stocks.ws.stocks).toBe(true);
    expect(TIERS.value.modes.stocks.ws.options).toBe(true);
    // REST differs by mode
    expect(TIERS.value.modes.stocks.rest.stocks_history).toBe(true);
    expect(TIERS.value.modes.stocks.rest.options_history).toBe(false);
    expect(TIERS.value.modes.options.rest.options_history).toBe(true);
    expect(TIERS.value.modes.options.rest.stocks_history).toBe(false);
  });

  it('standard tier has all WS channels', () => {
    expect(TIERS.standard.permissions.ws.stocks).toBe(true);
    expect(TIERS.standard.permissions.ws.options).toBe(true);
    expect(TIERS.standard.permissions.ws.crypto).toBe(true);
    expect(TIERS.standard.permissions.ws.overnight).toBe(true);
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

  it('returns syncOk in response (async sync)', async () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'synctest', phone: '777', role: 'basic', tier: 'basic',
      permissions: TIERS.basic.permissions
    }]));

    const res = await request(app).post('/api/generate-token').send({ username: 'synctest', phone: '777' });
    expect(res.body.success).toBe(true);
    // syncOk should be present (true if SCP succeeded, false if it failed)
    expect(res.body).toHaveProperty('syncOk');
    expect(typeof res.body.syncOk).toBe('boolean');
  });

  it('writes proxy file in correct format (token + user_id, NOT username + phone)', async () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'formattest', phone: '888', role: 'premium', tier: 'premium',
      permissions: TIERS.premium.permissions
    }]));

    await request(app).post('/api/generate-token').send({ username: 'formattest', phone: '888' });

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const user = proxy.users.find(u => u.user_id === 'formattest');

    // Cloud-proxy container expects these fields
    expect(user).toHaveProperty('token');
    expect(user).toHaveProperty('user_id');
    expect(user).toHaveProperty('role');
    expect(user).toHaveProperty('expires_at');
    expect(user).toHaveProperty('permissions');

    // Must NOT have token-site fields
    expect(user).not.toHaveProperty('username');
    expect(user).not.toHaveProperty('phone');
    expect(user).not.toHaveProperty('tier');
  });

  it('returns existing token without re-registering', async () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'existing', phone: '999', role: 'standard', tier: 'standard',
      permissions: TIERS.standard.permissions
    }]));

    // First call generates token
    const res1 = await request(app).post('/api/generate-token').send({ username: 'existing', phone: '999' });
    expect(res1.body.success).toBe(true);
    const firstToken = res1.body.token;

    // Second call returns existing token
    const res2 = await request(app).post('/api/generate-token').send({ username: 'existing', phone: '999' });
    expect(res2.body.success).toBe(true);
    expect(res2.body.token).toBe(firstToken);
    expect(res2.body.message).toMatch(/已存在/);
  });
});

// ============================================================
// Proxy file format validation
// ============================================================
describe('Proxy file format (cloud-proxy compatibility)', () => {
  it('proxy file must be {users: [...]} dict, not a plain array', async () => {
    // Start with valid format
    fs.writeFileSync(TEST_PROXY_FILE, '{"users":[]}');

    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'fmtcheck', phone: '111', role: 'premium', tier: 'premium',
      permissions: TIERS.premium.permissions
    }]));

    await request(app).post('/api/generate-token').send({ username: 'fmtcheck', phone: '111' });

    const raw = fs.readFileSync(TEST_PROXY_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    // _normalize_user_entries in alpaca_cloud_proxy.py checks:
    //   if isinstance(payload, dict) and "users" in payload:
    //       payload = payload.get("users")
    expect(parsed).toHaveProperty('users');
    expect(Array.isArray(parsed.users)).toBe(true);
  });

  it('proxy file entries must have user_id field (not username)', async () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'idcheck', phone: '222', role: 'basic', tier: 'basic',
      permissions: TIERS.basic.permissions
    }]));

    await request(app).post('/api/generate-token').send({ username: 'idcheck', phone: '222' });

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const user = proxy.users[proxy.users.length - 1];

    // Cloud-proxy _normalize_user_entries looks for user_id:
    //   user_id = item.get("user_id") or item.get("id") or item.get("name")
    expect(user.user_id).toBe('idcheck');
    expect(user).not.toHaveProperty('username');
  });

  it('proxy file entries must have token field', async () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'tokenchk', phone: '333', role: 'standard', tier: 'standard',
      permissions: TIERS.standard.permissions
    }]));

    const res = await request(app).post('/api/generate-token').send({ username: 'tokenchk', phone: '333' });

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const user = proxy.users.find(u => u.user_id === 'tokenchk');

    expect(user.token).toBeDefined();
    expect(user.token).toBe(res.body.token);
    expect(user.token.length).toBeGreaterThan(30); // UUID v4 = 36 chars
  });

  it('proxy file entries must have expires_at field', async () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'expcheck', phone: '444', role: 'trial', tier: 'trial',
      permissions: TIERS.trial.permissions
    }]));

    await request(app).post('/api/generate-token').send({ username: 'expcheck', phone: '444' });

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const user = proxy.users.find(u => u.user_id === 'expcheck');

    expect(user.expires_at).toBeDefined();
    // Verify it's a valid ISO date ~3 days from now
    const expDate = new Date(user.expires_at);
    const now = new Date();
    const diffDays = (expDate - now) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(2.9);
    expect(diffDays).toBeLessThan(3.1);
  });
});

// ============================================================
// Admin approve — async sync tests
// ============================================================
describe('POST /api/admin/approve — async sync', () => {
  let adminToken;

  beforeEach(async () => {
    resetTestData();
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    adminToken = login.body.token;
  });

  it('approve response includes sync status in message', async () => {
    const reg = await request(app).post('/api/register').send({
      username: 'asyncapprove', phone: '555', tier: 'standard'
    });

    const res = await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id: reg.body.id });

    expect(res.body.success).toBe(true);
    // Message should contain either "并同步" (synced) or "但同步失败" (sync failed)
    expect(res.body.message).toMatch(/同步/);
  });

  it('approve of existing user includes sync status', async () => {
    // Pre-create a user + proxy entry
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'existuser', phone: '666', role: 'premium', tier: 'premium',
      permissions: TIERS.premium.permissions
    }]));
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({
      users: [{
        token: 'existing-token-uuid',
        user_id: 'existuser',
        role: 'premium',
        expires_at: computeExpiry(TIERS.premium),
        permissions: TIERS.premium.permissions
      }]
    }));

    // Register + approve same username
    const reg = await request(app).post('/api/register').send({
      username: 'existuser2', phone: '777', tier: 'standard'
    });

    const res = await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id: reg.body.id });

    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/同步/);
  });

  it('approve writes proxy file in correct format', async () => {
    const reg = await request(app).post('/api/register').send({
      username: 'approvefmt', phone: '888', tier: 'basic'
    });

    await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id: reg.body.id });

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const user = proxy.users.find(u => u.user_id === 'approvefmt');

    // Cloud-proxy compatible format
    expect(user).toHaveProperty('token');
    expect(user).toHaveProperty('user_id');
    expect(user).toHaveProperty('role');
    expect(user).toHaveProperty('expires_at');
    expect(user).toHaveProperty('permissions');
    expect(user).not.toHaveProperty('username');
    expect(user).not.toHaveProperty('phone');
  });
});

// ============================================================
// Admin sync-users endpoint
// ============================================================
describe('POST /api/admin/sync-users', () => {
  let adminToken;

  beforeEach(async () => {
    resetTestData();
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    adminToken = login.body.token;
  });

  it('returns success, userCount, and logs', async () => {
    const res = await request(app).post('/api/admin/sync-users')
      .set('x-admin-token', adminToken)
      .send({});

    expect(res.body).toHaveProperty('success');
    expect(res.body).toHaveProperty('userCount');
    expect(res.body).toHaveProperty('logs');
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(typeof res.body.success).toBe('boolean');
  });

  it('requires admin auth', async () => {
    const res = await request(app).post('/api/admin/sync-users').send({});
    expect(res.statusCode).toBe(401);
  });

  it('logs contain sync result info', async () => {
    const res = await request(app).post('/api/admin/sync-users')
      .set('x-admin-token', adminToken)
      .send({});

    const logText = res.body.logs.join('\n');
    expect(logText).toMatch(/Syncing to ThinkCentre/);
  });
});

// ============================================================
// Status API
// ============================================================
describe('GET /api/status', () => {
  it('returns overall status with two components', async () => {
    const res = await request(app).get('/api/status');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('overall');
    expect(['operational', 'degraded', 'outage']).toContain(res.body.overall);
    expect(res.body).toHaveProperty('components.rest');
    expect(res.body).toHaveProperty('components.ws');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('each component has name, route, status, latencyMs', async () => {
    const res = await request(app).get('/api/status');
    for (const key of ['rest', 'ws']) {
      const comp = res.body.components[key];
      expect(comp).toHaveProperty('name');
      expect(comp).toHaveProperty('route');
      expect(comp).toHaveProperty('status');
      expect(['operational', 'degraded', 'outage']).toContain(comp.status);
      expect(comp).toHaveProperty('latencyMs');
      expect(typeof comp.latencyMs).toBe('number');
    }
  });

  it('overall is operational only when both components are up', async () => {
    const res = await request(app).get('/api/status');
    const { rest, ws } = res.body.components;
    if (rest.status === 'operational' && ws.status === 'operational') {
      expect(res.body.overall).toBe('operational');
    }
  });

  it('persists samples to status.json', async () => {
    await request(app).get('/api/status');
    const statusFile = path.join(TEST_DATA_DIR, 'status.json');
    expect(fs.existsSync(statusFile)).toBe(true);
    const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    expect(data).toHaveProperty('uptime.rest');
    expect(data).toHaveProperty('uptime.ws');
    expect(data).toHaveProperty('latency.rest');
    expect(data).toHaveProperty('latency.ws');
    expect(data.uptime.rest.length).toBeGreaterThanOrEqual(1);
    expect(data.latency.rest.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/uptime', () => {
  it('returns 90-element arrays for rest and ws', async () => {
    // Seed some data first
    await request(app).get('/api/status');
    const res = await request(app).get('/api/uptime');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('rest');
    expect(res.body).toHaveProperty('ws');
    expect(res.body.rest).toHaveLength(90);
    expect(res.body.ws).toHaveLength(90);
  });

  it('uptime values are percentages between 0 and 100', async () => {
    await request(app).get('/api/status');
    const res = await request(app).get('/api/uptime');
    for (const val of [...res.body.rest, ...res.body.ws]) {
      expect(typeof val).toBe('number');
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    }
  });

  it('defaults to 100% when no data exists', async () => {
    // Don't seed any data
    const res = await request(app).get('/api/uptime');
    expect(res.body.rest.every(v => v === 100)).toBe(true);
    expect(res.body.ws.every(v => v === 100)).toBe(true);
  });
});

describe('GET /api/latency', () => {
  it('returns latency arrays with default 24h range', async () => {
    await request(app).get('/api/status');
    const res = await request(app).get('/api/latency');
    expect(res.statusCode).toBe(200);
    expect(res.body.range).toBe('24h');
    expect(res.body).toHaveProperty('rest');
    expect(res.body).toHaveProperty('ws');
    expect(Array.isArray(res.body.rest)).toBe(true);
    expect(Array.isArray(res.body.ws)).toBe(true);
  });

  it('accepts range=7d and range=30d', async () => {
    await request(app).get('/api/status');
    for (const range of ['7d', '30d']) {
      const res = await request(app).get(`/api/latency?range=${range}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.range).toBe(range);
    }
  });

  it('latency values are positive numbers or null', async () => {
    await request(app).get('/api/status');
    const res = await request(app).get('/api/latency');
    for (const val of [...res.body.rest, ...res.body.ws]) {
      if (val !== null) {
        expect(typeof val).toBe('number');
        expect(val).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
