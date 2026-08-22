const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Set up isolated temp dirs BEFORE requiring server
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-test-'));
const TEST_DATA_DIR = path.join(TEST_DIR, 'data');
const TEST_PROXY_FILE = path.join(TEST_DIR, 'proxy-users.json');
const TEST_ACCESS_LOG_DIR = path.join(TEST_DIR, 'access');
const TEST_ATTRIBUTION_USAGE_LOG = path.join(TEST_DIR, 'attribution-usage.jsonl');
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
fs.mkdirSync(TEST_ACCESS_LOG_DIR, { recursive: true });

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.PROXY_USERS_FILE = TEST_PROXY_FILE;
process.env.THINKCENTRE_HOST = 'nobody@127.0.0.1'; // prevent real sync
process.env.BYPASS_SYNC = 'true';                 // skip SCP to EC2 in tests
process.env.PROXY_RT_URL = 'http://127.0.0.1:1'; // prevent real rt-api probe in tests
process.env.PROXY_REST_URL = 'http://127.0.0.1:1'; // prevent real REST proxy calls in tests
process.env.PROXY_WS_HOST = '127.0.0.1';         // fast-fail WS probe (ECONNREFUSED)
process.env.PROXY_WS_PORT = '1';
process.env.ACCESS_LOG_DIR = TEST_ACCESS_LOG_DIR;
process.env.EMAIL_VERIFY_SECRET = 'test-email-verification-secret';
process.env.EMAIL_TEST_MODE = 'memory';
process.env.EMAIL_CODE_RESEND_COOLDOWN_MS = '0';

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'mock' });

const request = require('supertest');
const server = require('./server');
const {
  app,
  TIERS,
  computeExpiry,
  getLastTestVerificationEmail,
  clearTestVerificationEmails,
  __resetUsageAggregatorForTest,
  __refreshUsageAggregatorForTest,
  __setUsageAggregatorTestHooks
} = server;

const USERS_FILE = path.join(TEST_DATA_DIR, 'users.json');
const PENDING_FILE = path.join(TEST_DATA_DIR, 'pending.json');
const BULK_ORDERS_FILE = path.join(TEST_DATA_DIR, 'bulk-orders.json');
const PAYMENT_ORDERS_FILE = path.join(TEST_DATA_DIR, 'payment-orders.json');
const PRODUCT_FEEDBACK_FILE = path.join(TEST_DATA_DIR, 'product-update-feedback.json');
const ADMIN_PASSWORD_FILE = path.join(TEST_DATA_DIR, 'admin-password.env');
const STRIPE_PAYMENT_ENV_FILE = path.join(TEST_DATA_DIR, 'stripe-payment.env');
const ZPAY_PAYMENT_ENV_FILE = path.join(TEST_DATA_DIR, 'zpay-payment.env');
const EMAIL_VERIFICATION_FILE = path.join(TEST_DATA_DIR, 'email-verifications.json');
const EMAIL_TEMPLATE_FILE = path.join(TEST_DATA_DIR, 'email-template.json');

