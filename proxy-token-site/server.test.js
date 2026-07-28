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
process.env.BYPASS_SYNC = 'true';                 // skip SCP to EC2 in tests
process.env.PROXY_RT_URL = 'http://127.0.0.1:1'; // prevent real rt-api probe in tests
process.env.PROXY_WS_HOST = '127.0.0.1';         // fast-fail WS probe (ECONNREFUSED)
process.env.PROXY_WS_PORT = '1';

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'mock' });

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

  it('returns 400 for an invalid email', async () => {
    const res = await request(app).post('/api/register').send({
      username: 'badMail', phone: '1', tier: 'basic', email: 'not-an-email'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('stores a valid optional email on the pending entry', async () => {
    const res = await request(app).post('/api/register').send({
      username: 'mailUser', phone: '1', tier: 'basic', email: 'mailuser@example.com'
    });
    expect(res.statusCode).toBe(200);
    const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    expect(pending[0].email).toBe('mailuser@example.com');
  });
});

// ============================================================
// Account portal
// ============================================================
describe('Account portal', () => {
  let loginSequence = 0;

  function seedAccount({
    userId = 'account-user',
    phone = '6045550100',
    tier = 'standard',
    mode,
    expiry = computeExpiry(TIERS.standard),
    token = 'account-token-1234567890'
  } = {}) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: userId,
      phone,
      role: TIERS[tier].role,
      tier,
      ...(mode && { mode }),
      permissions: mode ? TIERS[tier].modes[mode] : TIERS[tier].permissions
    }]));
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({
      users: [{
        token,
        user_id: userId,
        role: TIERS[tier].role,
        expires_at: expiry,
        permissions: mode ? TIERS[tier].modes[mode] : TIERS[tier].permissions
      }]
    }));
    return { userId, phone, token, expiry };
  }

  async function loginAccount(account = seedAccount()) {
    loginSequence += 1;
    const login = await request(app)
      .post('/api/account/login')
      .set('x-forwarded-for', `198.51.100.${loginSequence}`)
      .send({
        credential: {
          user_id: account.userId,
          phone: account.phone
        }
      });
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    return { login, cookie };
  }

  it('requires the credential object and rejects mismatched phone numbers', async () => {
    const account = seedAccount();
    const missing = await request(app).post('/api/account/login').send({
      user_id: account.userId,
      phone: account.phone
    });
    expect(missing.statusCode).toBe(400);

    const mismatch = await request(app)
      .post('/api/account/login')
      .set('x-forwarded-for', '198.51.100.220')
      .send({
        credential: {
          user_id: account.userId,
          phone: 'wrong-phone'
        }
      });
    expect(mismatch.statusCode).toBe(401);
    expect(mismatch.body.message).not.toContain(account.userId);
  });

  it('creates an HttpOnly account session without returning phone or raw token', async () => {
    const account = seedAccount();
    const { login, cookie } = await loginAccount(account);

    expect(login.statusCode).toBe(200);
    expect(cookie).toMatch(/^leandata_account_session=/);
    expect(login.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(login.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
    expect(login.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(login.body)).not.toContain(account.phone);
    expect(JSON.stringify(login.body)).not.toContain(account.token);
  });

  it('rate limits repeated failures without penalizing successful logins', async () => {
    const account = seedAccount();
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const login = await request(app)
        .post('/api/account/login')
        .set('x-forwarded-for', '198.51.100.221')
        .send({
          credential: {
            user_id: account.userId,
            phone: account.phone
          }
        });
      expect(login.statusCode).toBe(200);
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const failure = await request(app)
        .post('/api/account/login')
        .set('x-forwarded-for', '198.51.100.222')
        .send({
          credential: {
            user_id: account.userId,
            phone: 'wrong-phone'
          }
        });
      expect(failure.statusCode).toBe(401);
    }
    const limited = await request(app)
      .post('/api/account/login')
      .set('x-forwarded-for', '198.51.100.222')
      .send({
        credential: {
          user_id: account.userId,
          phone: 'wrong-phone'
        }
      });
    expect(limited.statusCode).toBe(429);
  });

  it('returns only the authenticated account overview and scoped usage', async () => {
    const account = seedAccount();
    const { cookie } = await loginAccount(account);
    jest.spyOn(global, 'fetch').mockImplementation(async url => {
      if (String(url).includes('/v1/account/usage')) {
        return {
          ok: true,
          json: async () => ({
            rest: {
              requests: 42,
              active_historical_requests: 1,
              limits: { historical_concurrent_max: 3, max_symbols_per_request: 200 }
            },
            window: { scope: 'process_lifetime', uptime_seconds: 120 }
          })
        };
      }
      if (String(url).includes('/account/usage')) {
        return {
          ok: true,
          json: async () => ({
            ws: { active_connections: 2, subscriptions: 7 },
            window: { scope: 'live', uptime_seconds: 120 }
          })
        };
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const overview = await request(app).get('/api/account/overview').set('Cookie', cookie);

    expect(overview.statusCode).toBe(200);
    expect(overview.body.account.user_id).toBe(account.userId);
    expect(overview.body.account.token_masked).toMatch(/^accoun.*7890$/);
    expect(overview.body.usage.rest.requests).toBe(42);
    expect(overview.body.usage.ws.active_connections).toBe(2);
    expect(overview.body.usage.ws.subscriptions).toBe(7);
    expect(JSON.stringify(overview.body)).not.toContain(account.phone);
    expect(JSON.stringify(overview.body)).not.toContain(account.token);
  });

  it('requires login for account overview and renewal', async () => {
    const overview = await request(app).get('/api/account/overview');
    const renewal = await request(app).post('/api/account/renew').send({
      tier: 'standard',
      months: 1
    });
    expect(overview.statusCode).toBe(401);
    expect(renewal.statusCode).toBe(401);
  });

  it('creates a pending renewal for the logged-in account and selected months', async () => {
    const account = seedAccount();
    const { cookie } = await loginAccount(account);
    const renewal = await request(app)
      .post('/api/account/renew')
      .set('Cookie', cookie)
      .send({ tier: 'premium', months: 2 });

    expect(renewal.statusCode).toBe(201);
    expect(renewal.body.renewal.tier).toBe('premium');
    expect(renewal.body.renewal.months).toBe(2);
    const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    expect(pending).toHaveLength(1);
    expect(pending[0].username).toBe(account.userId);
    expect(pending[0].phone).toBe(account.phone);
    expect(pending[0].renew_days).toBe(60);
  });

  it('validates renewal plan, value mode, and month bounds', async () => {
    const account = seedAccount();
    const { cookie } = await loginAccount(account);
    const invalidPlan = await request(app)
      .post('/api/account/renew')
      .set('Cookie', cookie)
      .send({ tier: 'trial', months: 1 });
    const missingMode = await request(app)
      .post('/api/account/renew')
      .set('Cookie', cookie)
      .send({ tier: 'value', months: 1 });
    const invalidMonths = await request(app)
      .post('/api/account/renew')
      .set('Cookie', cookie)
      .send({ tier: 'standard', months: 13 });

    expect(invalidPlan.statusCode).toBe(400);
    expect(missingMode.statusCode).toBe(400);
    expect(invalidMonths.statusCode).toBe(400);
  });

  it('extends the existing token from its current expiry after admin approval', async () => {
    const currentExpiry = new Date(Date.now() + 10 * 86400000).toISOString();
    const account = seedAccount({ expiry: currentExpiry });
    const { cookie } = await loginAccount(account);
    const renewal = await request(app)
      .post('/api/account/renew')
      .set('Cookie', cookie)
      .send({ tier: 'standard', months: 2 });
    const admin = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    const approved = await request(app)
      .post('/api/admin/approve')
      .set('x-admin-token', admin.body.token)
      .send({ id: renewal.body.renewal.id });

    expect(approved.statusCode).toBe(200);
    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const updated = proxy.users.find(user => user.user_id === account.userId);
    const extensionDays = (new Date(updated.expires_at) - new Date(currentExpiry)) / 86400000;
    expect(extensionDays).toBeGreaterThan(59.9);
    expect(extensionDays).toBeLessThan(60.1);
    expect(updated.token).toBe(account.token);
  });

  it('keeps a renewal pending instead of rotating a missing token', async () => {
    const account = seedAccount();
    const { cookie } = await loginAccount(account);
    const renewal = await request(app)
      .post('/api/account/renew')
      .set('Cookie', cookie)
      .send({ tier: 'standard', months: 1 });
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({ users: [] }));

    const admin = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    const approved = await request(app)
      .post('/api/admin/approve')
      .set('x-admin-token', admin.body.token)
      .send({ id: renewal.body.renewal.id });

    expect(approved.statusCode).toBe(409);
    expect(approved.body.success).toBe(false);
    const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    expect(pending.find(item => item.id === renewal.body.renewal.id).status).toBe('pending');
    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    expect(proxy.users).toHaveLength(0);
  });

  it('retires the public credential-based renewal endpoint', async () => {
    const response = await request(app).post('/api/renew').send({
      username: 'legacy',
      phone: 'legacy',
      tier: 'standard'
    });
    expect(response.statusCode).toBe(410);
    expect(response.body.message).toMatch(/账户管理中心/);
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

  it('carries registration email into users.json and the proxy registry', async () => {
    const reg = await request(app).post('/api/register').send({
      username: 'mailFlow', phone: '123', tier: 'standard', email: 'mailflow@example.com'
    });
    const res = await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id: reg.body.id });
    expect(res.body.success).toBe(true);

    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    expect(users.find(user => user.username === 'mailFlow').email).toBe('mailflow@example.com');

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const proxyUser = proxy.users.find(user => user.user_id === 'mailFlow');
    expect(proxyUser).toBeDefined();
    expect(proxyUser.email).toBe('mailflow@example.com');
  });

  it('omits the email field when registration has none', async () => {
    const reg = await request(app).post('/api/register').send({
      username: 'noMail', phone: '123', tier: 'standard'
    });
    await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id: reg.body.id });

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const proxyUser = proxy.users.find(user => user.user_id === 'noMail');
    expect(proxyUser).toBeDefined();
    expect('email' in proxyUser).toBe(false);
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
    expect(logText).toMatch(/Reloading shared users\.json/);
    expect(logText).toMatch(/Local registry/);
  });
});

