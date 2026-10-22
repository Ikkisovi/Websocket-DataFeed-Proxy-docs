const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'research-gate-'));
const TEST_DATA_DIR = path.join(TEST_DIR, 'data');
const TEST_PROXY_FILE = path.join(TEST_DIR, 'proxy-users.json');
const PRIVATE_DIR = path.join(TEST_DIR, 'private-research');
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(PRIVATE_DIR, 'factor-stats', 'data'), { recursive: true });
fs.writeFileSync(path.join(PRIVATE_DIR, 'factor-stats', 'data', 'index.json'), '{"factors":[]}');
for (const [key, value] of Object.entries({
  DATA_DIR: TEST_DATA_DIR, PROXY_USERS_FILE: TEST_PROXY_FILE, THINKCENTRE_HOST: 'nobody@127.0.0.1', BYPASS_SYNC: 'true',
  PROXY_RT_URL: 'http://127.0.0.1:1', PROXY_REST_URL: 'http://127.0.0.1:1', PROXY_WS_HOST: '127.0.0.1', PROXY_WS_PORT: '1',
  ACCESS_LOG_DIR: path.join(TEST_DIR, 'access'), EMAIL_VERIFY_SECRET: 'test-secret', EMAIL_TEST_MODE: 'memory',
  RESEARCH_PRIVATE_DIR: PRIVATE_DIR, USD_CAD_RATE_OVERRIDE: '1.2',
})) process.env[key] = value;
fs.mkdirSync(process.env.ACCESS_LOG_DIR, { recursive: true });

const request = require('supertest');
const { app, TIERS, computeExpiry } = require('./server');
const researchAccess = require('./commerce/research-access.cjs');

const USERS_FILE = path.join(TEST_DATA_DIR, 'users.json');
let sequence = 0;

function seed(tier, { expiry } = {}) {
  const userId = `research-${tier}`;
  const def = TIERS[tier];
  fs.writeFileSync(USERS_FILE, JSON.stringify([{
    username: userId, phone: '6045550199', role: def.role, tier, email: `${userId}@example.com`, permissions: def.permissions,
  }]));
  fs.writeFileSync(TEST_PROXY_FILE, JSON.stringify({ users: [{
    token: `${userId}-token-1234567890`, user_id: userId, role: def.role,
    expires_at: expiry === undefined ? (tier === 'free' ? null : computeExpiry(def)) : expiry, email: `${userId}@example.com`, permissions: def.permissions,
  }] }));
  return { user_id: userId, phone: '6045550199', token: `${userId}-token-1234567890`, email: `${userId}@example.com` };
}
async function cookieFor(account) {
  sequence += 1;
  const res = await request(app).post('/api/account/login').set('x-forwarded-for', `203.0.113.${sequence}`)
    .send({ credential: { user_id: account.user_id, phone: account.phone, token: account.token }, email: account.email });
  expect(res.statusCode).toBe(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

describe('research access roles', () => {
  it('admits Basic and above and keeps free, expired and unknown roles out', () => {
    for (const role of ['basic', 'value', 'standard', 'premium', 'Premium']) expect(researchAccess.evaluate(role).allowed).toBe(true);
    for (const role of ['free', '', null, undefined, 'china', 'nonsense']) expect(researchAccess.evaluate(role).allowed).toBe(false);
  });
  it('lets operators narrow the list without a code change', () => {
    expect(researchAccess.evaluate('basic', { RESEARCH_ALLOWED_ROLES: 'premium' }).allowed).toBe(false);
  });
});

describe('gated research pages', () => {
  it('keeps the reports landing and its bundles public, without the article text', async () => {
    expect((await request(app).get('/reports/')).statusCode).toBe(200);
    const bundle = await request(app).get('/assets/reports-page.js');
    expect(bundle.statusCode).toBe(200);
    expect(bundle.text).not.toContain('A_rank5_5d');
    expect((await request(app).get('/reports/locked.html')).statusCode).toBe(200);
  });

  it('answers anonymous visitors with 401, a locked page for browsers and JSON for data', async () => {
    const page = await request(app).get('/reports/factor-stats/').set('Accept', 'text/html');
    expect(page.statusCode).toBe(401);
    expect(page.headers['x-research-access']).toBe('anonymous');
    expect(page.text).toContain('id="actions"');
    expect(page.text).not.toContain('factor-stats.js');
    for (const url of ['/reports/factor-stats/data/index.json', '/reports/brain-stock-ranking/article.js',
      '/reports/brain-stock-ranking/same-basis-metrics.csv', '/reports/brain-stock-ranking/analysis.json', '/reports/brain-stock-ranking/']) {
      const res = await request(app).get(url).set('Accept', url.endsWith('/') ? 'text/html' : '*/*');
      expect(res.statusCode).toBe(401);
      expect(res.text).not.toContain('A_rank5_5d');
    }
    const api = await request(app).get('/api/research/access');
    expect(api.body).toEqual({ state: 'anonymous', allowed: false, plan: null });
  });

  it('answers a free account with 403 and tells the page which plan it holds', async () => {
    const cookie = await cookieFor(seed('free'));
    for (const url of ['/reports/factor-stats/data/index.json', '/reports/brain-stock-ranking/article.js']) {
      const res = await request(app).get(url).set('Cookie', cookie);
      expect(res.statusCode).toBe(403);
      expect(res.headers['x-research-access']).toBe('insufficient');
    }
    const api = await request(app).get('/api/research/access').set('Cookie', cookie);
    expect(api.body).toEqual({ state: 'insufficient', allowed: false, plan: 'free' });
  });

  it('answers an expired Basic account like a free one', async () => {
    const cookie = await cookieFor(seed('basic', { expiry: '2020-01-01T00:00:00.000Z' }));
    const res = await request(app).get('/reports/factor-stats/data/index.json').set('Cookie', cookie);
    expect(res.statusCode).toBe(403);
  });

  for (const tier of ['basic', 'standard', 'premium']) {
    it(`serves ${tier} accounts the pages, the article bundle and the statistics, never cached`, async () => {
      const cookie = await cookieFor(seed(tier));
      const page = await request(app).get('/reports/factor-stats/').set('Cookie', cookie).set('Accept', 'text/html');
      expect(page.statusCode).toBe(200);
      expect(page.text).toContain('factor-stats.js');
      const data = await request(app).get('/reports/factor-stats/data/index.json').set('Cookie', cookie);
      expect(data.statusCode).toBe(200);
      expect(data.headers['cache-control']).toBe('private, no-store');
      expect(data.body).toEqual({ factors: [] });
      const article = await request(app).get('/reports/brain-stock-ranking/article.js').set('Cookie', cookie);
      expect(article.statusCode).toBe(200);
      expect(article.text).toContain('A_rank5_5d');
      expect((await request(app).get('/api/research/access').set('Cookie', cookie)).body.allowed).toBe(true);
    });
  }

  it('does not serve files outside the private statistics directory', async () => {
    const cookie = await cookieFor(seed('basic'));
    const res = await request(app).get('/reports/factor-stats/data/..%2f..%2f..%2fproxy-users.json').set('Cookie', cookie);
    expect([400, 403, 404]).toContain(res.statusCode);
  });
});