function generateStripeTestHeader(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function generateZpaySignature(parameters, key) {
  const canonical = Object.entries(parameters)
    .filter(([name, value]) => name !== 'sign' && name !== 'sign_type' && value !== undefined && value !== null && String(value) !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join('&');
  return crypto.createHash('md5').update(`${canonical}${key}`, 'utf8').digest('hex');
}

function resetTestData() {
  if (fs.existsSync(TEST_PROXY_FILE) && fs.lstatSync(TEST_PROXY_FILE).isDirectory()) {
    fs.rmSync(TEST_PROXY_FILE, { recursive: true, force: true });
  }
  fs.writeFileSync(USERS_FILE, '[]');
  fs.writeFileSync(PENDING_FILE, '[]');
  fs.writeFileSync(BULK_ORDERS_FILE, '[]');
  fs.writeFileSync(PAYMENT_ORDERS_FILE, '[]');
  if (fs.existsSync(PRODUCT_FEEDBACK_FILE)) fs.unlinkSync(PRODUCT_FEEDBACK_FILE);
  fs.writeFileSync(TEST_PROXY_FILE, '{"users":[]}');
  if (fs.existsSync(ADMIN_PASSWORD_FILE)) fs.unlinkSync(ADMIN_PASSWORD_FILE);
  if (fs.existsSync(STRIPE_PAYMENT_ENV_FILE)) fs.unlinkSync(STRIPE_PAYMENT_ENV_FILE);
  if (fs.existsSync(ZPAY_PAYMENT_ENV_FILE)) fs.unlinkSync(ZPAY_PAYMENT_ENV_FILE);
  if (fs.existsSync(EMAIL_VERIFICATION_FILE)) fs.unlinkSync(EMAIL_VERIFICATION_FILE);
  if (fs.existsSync(EMAIL_TEMPLATE_FILE)) fs.unlinkSync(EMAIL_TEMPLATE_FILE);
  clearTestVerificationEmails();
  // Clean status data so status/uptime/latency tests start fresh
  const statusFile = path.join(TEST_DATA_DIR, 'status.json');
  if (fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
}

beforeEach(() => {
  resetTestData();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

async function registerRequest(body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return request(app).post('/api/register').send(body);
  const codeResponse = await request(app)
    .post('/api/register/request-code')
    .send({ email });
  if (codeResponse.statusCode !== 202) return codeResponse;
  const captured = getLastTestVerificationEmail();
  return request(app).post('/api/register').send({
    ...body,
    email,
    verification_id: codeResponse.body.challenge_id,
    verification_code: captured.code
  });
}

afterEach(() => {
  delete process.env.PAYMENT_MOCK_ENABLED;
  delete process.env.PAYMENT_WECHAT_ENABLED;
  delete process.env.PAYMENT_PUBLIC_BASE_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.ZPAY_PID;
  delete process.env.ZPAY_KEY;
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
    expect(tiers).toContain('free');
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

  it('free tier grants all listed channels with its bounded role', () => {
    expect(TIERS.free.role).toBe('free');
    expect(TIERS.free.permissions.ws.stocks).toBe(true);
    expect(TIERS.free.permissions.ws.options).toBe(true);
    expect(TIERS.free.permissions.rest.crypto_orderbooks).toBe(true);
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

describe('GET /api/admin/attribution', () => {
  let adminToken;
  const day = new Date().toISOString().slice(0, 10);
  const accessLog = path.join(TEST_ACCESS_LOG_DIR, `access-${day}.jsonl`);
  const sourceIpHash = 'a'.repeat(64);
  const credentialHash = 'b'.repeat(64);

  const accessEvent = (overrides = {}) => ({
    event: 'http_access',
    attribution_schema: 'request_attribution_v2',
    source_ip_hash: sourceIpHash,
    credential_hash: credentialHash,
    ua_category: 'sdk',
    method: 'GET',
    path: '/v2/stocks/bars',
    user_id: 'attribution-user',
    user_role: 'premium',
    status: 401,
    timestamp: new Date().toISOString(),
    source_ip: '203.0.113.77',
    authorization: 'must-not-leak',
    ...overrides
  });

  beforeAll(async () => {
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    adminToken = login.body.token;
  });

  beforeEach(() => {
    fs.mkdirSync(TEST_ACCESS_LOG_DIR, { recursive: true });
    fs.writeFileSync(accessLog, `${JSON.stringify(accessEvent())}\n${JSON.stringify({
      event: 'http_access',
      status: 200,
      timestamp: new Date().toISOString()
    })}\n`);
    fs.writeFileSync(TEST_ATTRIBUTION_USAGE_LOG, `${JSON.stringify({
      event: 'ws_session',
      attribution_schema: 'request_attribution_v2',
      source_ip: '203.0.113.77',
      source_ip_hash: sourceIpHash,
      credential_hash: credentialHash,
      ua_category: 'sdk',
      user_id: 'attribution-user',
      user_role: 'premium',
      mode: 'stocks',
      status: 200,
      timestamp: new Date().toISOString()
    })}\n`);
    process.env.USAGE_LOG_PATH = TEST_ATTRIBUTION_USAGE_LOG;
  });

  test('requires admin authentication', async () => {
    const res = await request(app).get('/api/admin/attribution');
    expect(res.statusCode).toBe(401);
  });

  test('returns bounded HTTP and WS source IPs without credential leakage', async () => {
    const res = await request(app)
      .get(`/api/admin/attribution?day=${day}&lines=5000`)
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.schema_version).toBe('request_attribution_summary_v2');
    expect(res.body.summary.total).toBe(2);
    expect(res.body.summary.errors).toBe(1);
    expect(res.body.summary.unique_source_ips).toBe(1);
    expect(res.body.sources.access.state).toBe('available');
    expect(res.body.sources.usage.state).toBe('available');
    expect(res.body.recent_events.map(event => event.transport).sort()).toEqual(['http', 'ws']);
    const serialized = JSON.stringify(res.body);
    expect(serialized).toContain('203.0.113.77');
    expect(serialized).not.toContain('must-not-leak');
  });

  test('filters by status, path, and source IP', async () => {
    const base = `/api/admin/attribution?day=${day}&source_ip=203.0.113.77`;
    const matching = await request(app)
      .get(`${base}&status=401&path=%2Fv2%2Fstocks%2Fbars`)
      .set('x-admin-token', adminToken);
    expect(matching.statusCode).toBe(200);
    expect(matching.body.summary.total).toBe(1);
    expect(matching.body.recent_events[0].transport).toBe('http');

    const missing = await request(app)
      .get(`${base}&status=429`)
      .set('x-admin-token', adminToken);
    expect(missing.statusCode).toBe(200);
    expect(missing.body.summary.total).toBe(0);
  });

  test('retains the non-secret anonymous credential marker for unauthenticated traffic', async () => {
    fs.writeFileSync(accessLog, `${JSON.stringify(accessEvent({
      credential_hash: 'none',
      user_id: null
    }))}\n`);
    const res = await request(app)
      .get(`/api/admin/attribution?day=${day}`)
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.summary.total).toBe(2);
    expect(res.body.recent_events.some(event => event.credential_hash === 'none')).toBe(true);
  });

  test('ships on-demand request attribution controls without slowing the usage refresh', () => {
    const source = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8');
    expect(source).toContain('请求归因');
    expect(source).toContain('/api/admin/attribution');
    expect(source).toContain('IP 与归属地估计');
    expect(source).toContain('加载归因');
    expect(source).toContain('if (attributionLoading) return;');
    expect(source).not.toContain('          loadAttribution();');
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
    const res = await registerRequest({ username: 'test' });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('ignores any client-selected paid tier and keeps registration Free-only', async () => {
    const res = await registerRequest({
      username: 'test', phone: '123', tier: 'premium', email: 'test@example.com'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('registration_is_free_only');
    expect(JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))).toEqual([]);
  });

  it('does not create a pending payment record during registration', async () => {
    const res = await registerRequest({
      username: 'free-only', phone: '123', email: 'free-only@example.com'
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.tier).toBe('free');
    expect(res.body.checkout_token).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))).toEqual([]);
  });

  it('activates Free immediately and returns its bounded current plan', async () => {
    const response = await registerRequest({
      username: 'free-user',
      phone: '123',
      email: 'free-user@example.com',
      tier: 'free'
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      status: 'approved',
      tier: 'free',
      role: 'free',
      current_plan: {
        id: 'free',
        name: 'Free',
        rest_history_window_days: 31,
        ws_subscription_limit: 10
      }
    }));
    expect(response.body.token).toEqual(expect.any(String));
    expect(JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))[0]).toEqual(expect.objectContaining({
      username: 'free-user',
      tier: 'free',
      role: 'free'
    }));
  });

  it('does not expose a Free account as active when registry provisioning fails', async () => {
    const rename = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === TEST_PROXY_FILE) throw new Error('simulated registry write failure');
      return rename(source, destination);
    });
    const response = await registerRequest({
      username: 'free-sync-failure',
      phone: '123',
      email: 'free-sync-failure@example.com',
      tier: 'free'
    });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8')).users).toEqual([]);
  });

  it('supports the production single-file registry bind mount', async () => {
    const rename = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === TEST_PROXY_FILE) {
        const error = new Error('device or resource busy');
        error.code = 'EBUSY';
        throw error;
      }
      return rename(source, destination);
    });
    const response = await registerRequest({
      username: 'bind-mounted-registry',
      phone: '123',
      email: 'bind-mounted-registry@example.com',
      tier: 'free'
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8')).users).toHaveLength(1);
  });

  it('matches the full identity tuple, not username alone', async () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: ' legacy-user ',
      phone: '123',
      role: 'standard',
      email: 'legacy@example.com'
    }]));
    const response = await registerRequest({
      username: 'legacy-user',
      phone: '123',
      email: 'legacy-user@example.com',
      tier: 'free'
    });
    expect(response.statusCode).toBe(200);
  });

  it('is idempotent for an exact identity and separates same usernames with other tuple values', async () => {
    const first = await registerRequest({
      username: 'dup', phone: '1', email: 'dup@example.com'
    });
    const same = await registerRequest({
      username: 'dup', phone: '1', email: 'dup@example.com'
    });
    const other = await registerRequest({
      username: 'dup', phone: '2', email: 'dup2@example.com'
    });
    expect(first.statusCode).toBe(201);
    expect(same.statusCode).toBe(200);
    expect(same.body.status).toBe('existing_account');
    expect(same.body.token).toBeUndefined();
    expect(other.statusCode).toBe(201);
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    expect(users).toHaveLength(2);
    expect(users[0].account_id).not.toBe(users[1].account_id);
  });

  it('returns the existing Free account for repeated registration', async () => {
    const first = await registerRequest({
      username: 'resume-user',
      phone: '6045550101',
      email: 'resume@example.com'
    });
    expect(first.statusCode).toBe(201);
    expect(first.body.status).toBe('approved');

    const resumed = await registerRequest({
      username: 'resume-user',
      phone: '6045550101',
      email: 'resume@example.com'
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.body.status).toBe('existing_account');
    expect(resumed.body.token).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))).toEqual([]);
  });

  it('defaults to Free when tier omitted', async () => {
    await registerRequest({
      username: 'noTier', phone: '1', email: 'notier@example.com'
    });
    const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    expect(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))[0].tier).toBe('free');
  });

  it('does not expose paid tier validation on registration', async () => {
    const res = await registerRequest({
      username: 'valueNoMode', phone: '1', tier: 'value', email: 'value@example.com'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('registration_is_free_only');
  });

  it('ignores paid mode on registration', async () => {
    const res = await registerRequest({
      username: 'valueUser',
      phone: '1',
      tier: 'value',
      mode: 'options',
      email: 'valueuser@example.com'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('registration_is_free_only');
  });

  it('returns 400 for an invalid email', async () => {
    const res = await registerRequest({
      username: 'badMail', phone: '1', tier: 'standard', email: 'not-an-email'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('allows registration without an email', async () => {
    const res = await registerRequest({
      username: 'noMail', phone: '1', tier: 'free'
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('approved');
    expect(JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))).toEqual([]);
  });

  it('rejects paid Basic registration tier', async () => {
    const res = await registerRequest({
      username: 'oldBasic', phone: '1', tier: 'basic', email: 'basic@example.com'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('registration_is_free_only');
  });

  it('stores an optional email on the Free account', async () => {
    const res = await registerRequest({
      username: 'mailUser', phone: '1', tier: 'free', email: 'mailuser@example.com'
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))[0].email).toBe('mailuser@example.com');
  });
});

describe('Email verification and registration template', () => {
  it('sends a six-digit code and accepts the matching challenge', async () => {
    const email = 'verification@example.com';
    const requested = await request(app)
      .post('/api/register/request-code')
      .send({ email });
    expect(requested.statusCode).toBe(202);
    expect(requested.body.challenge_id).toEqual(expect.any(String));

    const captured = getLastTestVerificationEmail();
    expect(captured.email).toBe(email);
    expect(captured.code).toMatch(/^\d{6}$/);
    const stored = JSON.parse(fs.readFileSync(EMAIL_VERIFICATION_FILE, 'utf8'))[0];
    expect(stored.code_hash).not.toContain(captured.code);

    const registered = await request(app).post('/api/register').send({
      email,
      verification_id: requested.body.challenge_id,
      verification_code: captured.code,
      username: 'verified-user',
      phone: '123',
      tier: 'free'
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.body.message).toContain('Free 计划已启用');
    expect(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))[0]).toEqual(expect.objectContaining({
      email,
      email
    }));
  });

  it('does not require an email challenge for registration', async () => {
    const requested = await request(app)
      .post('/api/register/request-code')
      .send({ email: 'wrong-code@example.com' });
    const response = await request(app).post('/api/register').send({
      email: 'wrong-code@example.com',
      verification_id: requested.body.challenge_id,
      verification_code: '000000',
      username: 'wrong-code-user',
      phone: '123',
      tier: 'free'
    });
    expect(response.statusCode).toBe(201);
    expect(response.body.status).toBe('approved');
    expect(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))).toHaveLength(1);
  });

  it('allows an admin to read and update the registration email template', async () => {
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    expect(login.statusCode).toBe(200);
    const headers = { 'x-admin-token': login.body.token };
    const current = await request(app).get('/api/admin/email-template').set(headers);
    expect(current.statusCode).toBe(200);
    expect(current.body.template.text).toContain('{{code}}');

    const saved = await request(app)
      .put('/api/admin/email-template')
      .set(headers)
      .send({
        subject: 'Verify {{site_name}}',
        text: 'Code: {{code}} ({{expires_minutes}} minutes)',
        html: '<p>Code: <strong>{{code}}</strong></p>'
      });
    expect(saved.statusCode).toBe(200);
    expect(saved.body.preview.text).toContain('123456');
    expect(JSON.parse(fs.readFileSync(EMAIL_TEMPLATE_FILE, 'utf8')).subject)
      .toBe('Verify {{site_name}}');
  });
});

// ============================================================
// Bulk download estimates and orders
// ============================================================
describe('Bulk download API', () => {
  const estimateFixture = {
    schema_version: 'bulk_estimate_v1',
    estimated_raw_bytes: 42_000_000_000,
    estimated_transfer_bytes: 8_400_000_000,
    pricing: {
      estimated_price: 50,
      currency: 'CNY'
    }
  };

  function mockEstimate() {
    return jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => estimateFixture
    });
  }

  it('normalizes and deduplicates tickers and forwards production schemas', async () => {
    const fetchMock = mockEstimate();
    const res = await request(app).post('/api/bulk/estimate').send({
      tickers: ['aapl', ' AAPL ', 'msft'],
      schemas: ['stock_minute', 'stock_minute', 'options_oi'],
      start: '2026-01-01',
      end: '2026-07-22'
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:1/v1/bulk/estimate');
    expect(JSON.parse(options.body)).toEqual({
      tickers: ['AAPL', 'MSFT'],
      schemas: ['stock_minute', 'options_oi']
    });
    expect(options.body).not.toContain('datasets');
    expect(res.body.requested_range).toEqual({
      start: '2026-01-01',
      end: '2026-07-22'
    });
  });

  it('accepts each of the six production-supported schema IDs', async () => {
    const fetchMock = mockEstimate();
    const schemas = [
      'options_eod_theta',
      'options_eod_alpaca',
      'options_oi',
      'options_contracts',
      'stock_minute',
      'stock_daily'
    ];
    const res = await request(app).post('/api/bulk/estimate').send({
      tickers: ['AAPL'],
      schemas
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).schemas).toEqual(schemas);
  });

  it('rejects unsupported schemas before contacting the estimator', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await request(app).post('/api/bulk/estimate').send({
      tickers: ['AAPL'],
      schemas: ['unsupported_schema']
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_bulk_request');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an inverted date range before contacting the estimator', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await request(app).post('/api/bulk/estimate').send({
      tickers: ['AAPL'],
      schemas: ['stock_daily'],
      start: '2026-07-22',
      end: '2026-01-01'
    });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a measured dataset or a custom endpoint description', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await request(app).post('/api/bulk/orders').send({
      username: 'kai',
      phone: '123',
      email: 'kai@example.com',
      tickers: [],
      schemas: []
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_bulk_request');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns manual_quote_required when estimating a custom-only request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await request(app).post('/api/bulk/estimate').send({
      schemas: [],
      custom_request: 'Historical daily GEX snapshots for SPY and QQQ.'
    });
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('manual_quote_required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires username, phone, and email for an order', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await request(app).post('/api/bulk/orders').send({
      tickers: ['AAPL'],
      schemas: ['stock_daily'],
      username: 'kai'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('contact_required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid order email', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await request(app).post('/api/bulk/orders').send({
      tickers: ['AAPL'],
      schemas: ['stock_daily'],
      username: 'kai',
      phone: '123',
      email: 'not-an-email'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_email');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists the server-side estimate with the order', async () => {
    mockEstimate();
    const res = await request(app).post('/api/bulk/orders').send({
      tickers: ['aapl', 'msft'],
      schemas: ['stock_daily'],
      start: '2026-01-01',
      end: '2026-07-22',
      username: 'Kai',
      phone: '123',
      email: 'kai@example.com',
      note: 'CSV preferred'
    });
    expect(res.statusCode).toBe(201);

    const orders = JSON.parse(fs.readFileSync(BULK_ORDERS_FILE, 'utf8'));
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      status: 'pending',
      username: 'Kai',
      email: 'kai@example.com',
      tickers: ['AAPL', 'MSFT'],
      schemas: ['stock_daily'],
      estimate: estimateFixture
    });
    expect(orders[0].quote_mode).toBe('measured');
  });

  it('persists a custom-only endpoint request for manual quoting without estimator access', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await request(app).post('/api/bulk/orders').send({
      schemas: [],
      tickers: [],
      custom_request: 'Need historical daily /v1/options/snapshot/gex output for SPY and QQQ as CSV.',
      start: '2024-01-01',
      end: '2026-07-22',
      username: 'Custom Buyer',
      phone: '6045550100',
      email: 'buyer@example.com'
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.quote_mode).toBe('manual');
    expect(res.body.manual_quote_required).toBe(true);
    expect(res.body.estimated_price).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const orders = JSON.parse(fs.readFileSync(BULK_ORDERS_FILE, 'utf8'));
    expect(orders[0]).toMatchObject({
      status: 'pending',
      quote_mode: 'manual',
      username: 'Custom Buyer',
      email: 'buyer@example.com',
      schemas: [],
      tickers: [],
      estimate: null,
      custom_request: 'Need historical daily /v1/options/snapshot/gex output for SPY and QQQ as CSV.'
    });
  });

  it('requires admin auth to list and update bulk orders', async () => {
    const list = await request(app).get('/api/admin/bulk-orders');
    const update = await request(app)
      .post('/api/admin/bulk-orders/missing/status')
      .send({ status: 'fulfilled' });
    expect(list.statusCode).toBe(401);
    expect(update.statusCode).toBe(401);
  });

  it('computes the final byte-based price when an admin fulfills an order', async () => {
    mockEstimate();
    const order = await request(app).post('/api/bulk/orders').send({
      tickers: ['AAPL'],
      schemas: ['stock_daily'],
      username: 'Kai',
      phone: '123',
      email: 'kai@example.com'
    });
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    const update = await request(app)
      .post(`/api/admin/bulk-orders/${order.body.order_id}/status`)
      .set('x-admin-token', login.body.token)
      .send({
        status: 'fulfilled',
        actual_raw_bytes: 50_000_000_001
      });
    expect(update.statusCode).toBe(200);
    expect(update.body.final_price).toBe(51);
    expect(update.body.currency).toBe('CNY');
  });

  it('lets an admin store a manual quote and retrieve the order with contact details', async () => {
    const order = await request(app).post('/api/bulk/orders').send({
      schemas: [],
      custom_request: 'Need an endpoint that is not listed.',
      username: 'Manual Quote User',
      phone: '123456789',
      email: 'manual@example.com'
    });
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    const update = await request(app)
      .post(`/api/admin/bulk-orders/${order.body.order_id}/status`)
      .set('x-admin-token', login.body.token)
      .send({
        status: 'approved',
        quoted_price: 88.5,
        admin_note: 'Contacted by email'
      });
    expect(update.statusCode).toBe(200);
    expect(update.body.quoted_price).toBe(88.5);

    const list = await request(app)
      .get('/api/admin/bulk-orders')
      .set('x-admin-token', login.body.token);
    expect(list.statusCode).toBe(200);
    expect(list.body.orders[0]).toMatchObject({
      id: order.body.order_id,
      status: 'approved',
      quoted_price: 88.5,
      admin_note: 'Contacted by email',
      phone: '123456789',
      email: 'manual@example.com',
      custom_request: 'Need an endpoint that is not listed.'
    });
  });
});

describe('Registration and bulk product UI contract', () => {
  const registerSource = fs.readFileSync(
    path.join(__dirname, 'public', 'register-page.jsx'),
    'utf8'
  );
  const docsSource = fs.readFileSync(
    path.join(__dirname, 'public', 'docs', 'docs-site.jsx'),
    'utf8'
  );
  const rootDocsSource = fs.readFileSync(
    path.join(__dirname, 'public', 'docs-site.jsx'),
    'utf8'
  );
  const tokenPageSource = fs.readFileSync(
    path.join(__dirname, 'public', 'token-page.jsx'),
    'utf8'
  );
  const rootIndexSource = fs.readFileSync(
    path.join(__dirname, 'public', 'index.html'),
    'utf8'
  );
  const docsIndexSource = fs.readFileSync(
    path.join(__dirname, 'public', 'docs', 'index.html'),
    'utf8'
  );

  it('keeps registration on username and phone and replaces the Basic card with Bulk Download', () => {
    expect(registerSource).toContain('required');
    expect(registerSource).toContain('用户名和手机号共同确定账户');
    expect(registerSource).not.toContain('/api/register/request-code');
    expect(registerSource).toContain('Bulk Download');
    expect(registerSource).toContain('/docs/#bulk');
    expect(registerSource).not.toContain('id: "basic"');
  });

  it('documents neutral market and financial endpoint categories', () => {
    expect(docsSource).toContain('en: "Market data"');
    expect(docsSource).toContain('zh: "行情数据"');
    expect(docsSource).toContain('en: "Financial data"');
    expect(docsSource).toContain('zh: "财务数据"');
    expect(docsSource).toContain('/v1/history/bars');
    expect(docsSource).toContain('/stable/income-statement');
  });

  it('documents the deployed REST concurrency and uncapped paid WebSocket connection contract', () => {
    for (const source of [docsSource]) {
      expect(source).toContain('ordinary accounts may have up to <strong>3</strong> requests in flight');
      expect(source).toContain('WebSocket accounts have no account-level connection cap');
      expect(source).toContain('Each connection supports up to 500 subjects');
      expect(source).toContain('subscribing to the same subject on two connections counts twice');
      expect(source).toContain('two paid accounts may each open 100 WebSocket connections');
      expect(source).toContain('redistribute locally through a local proxy');
      expect(source).not.toContain('Connection limit exceeded: 3/3 active websockets');
      expect(source).not.toContain('Premium",  "10",  "\\u221E"');
      expect(source).not.toContain('Premium",  "6000"');
    }
    expect(registerSource).toContain('restParallel: 3');
    expect(registerSource).toContain('wsConns: "∞"');
    expect(registerSource).not.toContain('restParallel: 10');
  });

  it('keeps endpoint guidance focused on public request contracts', () => {
    expect(docsSource).toContain('Each endpoint defines its own fields, timeframes, limits, and availability.');
    expect(docsSource).toContain('每个端点均定义自己的字段、时间周期、限制与可用范围。');
  });

  it('keeps bulk ordering behavior covered by the server contract', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    expect(serverSource).toContain('manual_quote_required');
    expect(serverSource).toContain('custom_request');
  });

  it('uses the canonical embedded docs entry', () => {
    expect(tokenPageSource).toContain('<DocsSite hideTopbar={true} />');
    expect(tokenPageSource).not.toContain('portal · production');
    expect(tokenPageSource).not.toContain('>Account</a>');
    expect(rootIndexSource).toContain('src="/docs/docs-site.jsx?v=public-docs-v2"');
    expect(rootIndexSource).not.toContain('src="docs-site.jsx"');
    expect(docsIndexSource).toContain('src="docs-site.jsx?v=public-docs-v2"');
    expect(docsSource.match(/Index options are supported/g)).toHaveLength(1);
  });

  it('uses stable domain endpoints and one canonical document source', () => {
    expect(rootDocsSource).toContain('/docs/docs-site.jsx');
    expect(docsSource).toContain('const WS_BASE = "wss://leandata.uk"');
    expect(docsSource).toContain('${WS_BASE}/stream');
    expect(docsSource).toContain('https://rt-api.leandata.uk');
    expect(docsSource).not.toContain('52.37.182.24');
    expect(docsSource).not.toContain('ThinkCentre');
  });

  it('uses neutral bilingual financial-data language', () => {
    expect(docsSource).toContain('Premium access includes company statements, ratios, metrics, profiles, and reference data.');
    expect(docsSource).toContain('Premium 账户可访问公司财报、财务比率、关键指标、公司资料及参考数据。');
    expect(docsSource).toContain('function Bilingual');
    expect(docsSource).not.toMatch(/Alpaca|ThetaData/);
    expect(docsSource).not.toContain('FMP 数据');
    expect(docsSource).not.toContain('FMP Fundamentals');
    expect(docsSource).not.toContain('No FMP');
  });

  it('adds a bilingual updates banner and updates page entry point', () => {
    const updatesHtml = fs.readFileSync(path.join(__dirname, 'public', 'updates.html'), 'utf8');
    const updatesSource = fs.readFileSync(path.join(__dirname, 'public', 'updates-page.jsx'), 'utf8');
    expect(tokenPageSource).toContain('股票 WebSocket 现可定位错误 symbol');
    expect(tokenPageSource).toContain('href="/updates"');
    expect(tokenPageSource).toContain('查看更新 / View updates →');
    expect(updatesHtml).toContain('updates-page.jsx');
    expect(updatesSource).toContain('近期改动');
    expect(updatesSource).toContain('数据更新与历史版本');
    expect(updatesSource).toContain('我的留言');
    expect(updatesSource).toContain('/api/product-updates/feedback');
    expect(updatesSource).not.toMatch(/fmp|forwarding|upstream/i);
  });

  it('documents a neutral streaming authentication and subscription flow', () => {
    expect(docsSource).toContain('Connect, authenticate, subscribe / 连接、认证、订阅');
    expect(docsSource).toContain('"action": "auth", "token": "<TOKEN>"');
    expect(docsSource).toContain('"action": "subscribe", "trades": ["AAPL"], "quotes": ["AAPL"]');
    expect(docsSource).toContain('Handle reconnects with backoff.');
  });
});

describe('Product updates and account-scoped feedback', () => {
  function seedFeedbackAccount() {
    const account = {
      userId: 'feedback-user',
      phone: '6045550188',
      email: 'feedback-user@example.com',
      token: 'feedback-token',
      expiry: new Date(Date.now() + 86400000).toISOString()
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: account.userId,
      phone: account.phone,
      email: account.email,
      role: 'premium',
      tier: 'premium'
    }]));
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({ users: [{
      user_id: account.userId,
      token: account.token,
      role: 'premium',
      email: account.email,
      expires_at: account.expiry
    }] }));
    return account;
  }

  it('serves public update entries and requires account auth for feedback', async () => {
    const updates = await request(app).get('/api/product-updates');
    expect(updates.statusCode).toBe(200);
    expect(updates.body.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ws-symbol-error-isolation-2026-08',
        date: '2026-08-06',
        title: expect.stringContaining('逐 symbol')
      }),
      expect.objectContaining({
        title: expect.stringContaining('认证滥用防护'),
        body: expect.stringContaining('7 天')
      }),
      expect.objectContaining({
        title: expect.stringContaining('Index options'),
        body: expect.stringContaining('SPX / SPXW')
      })
    ]));
    const unauthorized = await request(app).get('/api/product-updates/feedback/mine');
    expect(unauthorized.statusCode).toBe(401);
  });

  it('persists feedback and only returns it to the logged-in user', async () => {
    const account = seedFeedbackAccount();
    const login = await request(app).post('/api/account/login').send({
      credential: { user_id: account.userId, phone: account.phone },
      email: account.email
    });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const created = await request(app)
      .post('/api/product-updates/feedback')
      .set('Cookie', cookie)
      .send({ message: '请优先加入 quarterly statements。' });
    expect(created.statusCode).toBe(201);
    expect(created.body.feedback.message).toContain('quarterly');
    expect(JSON.parse(fs.readFileSync(PRODUCT_FEEDBACK_FILE, 'utf8'))).toHaveLength(1);
    const mine = await request(app).get('/api/product-updates/feedback/mine').set('Cookie', cookie);
    expect(mine.statusCode).toBe(200);
    expect(mine.body.feedback).toHaveLength(1);
    const invalid = await request(app)
      .post('/api/product-updates/feedback')
      .set('Cookie', cookie)
      .send({ message: '' });
    expect(invalid.statusCode).toBe(400);
  });
});