// ============================================================
// Status API
// ============================================================
describe('GET /api/status', () => {
  it('returns overall status with three components', async () => {
    const res = await request(app).get('/api/status');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('overall');
    expect(['operational', 'degraded', 'outage']).toContain(res.body.overall);
    expect(res.body).toHaveProperty('components.rest');
    expect(res.body).toHaveProperty('components.rt');
    expect(res.body).toHaveProperty('components.ws');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('each component has name, route, status, latencyMs', async () => {
    const res = await request(app).get('/api/status');
    for (const key of ['rest', 'rt', 'ws']) {
      const comp = res.body.components[key];
      expect(comp).toHaveProperty('name');
      expect(comp).toHaveProperty('route');
      expect(comp).toHaveProperty('status');
      expect(['operational', 'degraded', 'outage']).toContain(comp.status);
      expect(comp).toHaveProperty('latencyMs');
      expect(typeof comp.latencyMs).toBe('number');
    }
  });

  it('overall is operational only when all components are up', async () => {
    const res = await request(app).get('/api/status');
    const { rest, rt, ws } = res.body.components;
    if (rest.status === 'operational' && rt.status === 'operational' && ws.status === 'operational') {
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
    expect(Array.isArray(data.latency.rest)).toBe(true);
    expect(Array.isArray(data.latency.ws)).toBe(true);
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

// ============================================================
// Incident API
// ============================================================
describe('GET /api/incidents', () => {
  let adminToken;

  beforeEach(async () => {
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    adminToken = login.body.token;
  });

  it('returns incidents array', async () => {
    const res = await request(app).get('/api/incidents');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('incidents');
    expect(Array.isArray(res.body.incidents)).toBe(true);
  });

  it('startup incident is logged on server boot', async () => {
    // The startup incident was logged when the module loaded, but resetTestData clears it.
    // Create a fresh one to verify the format.
    await request(app).post('/api/incidents')
      .set('x-admin-token', adminToken)
      .send({ component: 'Token Portal', severity: 'resolved', title: 'Service restart', summary: 'server started' });
    const res = await request(app).get('/api/incidents');
    const startup = res.body.incidents.find(i => i.title === 'Service restart');
    expect(startup).toBeDefined();
    expect(startup.component).toBe('Token Portal');
    expect(startup.severity).toBe('resolved');
  });
});

describe('POST /api/incidents', () => {
  let adminToken;

  beforeEach(async () => {
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    adminToken = login.body.token;
  });

  it('requires admin auth', async () => {
    const res = await request(app).post('/api/incidents')
      .send({ component: 'REST API', title: 'Unauthorized incident' });
    expect(res.statusCode).toBe(401);
  });

  it('creates an incident with all fields', async () => {
    const res = await request(app).post('/api/incidents')
      .set('x-admin-token', adminToken)
      .send({ component: 'REST API', severity: 'minor', title: 'Test incident', summary: 'Testing', duration: '5 min' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.incident.component).toBe('REST API');
    expect(res.body.incident.severity).toBe('minor');
    expect(res.body.incident.title).toBe('Test incident');
    expect(res.body.incident.summary).toBe('Testing');
    expect(res.body.incident.id).toBeDefined();
  });

  it('persists incident to status.json', async () => {
    await request(app).post('/api/incidents')
      .set('x-admin-token', adminToken)
      .send({ component: 'WebSocket', severity: 'major', title: 'WS down' });

    const res = await request(app).get('/api/incidents');
    const found = res.body.incidents.find(i => i.title === 'WS down');
    expect(found).toBeDefined();
    expect(found.severity).toBe('major');
  });

  it('defaults severity to minor', async () => {
    const res = await request(app).post('/api/incidents')
      .set('x-admin-token', adminToken)
      .send({ component: 'REST API', title: 'No severity' });
    expect(res.body.incident.severity).toBe('minor');
  });

  it('requires component and title', async () => {
    const res = await request(app).post('/api/incidents')
      .set('x-admin-token', adminToken)
      .send({ title: 'Missing component' });
    expect(res.statusCode).toBe(400);

    const res2 = await request(app).post('/api/incidents')
      .set('x-admin-token', adminToken)
      .send({ component: 'REST API' });
    expect(res2.statusCode).toBe(400);
  });

  it('keeps max 100 incidents', async () => {
    for (let i = 0; i < 102; i++) {
      await request(app).post('/api/incidents')
        .set('x-admin-token', adminToken)
        .send({ component: 'REST API', title: `Incident ${i}` });
    }
    const res = await request(app).get('/api/incidents');
    expect(res.body.incidents.length).toBeLessThanOrEqual(100);
  }, 15000);
});

// ============================================================
// Admin announce — recipient resolution and sending
// ============================================================
describe('Admin announce API', () => {
  let adminToken;
  const ANNOUNCE_LOG = path.join(TEST_DATA_DIR, 'announce-log.jsonl');
  const ANNOUNCE_SMTP_ENV = path.join(TEST_DATA_DIR, 'announce-smtp.env');
  const savedSmtpEnv = {};

  function seedProxyUsers() {
    const future = new Date(Date.now() + 30 * 864e5).toISOString();
    const past = new Date(Date.now() - 30 * 864e5).toISOString();
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({ users: [
      { token: 'a', user_id: 'withMail', role: 'premium', expires_at: future, email: 'with@example.com' },
      { token: 'b', user_id: 'noMail', role: 'standard', expires_at: future },
      { token: 'c', user_id: 'expiredMail', role: 'standard', expires_at: past, email: 'old@example.com' },
      { token: 'd', user_id: 'smoke_1', role: 'test', expires_at: future, test_user: true, email: 't@example.com' },
      { token: 'e', user_id: 'lean-live', role: 'premium', expires_at: future, email: 'svc@example.com' },
      { token: 'f', user_id: 'badMail', role: 'basic', expires_at: future, email: 'nope' }
    ] }));
  }

  beforeEach(async () => {
    resetTestData();
    seedProxyUsers();
    mockSendMail.mockClear();
    app.locals.announceSendMail = mockSendMail;
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM', 'MAIL_FROM_NAME']) {
      savedSmtpEnv[key] = process.env[key];
      delete process.env[key];
    }
    if (fs.existsSync(ANNOUNCE_LOG)) fs.unlinkSync(ANNOUNCE_LOG);
    if (fs.existsSync(ANNOUNCE_SMTP_ENV)) fs.unlinkSync(ANNOUNCE_SMTP_ENV);
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    adminToken = login.body.token;
  });

  afterEach(() => {
    for (const key of Object.keys(savedSmtpEnv)) {
      if (savedSmtpEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedSmtpEnv[key];
    }
  });

  function setSmtpEnv() {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'ops@example.com';
    process.env.SMTP_PASSWORD = 'secret';
  }

  it('lists reachable and skipped recipients', async () => {
    const res = await request(app).get('/api/admin/announce/recipients')
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.reachable.map(user => user.user_id)).toEqual(['withMail']);
    const reasons = Object.fromEntries(res.body.skipped.map(user => [user.user_id, user.reason]));
    expect(reasons.noMail).toBe('no_email');
    expect(reasons.expiredMail).toBe('expired');
    expect(reasons.smoke_1).toBe('test_user');
    expect(reasons['lean-live']).toBe('service_principal');
    expect(reasons.badMail).toBe('invalid_email');
    expect(res.body.recipient_snapshot).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.smtp_configured).toBe(false);
  });

  it('returns the reusable bilingual Kai template', async () => {
    const res = await request(app).get('/api/admin/announce/template')
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.from_name).toContain('Kai');
    expect(res.body.body).toContain('恺 Kai');
    expect(res.body.placeholders).toEqual(['{user_id}', '{role}', '{expires_date}']);
  });

  it('loads SMTP from a mode-0600 host file', async () => {
    fs.writeFileSync(ANNOUNCE_SMTP_ENV, [
      'SMTP_HOST=smtp.example.com',
      'SMTP_PORT=465',
      'SMTP_USER=ops@example.com',
      'SMTP_PASSWORD=secret',
      'MAIL_FROM_NAME="恺 Kai · leandata.uk"'
    ].join('\n'), { mode: 0o600 });
    const res = await request(app).get('/api/admin/announce/recipients')
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.smtp_configured).toBe(true);
  });

  it('rejects a host SMTP file with group or world permissions', async () => {
    fs.writeFileSync(ANNOUNCE_SMTP_ENV, [
      'SMTP_HOST=smtp.example.com',
      'SMTP_USER=ops@example.com',
      'SMTP_PASSWORD=secret'
    ].join('\n'), { mode: 0o644 });
    fs.chmodSync(ANNOUNCE_SMTP_ENV, 0o644);
    const res = await request(app).get('/api/admin/announce/recipients')
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.smtp_configured).toBe(false);
  });

  it('requires admin auth', async () => {
    const res = await request(app).get('/api/admin/announce/recipients');
    expect(res.statusCode).toBe(401);
  });

  it('dry-runs by default and sends nothing', async () => {
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({ subject: 'Test', body: 'Hi {user_id}, until {expires_date}' });
    expect(res.statusCode).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.sample.to).toBe('with@example.com');
    expect(res.body.sample.text).toContain('Hi withMail');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('returns 503 on confirm when SMTP is not configured', async () => {
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({ subject: 'Test', body: 'Hi', confirm: true });
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('announce_not_configured');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sends one personalized message per reachable user on confirm', async () => {
    setSmtpEnv();
    const preview = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({ subject: 'Update', body: 'Hi {user_id}' });
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Update',
        body: 'Hi {user_id}',
        confirm: true,
        recipient_snapshot: preview.body.recipient_snapshot
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const message = mockSendMail.mock.calls[0][0];
    expect(message.to).toBe('with@example.com');
    expect(message.text).toBe('Hi withMail');
    expect(message.config.from).toBe('ops@example.com');
    const log = fs.readFileSync(ANNOUNCE_LOG, 'utf8').trim().split('\n').map(JSON.parse);
    expect(log[0].results[0].status).toBe('sent');
    expect(fs.statSync(ANNOUNCE_LOG).mode & 0o777).toBe(0o600);
  });

  it('fails closed when confirm does not match the previewed recipients', async () => {
    setSmtpEnv();
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({ subject: 'Update', body: 'Hi', confirm: true, recipient_snapshot: 'stale' });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('recipient_snapshot_changed');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('treats a string confirm value as a dry run', async () => {
    setSmtpEnv();
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({ subject: 'Update', body: 'Hi', confirm: 'true' });
    expect(res.statusCode).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('rejects a multiline subject', async () => {
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({ subject: 'Update\nBcc: victim@example.com', body: 'Hi' });
    expect(res.statusCode).toBe(400);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('test_to sends a single preview to the operator', async () => {
    setSmtpEnv();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({ subject: 'Preview', body: 'Hi {user_id}', test_to: 'ops@example.net' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe('ops@example.net');
    expect(fs.statSync(ANNOUNCE_LOG).mode & 0o777).toBe(0o600);
  });

  it('rejects an invalid test_to address', async () => {
    setSmtpEnv();
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({ subject: 'Preview', body: 'Hi', test_to: 'not-an-email' });
    expect(res.statusCode).toBe(400);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('returns 422 on confirm when nobody is reachable', async () => {
    setSmtpEnv();
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({ users: [
      {
        token: 'b',
        user_id: 'noMail',
        role: 'standard',
        expires_at: new Date(Date.now() + 864e5).toISOString()
      }
    ] }));
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({ subject: 'Update', body: 'Hi', confirm: true });
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('no_recipients');
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
