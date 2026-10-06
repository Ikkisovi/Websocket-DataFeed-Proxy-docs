const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leandata-from-update-'));
process.env.DATA_DIR = root;
process.env.PROXY_USERS_FILE = path.join(root, 'registry.json');
process.env.ADMIN_PASSWORD = 'from-update-test-only';
process.env.BYPASS_SYNC = 'true';

const { app } = require('./server');
let token;

beforeAll(async () => {
  token = (await request(app).post('/api/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token;
});

async function makeDraft(overrides = {}) {
  const res = await request(app).post('/api/admin/product-updates')
    .set('X-Admin-Token', token)
    .send({
      title: 'Morningstar v3 上线', title_en: 'Morningstar v3 is live',
      tag: 'test', date: '2026-10-06', status: 'draft',
      body_html: '<p>中文正文</p><ul><li>要点一</li></ul>',
      body_en_html: '<p>English body</p>',
      ...overrides
    });
  expect(res.status).toBe(201);
  return res.body.update;
}

test('converts a saved draft into a branded HTML email template', async () => {
  const draft = await makeDraft();
  const res = await request(app).post('/api/admin/announce/from-update')
    .set('X-Admin-Token', token)
    .send({ id: draft.id });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.subject).toContain('Morningstar v3 上线');
  expect(res.body.subject).toContain('Morningstar v3 is live');
  expect(res.body.body_html).toContain('中文正文');
  expect(res.body.body_html).toContain('English body');
  expect(res.body.body_html).not.toContain('<h2>English</h2>');
  expect(res.body.html).toContain('<!doctype html>');
  expect(res.body.html).toContain('中文正文');
  expect(res.body.source).toEqual({ id: draft.id, version: 1, status: 'draft' });
  const crypto = require('crypto');
  expect(res.body.htmlSha256)
    .toBe(crypto.createHash('sha256').update(res.body.html).digest('hex'));
});

test('rejects unknown ids and empty bodies', async () => {
  const missing = await request(app).post('/api/admin/announce/from-update')
    .set('X-Admin-Token', token).send({ id: 'update_does_not_exist' });
  expect(missing.status).toBe(404);
  const noId = await request(app).post('/api/admin/announce/from-update')
    .set('X-Admin-Token', token).send({});
  expect(noId.status).toBe(400);
  const empty = await makeDraft({ body_html: '', body_en_html: '' });
  const res = await request(app).post('/api/admin/announce/from-update')
    .set('X-Admin-Token', token).send({ id: empty.id });
  expect(res.status).toBe(400);
});

test('requires admin auth', async () => {
  const res = await request(app).post('/api/admin/announce/from-update')
    .send({ id: 'update_x' });
  expect(res.status).toBe(401);
});

test('renders bilingual subject as title plus muted subtitle', async () => {
  const draft = await makeDraft();
  const res = await request(app).post('/api/admin/announce/from-update')
    .set('X-Admin-Token', token)
    .send({ id: draft.id });
  expect(res.status).toBe(200);
  expect(res.body.html).toContain('font-size:28px');
  expect(res.body.html).toContain('font-size:16px');
  expect(res.body.html).toContain('Morningstar v3 is live');
});