// ============================================================
// Payment bundles and automatic fulfillment
// ============================================================
describe('Payment bundles and automatic fulfillment', () => {
  let paymentLoginSequence = 0;

  async function createRegistrationCheckout({
    username = 'pay-user',
    phone = '6045550199',
    email = 'pay-user@example.com',
    tier = 'standard',
    mode
  } = {}) {
    const checkoutToken = crypto.randomBytes(24).toString('base64url');
    const entry = {
      id: crypto.randomUUID(),
      type: 'registration',
      username,
      phone,
      email,
      tier,
      ...(mode && { mode }),
      status: 'payment_pending',
      registered_at: new Date().toISOString(),
      requested_at: new Date().toISOString(),
      checkout_token_hash: crypto.createHash('sha256').update(checkoutToken).digest('hex'),
      checkout_token_issued_at: new Date().toISOString()
    };
    fs.writeFileSync(PENDING_FILE, JSON.stringify([entry]));
    return { ...entry, checkout_token: checkoutToken };
  }

  async function createRegistrationOrder({
    registration,
    bundleId = 'standard-1m',
    paymentMethod = 'alipay',
    extra = {}
  }) {
    if (paymentMethod === 'alipay' && process.env.PAYMENT_MOCK_ENABLED !== 'true') {
      process.env.ZPAY_PID = 'test-zpay-pid';
      process.env.ZPAY_KEY = 'test-zpay-key';
    }
    return request(app).post('/api/payment/orders').send({
      checkout_token: registration.checkout_token,
      bundle_id: bundleId,
      payment_method: paymentMethod,
      ...extra
    });
  }

  function seedPaidAccount({
    userId = 'paid-account',
    phone = '6045550188',
    tier = 'standard',
    email = 'paid-account@example.com',
    expiry = new Date(Date.now() + 10 * 86400000).toISOString(),
    token = 'preserved-payment-token'
  } = {}) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: userId,
      phone,
      role: TIERS[tier].role,
      tier,
      email,
      permissions: TIERS[tier].permissions
    }]));
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({
      users: [{
        token,
        user_id: userId,
        role: TIERS[tier].role,
        expires_at: expiry,
        permissions: TIERS[tier].permissions
        ,email
      }]
    }));
    return { userId, phone, email, tier, expiry, token };
  }

  async function loginPaidAccount(account = seedPaidAccount()) {
    paymentLoginSequence += 1;
    const login = await request(app)
      .post('/api/account/login')
      .set('x-forwarded-for', `203.0.113.${paymentLoginSequence}`)
      .send({
        credential: {
          user_id: account.userId,
          phone: account.phone
        },
        email: account.email
      });
    return {
      login,
      cookie: login.headers['set-cookie']?.[0]?.split(';')[0]
    };
  }

  it('returns server-authoritative CNY pricing and ignores client-supplied amounts', async () => {
    const registration = await createRegistrationCheckout();
    const info = await request(app)
      .get('/api/payment/checkout-info')
      .query({ checkout_token: registration.checkout_token });
    expect(info.statusCode).toBe(200);
    expect(info.body.suggested_bundle_id).toBe('standard-1m');
    expect(info.body.bundles.find(bundle => bundle.id === 'standard-3m').amount_cny_fen).toBe(30000);

    const order = await createRegistrationOrder({
      registration,
      bundleId: 'standard-1m',
      extra: { amount_cny_fen: 1, currency: 'USD' }
    });
    expect(order.statusCode).toBe(201);
    expect(order.body.order.bundle.amount_cny_fen).toBe(10000);
    expect(order.body.order.bundle.currency).toBe('CNY');
  });

  it('shows Z-Pay Alipay and Stripe card checkout as unavailable without host-only credentials', async () => {
    const registration = await createRegistrationCheckout();
    const info = await request(app)
      .get('/api/payment/checkout-info')
      .query({ checkout_token: registration.checkout_token });
    expect(info.statusCode).toBe(200);
    expect(info.body.payment_methods.map(method => method.id)).toEqual([
      'alipay',
      'stripe_card'
    ]);
    const alipay = info.body.payment_methods.find(method => method.id === 'alipay');
    const stripe = info.body.payment_methods.find(method => method.id === 'stripe_card');
    expect(alipay.available).toBe(false);
    expect(alipay.configured).toBe(false);
    expect(alipay.status).toContain('暂不可用');
    expect(stripe.configured).toBe(false);
    expect(stripe.available).toBe(false);
    expect(stripe.currencies).toEqual([
      { currency: 'CAD' },
      { currency: 'USD' }
    ]);
  });

  it('fails closed before creating an Alipay order without Z-Pay credentials', async () => {
    const registration = await createRegistrationCheckout({
      username: 'alipay-placeholder-user',
      email: 'alipay-placeholder-user@example.com'
    });
    const response = await request(app).post('/api/payment/orders').send({
      checkout_token: registration.checkout_token,
      bundle_id: 'standard-1m',
      payment_method: 'alipay'
    });
    expect(response.statusCode).toBe(503);
    expect(response.body.message).toContain('支付宝');
    expect(JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'))).toHaveLength(0);
  });

  it('loads Z-Pay credentials only from a mode-0600 host file', async () => {
    fs.writeFileSync(
      ZPAY_PAYMENT_ENV_FILE,
      [
        'PAYMENT_PUBLIC_BASE_URL=https://leandata.uk',
        'ZPAY_PID=test-zpay-pid',
        'ZPAY_KEY=test-zpay-key'
      ].join('\n'),
      { mode: 0o600 }
    );
    fs.chmodSync(ZPAY_PAYMENT_ENV_FILE, 0o600);
    const registration = await createRegistrationCheckout();
    const configured = await request(app)
      .get('/api/payment/checkout-info')
      .query({ checkout_token: registration.checkout_token });
    expect(configured.statusCode).toBe(200);
    expect(configured.body.payment_methods.find(method => method.id === 'alipay')).toEqual(
      expect.objectContaining({ configured: true, available: true })
    );

    fs.chmodSync(ZPAY_PAYMENT_ENV_FILE, 0o640);
    const rejected = await request(app)
      .get('/api/payment/checkout-info')
      .query({ checkout_token: registration.checkout_token });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.body.payment_methods.find(method => method.id === 'alipay').configured).toBe(false);
  });

  it('creates a signed Z-Pay Alipay checkout with a server-authoritative CNY amount', async () => {
    process.env.PAYMENT_PUBLIC_BASE_URL = 'https://leandata.uk';
    process.env.ZPAY_PID = 'test-zpay-pid';
    process.env.ZPAY_KEY = 'test-zpay-key';
    const registration = await createRegistrationCheckout({
      username: 'zpay-checkout-user',
      email: 'zpay-checkout-user@example.com'
    });
    const response = await createRegistrationOrder({
      registration,
      bundleId: 'standard-2m',
      extra: { amount_cny_fen: 1, money: '0.01' }
    });
    expect(response.statusCode).toBe(201);
    const checkout = new URL(response.body.checkout_url);
    expect(checkout.origin).toBe('https://z-pay.cn');
    expect(checkout.pathname).toBe('/submit.php');
    expect(checkout.searchParams.get('pid')).toBe('test-zpay-pid');
    expect(checkout.searchParams.get('type')).toBe('alipay');
    expect(checkout.searchParams.get('out_trade_no')).toBe(response.body.order.id);
    expect(checkout.searchParams.get('money')).toBe('200.00');
    expect(checkout.searchParams.get('notify_url')).toBe('https://leandata.uk/api/payment/zpay/notify');
    expect(checkout.searchParams.get('sign_type')).toBe('MD5');
    expect(checkout.searchParams.get('sign')).toHaveLength(32);
    expect(response.body.order.provider).toBe('zpay');
    expect(response.body.order.provider_charge).toEqual({
      currency: 'CNY',
      amount_minor: 20000,
      monthly_amount_minor: 10000
    });
  });

  it('verifies Z-Pay callbacks, enforces amount and order binding, and fulfills idempotently', async () => {
    process.env.ZPAY_PID = 'test-zpay-pid';
    process.env.ZPAY_KEY = 'test-zpay-key';
    const registration = await createRegistrationCheckout({
      username: 'zpay-webhook-user',
      email: 'zpay-webhook-user@example.com'
    });
    const created = await createRegistrationOrder({
      registration,
      bundleId: 'standard-1m'
    });
    const stored = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'))[0];
    const callback = {
      pid: process.env.ZPAY_PID,
      type: 'alipay',
      out_trade_no: created.body.order.id,
      trade_no: 'zpay_trade_0001',
      name: stored.zpay_subject,
      money: '100.00',
      trade_status: 'TRADE_SUCCESS',
      sign_type: 'MD5'
    };
    callback.sign = generateZpaySignature(callback, process.env.ZPAY_KEY);

    const first = await request(app)
      .post('/api/payment/zpay/notify')
      .type('form')
      .send(callback);
    const duplicate = await request(app)
      .post('/api/payment/zpay/notify')
      .type('form')
      .send(callback);
    expect(first.statusCode).toBe(200);
    expect(first.text).toBe('success');
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.text).toBe('success');

    const completed = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'))[0];
    expect(completed.status).toBe('COMPLETED');
    expect(completed.provider_payment_id).toBe('zpay_trade_0001');
    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    expect(proxy.users).toHaveLength(1);
    expect(proxy.users[0].fulfilled_payment_orders).toEqual([created.body.order.id]);
  });

  it('blocks Z-Pay callbacks with an invalid signature or mismatched paid amount', async () => {
    process.env.ZPAY_PID = 'test-zpay-pid';
    process.env.ZPAY_KEY = 'test-zpay-key';
    const registration = await createRegistrationCheckout({
      username: 'zpay-mismatch-user',
      email: 'zpay-mismatch-user@example.com'
    });
    const created = await createRegistrationOrder({ registration });
    const stored = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'))[0];
    const invalid = await request(app)
      .post('/api/payment/zpay/notify')
      .type('form')
      .send({
        pid: process.env.ZPAY_PID,
        type: 'alipay',
        out_trade_no: created.body.order.id,
        trade_no: 'zpay_trade_invalid',
        name: stored.zpay_subject,
        money: '100.00',
        trade_status: 'TRADE_SUCCESS',
        sign_type: 'MD5',
        sign: '0'.repeat(32)
      });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.text).toBe('fail');

    const mismatched = {
      pid: process.env.ZPAY_PID,
      type: 'alipay',
      out_trade_no: created.body.order.id,
      trade_no: 'zpay_trade_mismatch',
      name: stored.zpay_subject,
      money: '0.01',
      trade_status: 'TRADE_SUCCESS',
      sign_type: 'MD5'
    };
    mismatched.sign = generateZpaySignature(mismatched, process.env.ZPAY_KEY);
    const review = await request(app)
      .post('/api/payment/zpay/notify')
      .type('form')
      .send(mismatched);
    expect(review.statusCode).toBe(200);
    expect(review.text).toBe('success');
    const held = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'))[0];
    expect(held.status).toBe('MANUAL_REVIEW');
    expect(JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8')).users).toHaveLength(0);
  });

  it('loads Stripe credentials only from a mode-0600 host file', async () => {
    fs.writeFileSync(
      STRIPE_PAYMENT_ENV_FILE,
      [
        'PAYMENT_PUBLIC_BASE_URL=https://leandata.uk',
        'STRIPE_SECRET_KEY=sk_test_file_only',
        'STRIPE_WEBHOOK_SECRET=whsec_file_only'
      ].join('\n'),
      { mode: 0o600 }
    );
    fs.chmodSync(STRIPE_PAYMENT_ENV_FILE, 0o600);
    const registration = await createRegistrationCheckout();
    const configured = await request(app)
      .get('/api/payment/checkout-info')
      .query({ checkout_token: registration.checkout_token });
    expect(configured.statusCode).toBe(200);
    expect(configured.body.payment_methods.find(method => method.id === 'stripe_card')).toEqual(
      expect.objectContaining({ configured: true, available: true })
    );

    fs.chmodSync(STRIPE_PAYMENT_ENV_FILE, 0o640);
    const rejected = await request(app)
      .get('/api/payment/checkout-info')
      .query({ checkout_token: registration.checkout_token });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.body.payment_methods.find(method => method.id === 'stripe_card').configured).toBe(false);
  });

  it('creates Stripe Checkout in the selected USD currency without trusting client amounts', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_test';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'cs_test_usd_checkout',
        url: 'https://checkout.stripe.com/c/pay/cs_test_usd_checkout'
      })
    });
    const registration = await createRegistrationCheckout({
      username: 'stripe-session-user',
      email: 'stripe-session-user@example.com'
    });
    const response = await createRegistrationOrder({
      registration,
      bundleId: 'premium-3m',
      paymentMethod: 'stripe_card',
      extra: { stripe_currency: 'USD', checkout_locale: 'en', amount_minor: 1 }
    });
    expect(response.statusCode).toBe(201);
    expect(response.body.checkout_url).toContain('checkout.stripe.com');
    const [url, options] = fetchMock.mock.calls[0];
    const form = new URLSearchParams(options.body);
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(form.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('7500');
    expect(form.get('locale')).toBe('en');
    expect(form.get('line_items[0][price_data][product_data][name]')).toBe('Leandata Premium Plan');
    expect(form.get('line_items[0][price_data][product_data][description]')).toBe('3 months of data access');
    expect(form.get('metadata[bundle_id]')).toBe('premium-3m');
  });

  it('fails closed before creating an order when Stripe card checkout has no server keys', async () => {
    const registration = await createRegistrationCheckout();
    const order = await createRegistrationOrder({
      registration,
      paymentMethod: 'stripe_card'
    });
    expect(order.statusCode).toBe(503);
    expect(order.body.message).toContain('暂时不可用');
    const persisted = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'));
    expect(persisted).toHaveLength(0);
  });

  it('verifies Stripe webhooks, checks amount/currency/bundle, and fulfills idempotently', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    const registration = await createRegistrationCheckout({
      username: 'stripe-webhook-user',
      email: 'stripe-webhook-user@example.com'
    });
    const created = await createRegistrationOrder({
      registration,
      paymentMethod: 'stripe_card'
    });
    const orders = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'));
    orders[0].provider = 'stripe_checkout';
    fs.writeFileSync(PAYMENT_ORDERS_FILE, JSON.stringify(orders));

    delete process.env.PAYMENT_MOCK_ENABLED;
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_test';
    const payload = JSON.stringify({
      id: 'evt_checkout_complete',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_complete',
          object: 'checkout.session',
          client_reference_id: created.body.order.id,
          payment_intent: 'pi_test_complete',
          payment_status: 'paid',
          amount_total: 2000,
          currency: 'cad',
          metadata: {
            order_id: created.body.order.id,
            bundle_id: 'standard-1m'
          }
        }
      }
    });
    const signature = generateStripeTestHeader(payload, process.env.STRIPE_WEBHOOK_SECRET);
    const first = await request(app)
      .post('/api/payment/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    const duplicate = await request(app)
      .post('/api/payment/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);

    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(200);
    const completed = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'))[0];
    expect(completed.status).toBe('COMPLETED');
    expect(completed.provider_payment_id).toBe('pi_test_complete');
    expect(completed.provider_charge).toEqual({
      currency: 'CAD',
      amount_minor: 2000,
      monthly_amount_minor: 2000
    });
    const returnLookup = await request(app)
      .get(`/api/payment/orders/${created.body.order.id}`)
      .query({ checkout_token: registration.checkout_token });
    expect(returnLookup.statusCode).toBe(200);
    expect(returnLookup.body.order.status).toBe('COMPLETED');
    expect(returnLookup.body.issued_token).toEqual(expect.any(String));
    expect(returnLookup.body.issued_token.length).toBeGreaterThan(20);
    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    expect(proxy.users).toHaveLength(1);
    expect(proxy.users[0].fulfilled_payment_orders).toEqual([created.body.order.id]);
  });

  it('rejects invalid and stale Stripe webhook signatures', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_test';
    const payload = JSON.stringify({
      id: 'evt_invalid_signature',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: {} }
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const invalid = await request(app)
      .post('/api/payment/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', `t=${timestamp},v1=${'0'.repeat(64)}`)
      .send(payload);
    const stale = await request(app)
      .post('/api/payment/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'stripe-signature',
        generateStripeTestHeader(payload, process.env.STRIPE_WEBHOOK_SECRET, timestamp - 600)
      )
      .send(payload);
    expect(invalid.statusCode).toBe(400);
    expect(stale.statusCode).toBe(400);
  });

  it('holds a paid Stripe order for manual review when the amount mismatches', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    const registration = await createRegistrationCheckout({
      username: 'stripe-mismatch-user',
      email: 'stripe-mismatch-user@example.com'
    });
    const created = await createRegistrationOrder({
      registration,
      paymentMethod: 'stripe_card'
    });
    const orders = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'));
    orders[0].provider = 'stripe_checkout';
    fs.writeFileSync(PAYMENT_ORDERS_FILE, JSON.stringify(orders));

    delete process.env.PAYMENT_MOCK_ENABLED;
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_test';
    const payload = JSON.stringify({
      id: 'evt_checkout_mismatch',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_mismatch',
          object: 'checkout.session',
          client_reference_id: created.body.order.id,
          payment_intent: 'pi_test_mismatch',
          payment_status: 'paid',
          amount_total: 1,
          currency: 'cny',
          metadata: {
            order_id: created.body.order.id,
            bundle_id: 'standard-1m'
          }
        }
      }
    });
    const signature = generateStripeTestHeader(payload, process.env.STRIPE_WEBHOOK_SECRET);
    const response = await request(app)
      .post('/api/payment/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);

    expect(response.statusCode).toBe(200);
    expect(response.body.manual_review).toBe(true);
    const held = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_FILE, 'utf8'))[0];
    expect(held.status).toBe('MANUAL_REVIEW');
    expect(JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8')).users).toHaveLength(0);
  });

  it('prices Stripe orders in server-authoritative CAD or USD amounts', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    const registration = await createRegistrationCheckout({
      username: 'stripe-currency-user',
      email: 'stripe-currency-user@example.com'
    });
    const usd = await createRegistrationOrder({
      registration,
      bundleId: 'premium-3m',
      paymentMethod: 'stripe_card',
      extra: { stripe_currency: 'usd', amount_minor: 1 }
    });
    expect(usd.statusCode).toBe(201);
    expect(usd.body.order.bundle.amount_cny_fen).toBe(45000);
    expect(usd.body.order.provider_charge).toEqual({
      currency: 'USD',
      amount_minor: 7500,
      monthly_amount_minor: 2500
    });

    const rejected = await createRegistrationOrder({
      registration,
      paymentMethod: 'stripe_card',
      extra: { stripe_currency: 'CNY' }
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body.message).toContain('CAD');
  });

  it('uses the proportional Stripe price table for Basic, Standard, and Premium', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    const standardRegistration = await createRegistrationCheckout({
      username: 'stripe-standard-price',
      email: 'stripe-standard-price@example.com'
    });
    const standard = await createRegistrationOrder({
      registration: standardRegistration,
      bundleId: 'standard-1m',
      paymentMethod: 'stripe_card',
      extra: { stripe_currency: 'CAD' }
    });
    expect(standard.statusCode).toBe(201);
    expect(standard.body.order.provider_charge).toEqual({
      currency: 'CAD',
      amount_minor: 2000,
      monthly_amount_minor: 2000
    });

    const basicAccount = seedPaidAccount({
      userId: 'stripe-basic-price',
      tier: 'basic'
    });
    const { cookie } = await loginPaidAccount(basicAccount);
    const basic = await request(app)
      .post('/api/payment/orders')
      .set('Cookie', cookie)
      .send({
        bundle_id: 'basic-1m',
        payment_method: 'stripe_card',
        stripe_currency: 'USD'
      });
    expect(basic.statusCode).toBe(201);
    expect(basic.body.order.provider_charge).toEqual({
      currency: 'USD',
      amount_minor: 1000,
      monthly_amount_minor: 1000
    });

    const premiumRegistration = await createRegistrationCheckout({
      username: 'stripe-premium-price',
      email: 'stripe-premium-price@example.com'
    });
    const premium = await createRegistrationOrder({
      registration: premiumRegistration,
      bundleId: 'premium-1m',
      paymentMethod: 'stripe_card',
      extra: { stripe_currency: 'CAD' }
    });
    expect(premium.statusCode).toBe(201);
    expect(premium.body.order.provider_charge).toEqual({
      currency: 'CAD',
      amount_minor: 3000,
      monthly_amount_minor: 3000
    });
  });

  it('rejects invalid bundles and payment methods', async () => {
    const registration = await createRegistrationCheckout();
    const invalidBundle = await createRegistrationOrder({
      registration,
      bundleId: 'trial-1m'
    });
    const invalidMethod = await createRegistrationOrder({
      registration,
      paymentMethod: 'card'
    });
    expect(invalidBundle.statusCode).toBe(400);
    expect(invalidMethod.statusCode).toBe(400);
  });

  it('keeps the local mock provider disabled by default', async () => {
    const registration = await createRegistrationCheckout();
    const created = await createRegistrationOrder({ registration });
    const completed = await request(app)
      .post(`/api/payment/mock/${created.body.order.id}/complete`)
      .send({ resume_token: created.body.resume_token });
    expect(created.body.mock_enabled).toBe(false);
    expect(completed.statusCode).toBe(404);
  });

  it('automatically provisions a new paid registration without admin approval', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    process.env.PAYMENT_WECHAT_ENABLED = 'true';
    const registration = await createRegistrationCheckout({
      username: 'auto-provision',
      email: 'auto-provision@example.com'
    });
    const created = await createRegistrationOrder({
      registration,
      bundleId: 'premium-3m',
      paymentMethod: 'wechat_pay'
    });
    const completed = await request(app)
      .post(`/api/payment/mock/${created.body.order.id}/complete`)
      .send({ resume_token: created.body.resume_token });

    expect(completed.statusCode).toBe(200);
    expect(completed.body.order.status).toBe('COMPLETED');
    expect(completed.body.issued_token).toBeTruthy();

    const localUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const localUser = localUsers.find(user => user.username === 'auto-provision');
    expect(localUser.tier).toBe('premium');
    expect(localUser.fulfilled_payment_orders).toEqual([created.body.order.id]);

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const proxyUser = proxy.users.find(user => user.user_id === 'auto-provision');
    expect(proxyUser.token).toBe(completed.body.issued_token);
    expect(proxyUser.role).toBe('premium');
    expect(proxyUser.fulfilled_payment_orders).toEqual([created.body.order.id]);

    const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    expect(pending.find(item => item.id === registration.id).status).toBe('approved');
  });

  it('preserves an existing token, extends from current expiry, and is idempotent', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    const account = seedPaidAccount();
    const { cookie } = await loginPaidAccount(account);
    const created = await request(app)
      .post('/api/payment/orders')
      .set('Cookie', cookie)
      .send({
        bundle_id: 'standard-2m',
        payment_method: 'alipay'
      });
    expect(created.statusCode).toBe(201);

    const first = await request(app)
      .post(`/api/payment/mock/${created.body.order.id}/complete`)
      .send({ resume_token: created.body.resume_token });
    expect(first.statusCode).toBe(200);
    const afterFirst = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8')).users[0];
    const firstExpiry = afterFirst.expires_at;
    const extensionDays = (new Date(firstExpiry) - new Date(account.expiry)) / 86400000;
    expect(afterFirst.token).toBe(account.token);
    expect(extensionDays).toBeGreaterThan(59.9);
    expect(extensionDays).toBeLessThan(60.1);

    const duplicate = await request(app)
      .post(`/api/payment/mock/${created.body.order.id}/complete`)
      .send({ resume_token: created.body.resume_token });
    const afterDuplicate = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8')).users[0];
    expect(duplicate.statusCode).toBe(200);
    expect(afterDuplicate.token).toBe(account.token);
    expect(afterDuplicate.expires_at).toBe(firstExpiry);
    expect(afterDuplicate.fulfilled_payment_orders).toEqual([created.body.order.id]);
  });

  it('does not expose payment orders without the account session or resume token', async () => {
    const registration = await createRegistrationCheckout();
    const created = await createRegistrationOrder({ registration });
    const missing = await request(app).get(`/api/payment/orders/${created.body.order.id}`);
    const wrong = await request(app)
      .get(`/api/payment/orders/${created.body.order.id}`)
      .query({ resume_token: 'wrong-token' });
    const allowed = await request(app)
      .get(`/api/payment/orders/${created.body.order.id}`)
      .query({ resume_token: created.body.resume_token });
    expect(missing.statusCode).toBe(404);
    expect(wrong.statusCode).toBe(404);
    expect(allowed.statusCode).toBe(200);
  });

  it('keeps a paid synchronization failure retryable without double provisioning', async () => {
    process.env.PAYMENT_MOCK_ENABLED = 'true';
    const registration = await createRegistrationCheckout({ username: 'retry-payment' });
    const created = await createRegistrationOrder({ registration });

    fs.unlinkSync(TEST_PROXY_FILE);
    fs.mkdirSync(TEST_PROXY_FILE);
    const failed = await request(app)
      .post(`/api/payment/mock/${created.body.order.id}/complete`)
      .send({ resume_token: created.body.resume_token });
    expect(failed.statusCode).toBe(500);
    expect(failed.body.retryable).toBe(true);
    expect(failed.body.order.status).toBe('FAILED');

    fs.rmSync(TEST_PROXY_FILE, { recursive: true, force: true });
    fs.writeFileSync(TEST_PROXY_FILE, '{"users":[]}');
    const retried = await request(app)
      .post(`/api/payment/mock/${created.body.order.id}/complete`)
      .send({ resume_token: created.body.resume_token });
    expect(retried.statusCode).toBe(200);
    expect(retried.body.order.status).toBe('COMPLETED');
    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    expect(proxy.users).toHaveLength(1);
    expect(proxy.users[0].fulfilled_payment_orders).toEqual([created.body.order.id]);
  });

  it('ships the OpenAI-style checkout UI and registration redirect contract', () => {
    const checkoutSource = fs.readFileSync(path.join(__dirname, 'public', 'checkout-page.jsx'), 'utf8');
    const checkoutCss = fs.readFileSync(path.join(__dirname, 'public', 'checkout.css'), 'utf8');
    const registerSource = fs.readFileSync(path.join(__dirname, 'public', 'register-page.jsx'), 'utf8');
    expect(checkoutSource).toContain('支付宝');
    expect(checkoutSource).toContain('微信支付');
    expect(checkoutSource).toContain('stripe_card');
    expect(checkoutSource).toContain('alipay-wordmark');
    expect(checkoutSource).toContain('stripe-wordmark');
    expect(checkoutSource).toContain('ALIPAY');
    expect(checkoutSource).toContain('由 Stripe 安全处理卡号与 CVV');
    expect(checkoutSource).toContain('created.checkout_url');
    expect(checkoutSource).toContain('无需管理员批准');
    expect(checkoutCss).toContain('grid-template-columns: minmax(0, 488px) minmax(390px, 432px)');
    expect(checkoutCss).toContain('background: #0d0d0d');
    expect(registerSource).not.toContain('创建账户并选择套餐');
    expect(registerSource).not.toContain('继续选择套餐与支付');
    expect(registerSource).toContain('/account');
  });

  it('ships a persistent bilingual switcher on every site entry page', async () => {
    const publicDir = path.join(__dirname, 'public');
    const languageSource = fs.readFileSync(path.join(publicDir, 'language.js'), 'utf8');
    const entryPages = [
      'index.html',
      'register.html',
      'account.html',
      'checkout.html',
      'admin.html',
      path.join('docs', 'index.html')
    ];
    for (const entryPage of entryPages) {
      expect(fs.readFileSync(path.join(publicDir, entryPage), 'utf8')).toContain('src="/language.js"');
    }
    expect(languageSource).toContain('leandata.language');
    expect(languageSource).toContain('leandata:languagechange');
    expect(
      execFileSync(process.execPath, [path.join(__dirname, 'scripts', 'verify-language.mjs')], {
        encoding: 'utf8'
      }).trim()
    ).toBe('language switcher ok');
  });

  it('falls back to the responsive bilingual pages when mobile-only files are absent', async () => {
    const mobileUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148';
    const [home, docs, register] = await Promise.all([
      request(app).get('/').set('User-Agent', mobileUserAgent),
      request(app).get('/docs/').set('User-Agent', mobileUserAgent),
      request(app).get('/register').set('User-Agent', mobileUserAgent)
    ]);
    expect(home.statusCode).toBe(200);
    expect(docs.statusCode).toBe(200);
    expect(register.statusCode).toBe(200);
    expect(home.text).toContain('src="/language.js"');
    expect(docs.text).toContain('src="/language.js"');
    expect(register.text).toContain('src="/language.js"');
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
    email = 'account-user@example.com',
    expiry = computeExpiry(TIERS.standard),
    token = 'account-token-1234567890'
  } = {}) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: userId,
      phone,
      role: TIERS[tier].role,
      tier,
      ...(mode && { mode }),
      email,
      permissions: mode ? TIERS[tier].modes[mode] : TIERS[tier].permissions
    }]));
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({
      users: [{
        token,
        user_id: userId,
        role: TIERS[tier].role,
        expires_at: expiry,
        email,
        permissions: mode ? TIERS[tier].modes[mode] : TIERS[tier].permissions
      }]
    }));
    return { userId, phone, token, expiry, email };
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
        },
        email: account.email
      });
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    return { login, cookie };
  }

  it('requires the credential object and rejects mismatched phone numbers', async () => {
    const account = seedAccount();
    const missing = await request(app).post('/api/account/login').send({
      user_id: account.userId,
      phone: account.phone,
      email: account.email
    });
    expect(missing.statusCode).toBe(400);

    const mismatch = await request(app)
      .post('/api/account/login')
      .set('x-forwarded-for', '198.51.100.220')
      .send({
        credential: {
          user_id: account.userId,
          phone: 'wrong-phone'
        },
        email: account.email
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

  it('requires username and phone as the login identity', async () => {
    const account = seedAccount();
    const invalid = await request(app)
      .post('/api/account/login')
      .set('x-forwarded-for', '198.51.100.223')
      .send({
        credential: { user_id: account.userId }
      });
    expect(invalid.statusCode).toBe(400);
  });

  it('ignores optional email metadata during login', async () => {
    const account = seedAccount();
    const rejected = await request(app)
      .post('/api/account/login')
      .set('x-forwarded-for', '198.51.100.224')
      .send({
        credential: {
          user_id: account.userId,
          phone: account.phone
        },
        email: 'attacker@example.com'
      });
    expect(rejected.statusCode).toBe(200);
  });

  it('reveals the raw token only through the authenticated account session', async () => {
    const account = seedAccount();
    const { cookie } = await loginAccount(account);
    const revealed = await request(app)
      .get('/api/account/token')
      .set('Cookie', cookie);
    expect(revealed.statusCode).toBe(200);
    expect(revealed.body).toEqual({
      success: true,
      token: account.token,
      expires_at: account.expiry
    });

    const unauthenticated = await request(app).get('/api/account/token');
    expect(unauthenticated.statusCode).toBe(401);
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
          },
          email: account.email
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
          },
          email: account.email
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
        },
        email: account.email
      });
    expect(limited.statusCode).toBe(429);
  });

  it('returns only the authenticated account overview and scoped usage', async () => {
    const account = seedAccount({ email: 'account@example.com' });
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
    expect(overview.body.account.email).toBe(account.email);
    expect(overview.body.account.token_masked).toMatch(/^accoun.*7890$/);
    expect(overview.body.usage.rest.requests).toBe(42);
    expect(overview.body.usage.ws.active_connections).toBe(2);
    expect(overview.body.usage.ws.subscriptions).toBe(7);
    expect(JSON.stringify(overview.body)).not.toContain(account.phone);
    expect(JSON.stringify(overview.body)).not.toContain(account.token);
  });

  it('requires login for account overview, email updates, and renewal', async () => {
    const overview = await request(app).get('/api/account/overview');
    const email = await request(app).post('/api/account/email').send({
      email: 'account@example.com'
    });
    const renewal = await request(app).post('/api/account/renew').send({
      tier: 'standard',
      months: 1
    });
    expect(overview.statusCode).toBe(401);
    expect(email.statusCode).toBe(401);
    expect(renewal.statusCode).toBe(401);
  });

  it('does not allow changing email because it is part of account identity', async () => {
    const account = seedAccount();
    const { cookie } = await loginAccount(account);
    const saved = await request(app)
      .post('/api/account/email')
      .set('Cookie', cookie)
      .send({ email: 'saved@example.com' });
    expect(saved.statusCode).toBe(410);
  });

  it('fails closed if either authenticated account record disappears', async () => {
    const account = seedAccount({ email: 'original@example.com' });
    const { cookie } = await loginAccount(account);
    const usersBefore = fs.readFileSync(USERS_FILE, 'utf8');
    fs.writeFileSync(TEST_PROXY_FILE, '{"users":[]}');

    const saved = await request(app)
      .post('/api/account/email')
      .set('Cookie', cookie)
      .send({ email: 'changed@example.com' });

    expect(saved.statusCode).toBe(401);
    expect(fs.readFileSync(USERS_FILE, 'utf8')).toBe(usersBefore);
    expect(fs.readFileSync(TEST_PROXY_FILE, 'utf8')).toBe('{"users":[]}');
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
    const res = await request(app).post('/api/check-status').send({ username: 'nobody', phone: '000', email: 'nobody@example.com' });
    expect(res.body.status).toBe('not_found');
  });

  it('returns approved for registered Free user', async () => {
    await registerRequest({
      username: 'pend', phone: '111', email: 'pend@example.com'
    });
    const res = await request(app).post('/api/check-status').send({ username: 'pend', phone: '111', email: 'pend@example.com' });
    expect(res.body.status).toBe('approved');
  });

  it('does not create a resumable checkout for a Free registration', async () => {
    await registerRequest({
      username: 'pay-later',
      phone: '222',
      email: 'pay-later@example.com'
    });
    const res = await request(app)
      .post('/api/check-status')
      .send({ username: 'pay-later', phone: '222', email: 'pay-later@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.checkout_url).toBeUndefined();
  });

  it('fails closed instead of reporting an unsynced account as approved', async () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      username: 'unsynced-free',
      phone: '333',
      email: 'unsynced@example.com',
      tier: 'free',
      role: 'free'
    }]));
    const res = await request(app)
      .post('/api/check-status')
      .send({ username: 'unsynced-free', phone: '333', email: 'unsynced@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('sync_pending');
    expect(res.body.token).toBeUndefined();
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

  it('loads the admin password from a mode-0600 host file', async () => {
    fs.writeFileSync(ADMIN_PASSWORD_FILE, 'host-only-admin-password', { mode: 0o600 });
    const oldPassword = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    const configured = await request(app).post('/api/admin/login')
      .send({ password: 'host-only-admin-password' });
    expect(oldPassword.statusCode).toBe(401);
    expect(configured.statusCode).toBe(200);
  });

  it('fails closed in production when no secure admin password is configured', async () => {
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).post('/api/admin/login').send({ password: 'admin123' });
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toBe('admin_not_configured');
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });
});

describe('Admin portal UI', () => {
  it('serves the editor and recipient selection controls', async () => {
    const res = await request(app).get('/admin');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('data-tab="announce"');
    expect(res.text).toContain('id="announce-subject"');
    expect(res.text).toContain('id="announce-body"');
    expect(res.text).toContain('id="announce-recipient-list"');
    expect(res.text).toContain('id="manual-email"');
    expect(res.text).toContain('id="announce-preview-button"');
    expect(res.text).toContain('id="announce-send-button"');
    expect(res.text).toContain('data-tab="template"');
    expect(res.text).toContain('id="email-template-subject"');
    expect(res.text).toContain('id="email-template-text"');
    expect(res.text).toContain('id="email-template-html"');
    expect(res.text).toContain('saveEmailTemplate()');
  });

  it('states that expired registered users with email are included', async () => {
    const res = await request(app).get('/admin');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('包括已过期账号');
  });

  it('renders registration email addresses in ordinary user cards', async () => {
    const res = await request(app).get('/admin');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('<span class="meta-label">邮箱</span>');
    expect(res.text).toContain('mailto:');
  });

  it('shows saved Bulk requests, contact details, custom endpoint text, and quote controls', async () => {
    const res = await request(app).get('/admin');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('data-tab="bulk"');
    expect(res.text).toContain('id="panel-bulk"');
    expect(res.text).toContain('id="list-bulk"');
    expect(res.text).toContain('/api/admin/bulk-orders');
    expect(res.text).toContain('自定义 endpoint / 数据需求');
    expect(res.text).toContain('标记已报价 / 已联系');
    expect(res.text).toContain('quoted_price');
  });
});

describe('Account portal UI', () => {
  it('uses username and phone login and exposes the account-only upgrade entry', async () => {
    const res = await request(app).get('/account-page.jsx');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('function ComplianceFooter()');
    const loginSource = res.text.slice(
      res.text.indexOf('function AccountLogin'),
      res.text.indexOf('function AccountKpi')
    );
    expect(loginSource).not.toContain('注册邮箱');
    expect(loginSource).not.toContain('email: email.trim()');
    expect(loginSource).toContain('required');
    expect(res.text).toContain('/api/account/token');
    expect(res.text).toContain('显示 Token');
    expect(res.text).toContain('选择升级套餐');
    expect(res.text).not.toContain('Notification email · optional');
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

  function seedPendingRegistration({
    id = crypto.randomUUID(),
    username,
    phone = '123',
    email,
    tier,
    mode
  }) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify([{
      id,
      type: 'registration',
      username,
      phone,
      email,
      account_id: username,
      tier,
      ...(mode && { mode }),
      registered_at: new Date().toISOString(),
      status: 'pending'
    }]));
    return id;
  }

  it('approves and writes correct role for each tier', async () => {
    const tierTests = [
      { tier: 'trial', expectedRole: 'standard' },
      { tier: 'value', expectedRole: 'value', mode: 'options' },
      { tier: 'standard', expectedRole: 'standard' },
      { tier: 'premium', expectedRole: 'premium' },
    ];

    for (const { tier, expectedRole, mode: m } of tierTests) {
      resetTestData();
      const id = seedPendingRegistration({
        username: `u_${tier}`,
        email: `u_${tier}@example.com`,
        tier,
        mode: m
      });

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
    const id = seedPendingRegistration({
      username: 'trial_exp',
      email: 'trial_exp@example.com',
      tier: 'trial'
    });
    await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id });

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
    const id = seedPendingRegistration({
      username: 'mailFlow',
      email: 'mailflow@example.com',
      tier: 'standard'
    });
    const res = await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id });
    expect(res.body.success).toBe(true);

    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    expect(users.find(user => user.username === 'mailFlow').email).toBe('mailflow@example.com');

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const proxyUser = proxy.users.find(user => user.user_id === 'mailFlow');
    expect(proxyUser).toBeDefined();
    expect(proxyUser.email).toBe('mailflow@example.com');
  });

  it('can approve a legacy Basic pending record without reopening public Basic registration', async () => {
    const id = 'legacy-basic-pending';
    fs.writeFileSync(PENDING_FILE, JSON.stringify([{
      id,
      type: 'registration',
      username: 'legacyBasic',
      phone: '123',
      email: 'legacybasic@example.com',
      tier: 'basic',
      registered_at: new Date().toISOString(),
      status: 'pending'
    }]));

    const res = await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id });
    expect(res.body.success).toBe(true);

    const proxy = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    const proxyUser = proxy.users.find(user => user.user_id === 'legacyBasic');
    expect(proxyUser.role).toBe('basic');
    expect(proxyUser.email).toBe('legacybasic@example.com');
  });
});

// ============================================================
// Admin reject
// ============================================================
describe('POST /api/admin/reject', () => {
  it('rejects a pending registration', async () => {
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    const adminToken = login.body.token;

    const id = 'reject-pending';
    fs.writeFileSync(PENDING_FILE, JSON.stringify([{
      id,
      type: 'registration',
      username: 'rejectme',
      phone: '999',
      email: 'rejectme@example.com',
      account_id: 'rejectme',
      tier: 'trial',
      registered_at: new Date().toISOString(),
      status: 'pending'
    }]));

    const res = await request(app).post('/api/admin/reject')
      .set('x-admin-token', adminToken)
      .send({ id, reason: 'test rejection' });

    expect(res.body.success).toBe(true);

    const check = await request(app).post('/api/check-status').send({ username: 'rejectme', phone: '999', email: 'rejectme@example.com' });
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
      username: 'gentest', phone: '555', email: 'gentest@example.com', role: 'premium', tier: 'premium',
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
      username: 'synctest', phone: '777', email: 'synctest@example.com', role: 'basic', tier: 'basic',
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
      username: 'formattest', phone: '888', email: 'formattest@example.com', role: 'premium', tier: 'premium',
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
      username: 'existing', phone: '999', email: 'existing@example.com', role: 'standard', tier: 'standard',
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
      username: 'fmtcheck', phone: '111', email: 'fmtcheck@example.com', role: 'premium', tier: 'premium',
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
      username: 'idcheck', phone: '222', email: 'idcheck@example.com', role: 'basic', tier: 'basic',
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
      username: 'tokenchk', phone: '333', email: 'tokenchk@example.com', role: 'standard', tier: 'standard',
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
      username: 'expcheck', phone: '444', email: 'expcheck@example.com', role: 'trial', tier: 'trial',
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

  function seedPendingRegistration({
    id = crypto.randomUUID(),
    username,
    phone = '555',
    email,
    tier = 'standard'
  }) {
    fs.writeFileSync(PENDING_FILE, JSON.stringify([{
      id,
      type: 'registration',
      username,
      phone,
      email,
      account_id: username,
      tier,
      registered_at: new Date().toISOString(),
      status: 'pending'
    }]));
    return id;
  }

  it('approve response includes sync status in message', async () => {
    const id = seedPendingRegistration({
      username: 'asyncapprove',
      email: 'async@example.com'
    });

    const res = await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id });

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

    const id = seedPendingRegistration({
      username: 'existuser2',
      phone: '777',
      email: 'existuser2@example.com'
    });

    const res = await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id });

    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/同步/);
  });

  it('approve writes proxy file in correct format', async () => {
    const id = seedPendingRegistration({
      username: 'approvefmt',
      phone: '888',
      email: 'approvefmt@example.com'
    });

    await request(app).post('/api/admin/approve')
      .set('x-admin-token', adminToken)
      .send({ id });

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
    expect(res.body.reachable.map(user => user.user_id)).toEqual(['withMail', 'expiredMail']);
    const reasons = Object.fromEntries(res.body.skipped.map(user => [user.user_id, user.reason]));
    expect(reasons.noMail).toBe('no_email');
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

  it('previews only explicitly selected eligible registry users', async () => {
    const proxyData = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    proxyData.users.push({
      token: 'g',
      user_id: 'secondMail',
      role: 'basic',
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      email: 'second@example.com'
    });
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify(proxyData));

    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Test',
        body: 'Hi {user_id}',
        selected_user_ids: ['secondMail']
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.reachable.map(user => user.user_id)).toEqual(['secondMail']);
    expect(res.body.selected_user_ids).toEqual(['secondMail']);
    expect(res.body.sample.text).toBe('Hi secondMail');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('includes expired human users when they still have a valid email', async () => {
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Test',
        body: 'Hi {user_id}, until {expires_date}',
        selected_user_ids: ['expiredMail']
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.reachable.map(user => user.user_id)).toEqual(['expiredMail']);
    expect(res.body.sample.text).toContain('Hi expiredMail');
  });

  it('supports manual-only recipients and personalizes with their display name', async () => {
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Test',
        body: 'Hi {user_id}; role={role}; expiry={expires_date}',
        selected_user_ids: [],
        manual_recipients: [{ email: 'friend@example.net', name: 'Kai Friend' }]
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.reachable).toHaveLength(1);
    expect(res.body.reachable[0]).toMatchObject({
      source: 'manual',
      user_id: 'Kai Friend',
      email: 'friend@example.net',
      role: 'manual'
    });
    expect(res.body.sample.text).toBe('Hi Kai Friend; role=manual; expiry=n/a');
  });

  it('deduplicates manual email addresses case-insensitively and keeps registry rows authoritative', async () => {
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Test',
        body: 'Hi {user_id}',
        selected_user_ids: ['withMail'],
        manual_recipients: [
          { email: 'WITH@example.com', name: 'Duplicate registry' },
          { email: 'manual@example.net', name: 'First manual' },
          { email: 'MANUAL@example.net', name: 'Duplicate manual' }
        ]
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.reachable.map(user => user.user_id)).toEqual(['withMail', 'First manual']);
    expect(res.body.duplicate_recipients).toHaveLength(2);
    expect(res.body.duplicate_recipients.every(item => item.reason === 'duplicate_email')).toBe(true);
  });

  it('rejects invalid manual email addresses', async () => {
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Test',
        body: 'Hi',
        selected_user_ids: [],
        manual_recipients: [{ email: 'not-an-email', name: 'Bad' }]
      });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_recipient_selection');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('rejects unknown and ineligible selected registry users', async () => {
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Test',
        body: 'Hi',
        selected_user_ids: ['missing-user', 'noMail']
      });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_selected_users');
    expect(res.body.invalid_selections).toEqual([
      { user_id: 'missing-user', reason: 'unknown_user' },
      { user_id: 'noMail', reason: 'no_email' }
    ]);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('returns 422 for an explicit empty selection', async () => {
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Test',
        body: 'Hi',
        selected_user_ids: [],
        manual_recipients: []
      });
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('no_recipients');
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
    expect(mockSendMail).toHaveBeenCalledTimes(2);
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

  it('fails closed when a selected registry email drifts after preview', async () => {
    setSmtpEnv();
    const payload = {
      subject: 'Update',
      body: 'Hi {user_id}',
      selected_user_ids: ['withMail'],
      manual_recipients: []
    };
    const preview = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send(payload);

    const proxyData = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    proxyData.users.find(user => user.user_id === 'withMail').email = 'changed@example.com';
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify(proxyData));

    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        ...payload,
        confirm: true,
        recipient_snapshot: preview.body.recipient_snapshot
      });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('recipient_snapshot_changed');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('does not let a preview for one user broaden into an all-user send', async () => {
    setSmtpEnv();
    const proxyData = JSON.parse(fs.readFileSync(TEST_PROXY_FILE, 'utf8'));
    proxyData.users.push({
      token: 'g',
      user_id: 'secondMail',
      role: 'basic',
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      email: 'second@example.com'
    });
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify(proxyData));

    const preview = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Update',
        body: 'Hi {user_id}',
        selected_user_ids: ['withMail']
      });
    const res = await request(app).post('/api/admin/announce/send')
      .set('x-admin-token', adminToken)
      .send({
        subject: 'Update',
        body: 'Hi {user_id}',
        confirm: true,
        recipient_snapshot: preview.body.recipient_snapshot
      });
    expect(res.statusCode).toBe(409);
    expect(res.body.reachable.map(user => user.user_id).sort()).toEqual([
      'expiredMail',
      'secondMail',
      'withMail'
    ]);
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

describe('Admin usage monitoring API', () => {
  let adminToken;

  const USAGE_LOG = path.join(TEST_DIR, 'usage-monitor.jsonl');
  const USAGE_EVENTS = [
    {
      event: 'http_request', request_id: 'r1', route: '/v1/history/bars', method: 'POST',
      user_id: 'usage_free_a', user_role: 'free', status: 200, cache_status: 'HIT',
      data_source: 'hot_cache', upstream_provider: 'alpaca', bytes_in: 10,
      bytes_out_hint: 1000, latency_ms: 5, error: null,
      timestamp: new Date(Date.now() - 3600000).toISOString()
    },
    {
      event: 'http_request', request_id: 'r2', route: '/v1/history/bars', method: 'POST',
      user_id: 'usage_free_a', user_role: 'free', status: 429, cache_status: 'MISS',
      data_source: 'upstream', upstream_provider: 'alpaca', bytes_in: 10,
      bytes_out_hint: 50, latency_ms: 5, error: 'rate_limited',
      timestamp: new Date(Date.now() - 7200000).toISOString()
    },
    {
      event: 'ws_session', user_id: 'usage_premium_b', user_role: 'premium', mode: 'stocks',
      status: 200, subject_count: 3, frames_out: 42, bytes_in: 1,
      bytes_out_hint: 2048, connection_seconds: 60,
      termination_cause: 'peer_normal_close',
      timestamp: new Date().toISOString()
    }
  ];

  const writeUsageFixtureUsers = () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify([
      {
        username: 'usage_free_a', phone: '15120992482', email: 'a@example.com',
        tier: 'free', registered_at: '2026-08-01T00:00:00Z', account_id: 'usage_free_a'
      },
      {
        username: 'usage_premium_b', phone: '18600000000', tier: 'premium',
        registered_at: '2026-08-02T00:00:00Z', account_id: 'usage_premium_b'
      }
    ]));
    fs.writeFileSync(PENDING_FILE, JSON.stringify([]));
  };

  const usageEvent = (overrides = {}) => ({
    event: 'http_request',
    request_id: 'usage-test',
    route: '/v1/test',
    method: 'GET',
    user_id: 'usage_free_a',
    user_role: 'free',
    status: 200,
    bytes_out_hint: 1,
    timestamp: new Date().toISOString(),
    ...overrides
  });

  const overview = () => request(app)
    .get('/api/admin/usage/overview')
    .set('x-admin-token', adminToken);

  beforeAll(async () => {
    process.env.USAGE_LOG_PATH = USAGE_LOG;
    const login = await request(app).post('/api/admin/login').send({ password: 'admin123' });
    adminToken = login.body.token;
  });

  // The file-level resetTestData() empties portal data before every test.
  // Reset the append-only log and its reader state too, so each regression has
  // a deterministic snapshot boundary.
  beforeEach(() => {
    fs.writeFileSync(USAGE_LOG, USAGE_EVENTS.map(e => JSON.stringify(e)).join('\n') + '\n');
    __resetUsageAggregatorForTest();
    writeUsageFixtureUsers();
  });

  afterAll(() => {
    delete process.env.USAGE_LOG_PATH;
    __resetUsageAggregatorForTest();
  });

  test('requires admin auth on every usage endpoint', async () => {
    for (const pathName of [
      '/api/admin/usage/overview',
      '/api/admin/usage/user?id=usage_free_a',
      '/api/admin/users/search?q=15120992482'
    ]) {
      const res = await request(app).get(pathName);
      expect(res.statusCode).toBe(401);
    }
  });

  test('overview aggregates http and ws usage with registry join', async () => {
    const res = await request(app)
      .get('/api/admin/usage/overview')
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.log_available).toBe(true);
    expect(res.body.totals.requests_today_utc).toBe(2);
    expect(res.body.totals.ws_sessions_7d_utc).toBe(1);
    expect(res.body.totals.errors_7d_utc).toBe(1);
    const freeRow = res.body.users.find(u => u.user_id === 'usage_free_a');
    expect(freeRow.requests_today_utc).toBe(2);
    expect(freeRow.errors_7d_utc).toBe(1);
    const premiumRow = res.body.users.find(u => u.user_id === 'usage_premium_b');
    expect(premiumRow.ws_sessions_7d_utc).toBe(1);
    // recent registrations include the portal users joined with registry roles
    const regA = res.body.recent_registrations.find(r => r.username === 'usage_free_a');
    expect(regA).toBeTruthy();
    expect(regA.phone).toBe('15120992482');
  });

  test('search finds a user by phone number, username, and email', async () => {
    for (const query of ['15120992482', 'usage_free_a', 'a@example.com']) {
      const res = await request(app)
        .get(`/api/admin/users/search?q=${encodeURIComponent(query)}`)
        .set('x-admin-token', adminToken);
      expect(res.statusCode).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.items[0].user_id).toBe('usage_free_a');
      expect(res.body.items[0].usage.requests_today_utc).toBe(2);
    }
  });

  test('user detail returns daily series and routes without tokens', async () => {
    fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({ users: [{
      user_id: 'usage_free_a',
      role: 'free',
      token: 'registry-secret-token',
      secret_registry_field: 'must-not-leak'
    }] }));
    const res = await request(app)
      .get('/api/admin/usage/user?id=usage_free_a')
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.user_id).toBe('usage_free_a');
    expect(res.body.daily_14d).toHaveLength(14);
    expect(res.body.top_routes[0].route).toBe('/v1/history/bars');
    expect(JSON.stringify(res.body)).not.toContain('registry-secret-token');
    expect(JSON.stringify(res.body)).not.toContain('must-not-leak');
  });

  test('user detail returns 404 for unknown user', async () => {
    const res = await request(app)
      .get('/api/admin/usage/user?id=nobody_here')
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(404);
  });

  test('user detail rejects missing id', async () => {
    const res = await request(app)
      .get('/api/admin/usage/user')
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(400);
  });

  test('full reload picks up appended events', async () => {
    const appended = {
      event: 'http_request', request_id: 'r3', route: '/v2/stocks/AAPL/snapshot',
      method: 'GET', user_id: 'usage_free_a', user_role: 'free', status: 200,
      cache_status: 'BYPASS', data_source: 'stream_passthrough', bytes_in: 0,
      bytes_out_hint: 500, latency_ms: 9, error: null,
      timestamp: new Date().toISOString()
    };
    fs.appendFileSync(USAGE_LOG, JSON.stringify(appended) + '\n');
    __resetUsageAggregatorForTest();
    const res = await request(app)
      .get('/api/admin/usage/overview')
      .set('x-admin-token', adminToken);
    expect(res.statusCode).toBe(200);
    const freeRow = res.body.users.find(u => u.user_id === 'usage_free_a');
    expect(freeRow.requests_today_utc).toBe(3);
  });

  test('does not consume an unterminated EOF fragment and ingests it once after its newline arrives', async () => {
    const first = usageEvent({ user_id: 'partial_first', timestamp: new Date().toISOString() });
    const second = usageEvent({ user_id: 'partial_second', timestamp: new Date().toISOString() });
    fs.writeFileSync(USAGE_LOG, `${JSON.stringify(first)}\n${JSON.stringify(second)}`);
    __resetUsageAggregatorForTest();

    let res = await overview();
    expect(res.body.users.map(row => row.user_id)).toEqual(['partial_first']);
    expect(res.body.log_coverage.retained_events).toBe(1);
    expect(res.body.log_coverage.trailing_fragment_bytes).toBeGreaterThan(0);

    fs.appendFileSync(USAGE_LOG, '\n');
    await __refreshUsageAggregatorForTest();
    res = await overview();
    expect(res.body.users.map(row => row.user_id).sort()).toEqual(['partial_first', 'partial_second']);
    expect(res.body.log_coverage.retained_events).toBe(2);
  });

  test('scans only the fixed snapshot boundary when a writer appends concurrently', async () => {
    await overview();
    const atSnapshot = usageEvent({ user_id: 'snapshot_user', timestamp: new Date().toISOString() });
    const afterSnapshot = usageEvent({ user_id: 'after_snapshot_user', timestamp: new Date().toISOString() });
    fs.appendFileSync(USAGE_LOG, `${JSON.stringify(atSnapshot)}\n`);
    __setUsageAggregatorTestHooks({
      afterSnapshot: () => {
        fs.appendFileSync(USAGE_LOG, `${JSON.stringify(afterSnapshot)}\n`);
        __setUsageAggregatorTestHooks(null);
      }
    });

    await __refreshUsageAggregatorForTest();
    let res = await overview();
    expect(res.body.users.find(row => row.user_id === 'snapshot_user')).toBeTruthy();
    expect(res.body.users.find(row => row.user_id === 'after_snapshot_user')).toBeFalsy();

    await __refreshUsageAggregatorForTest();
    res = await overview();
    expect(res.body.users.find(row => row.user_id === 'after_snapshot_user')).toBeTruthy();
  });

  test('inode replacement resets coverage and aggregates before a full reload', async () => {
    await overview();
    const rotated = `${USAGE_LOG}.rotated`;
    const replacement = usageEvent({ user_id: 'rotated_user', timestamp: new Date().toISOString() });
    fs.writeFileSync(rotated, `${JSON.stringify(replacement)}\n`);
    fs.renameSync(rotated, USAGE_LOG);

    await __refreshUsageAggregatorForTest();
    const res = await overview();
    expect(res.body.users.map(row => row.user_id)).toEqual(['rotated_user']);
    expect(res.body.log_coverage.retained_events).toBe(1);
  });

  test('truncation resets coverage and aggregates before a full reload', async () => {
    await overview();
    const replacement = usageEvent({ user_id: 'truncated_user', timestamp: new Date().toISOString() });
    fs.writeFileSync(USAGE_LOG, `${JSON.stringify(replacement)}\n`);

    await __refreshUsageAggregatorForTest();
    const res = await overview();
    expect(res.body.users.map(row => row.user_id)).toEqual(['truncated_user']);
    expect(res.body.log_coverage.retained_events).toBe(1);
  });

  test('prunes users, roles, routes, recent events, coverage, and counters as the 35-day window advances', async () => {
    const nowMs = Date.now();
    const retained = usageEvent({
      user_id: 'retention_user',
      user_role: 'premium',
      route: '/v1/retained',
      timestamp: new Date(nowMs - 34 * 86400000).toISOString()
    });
    fs.writeFileSync(USAGE_LOG, `${JSON.stringify(retained)}\n`);
    __resetUsageAggregatorForTest();

    let res = await overview();
    expect(res.body.users.find(row => row.user_id === 'retention_user').roles).toEqual(['premium']);
    expect(res.body.log_coverage.retained_events).toBe(1);

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs + 2 * 86400000);
    await __refreshUsageAggregatorForTest();
    nowSpy.mockRestore();

    res = await overview();
    expect(res.body.users.find(row => row.user_id === 'retention_user')).toBeFalsy();
    expect(res.body.totals.requests_30d_utc).toBe(0);
    expect(res.body.log_coverage.retained_events).toBe(0);
    const detail = await request(app)
      .get('/api/admin/usage/user?id=retention_user')
      .set('x-admin-token', adminToken);
    expect(detail.statusCode).toBe(404);
  });

  test('reuses an in-flight refresh promise even after more than one minute', async () => {
    let release;
    let snapshots = 0;
    const waitForRelease = new Promise(resolve => { release = resolve; });
    __setUsageAggregatorTestHooks({
      afterSnapshot: async () => {
        snapshots += 1;
        await waitForRelease;
      }
    });

    const first = __refreshUsageAggregatorForTest();
    await Promise.resolve();
    const originalNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(originalNow + 61000);
    const second = __refreshUsageAggregatorForTest();
    expect(second).toBe(first);
    expect(snapshots).toBe(1);
    release();
    await first;
    nowSpy.mockRestore();
  });

  test('uses explicit UTC calendar-day windows and counts WS-only users as active', async () => {
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const eventAtDay = (daysAgo, userId, event = 'http_request') => usageEvent({
      event,
      user_id: userId,
      route: event === 'http_request' ? '/v1/window' : undefined,
      mode: event === 'ws_session' ? 'stocks' : undefined,
      timestamp: new Date(todayStart - daysAgo * 86400000 + 12 * 3600000).toISOString()
    });
    const events = [
      eventAtDay(0, 'window_http'),
      eventAtDay(6, 'window_http'),
      eventAtDay(7, 'window_http'),
      eventAtDay(29, 'window_http'),
      eventAtDay(30, 'window_http'),
      eventAtDay(0, 'window_ws_only', 'ws_session')
    ];
    fs.writeFileSync(USAGE_LOG, `${events.map(event => JSON.stringify(event)).join('\n')}\n`);
    __resetUsageAggregatorForTest();

    const res = await overview();
    const http = res.body.users.find(row => row.user_id === 'window_http');
    expect(http.requests_today_utc).toBe(1);
    expect(http.requests_7d_utc).toBe(2);
    expect(http.requests_30d_utc).toBe(4);
    expect(res.body.active_users).toEqual({
      today_utc: 2,
      last_7_utc_days: 2,
      last_30_utc_days: 2
    });
    const source = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8');
    expect(source).toContain('今天（UTC）');
    expect(source).toContain('近 7 天（UTC）');
    expect(source).not.toContain('HTTP 请求 24h');
  });
});
