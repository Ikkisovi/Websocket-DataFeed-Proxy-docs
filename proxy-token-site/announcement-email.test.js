const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { JSDOM } = require('jsdom');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leandata-email-format-'));
process.env.DATA_DIR = root;
process.env.PROXY_USERS_FILE = path.join(root, 'registry.json');
process.env.ADMIN_PASSWORD = 'email-format-test-only';
process.env.BYPASS_SYNC = 'true';
process.env.SMTP_HOST = 'smtp.example.test';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = 'sender@example.test';
process.env.SMTP_PASSWORD = 'fake-test-password';
process.env.MAIL_FROM = 'sender@example.test';

const { app, __buildSmtpMessageForTest: buildMessage } = require('./server');
const send = jest.fn().mockResolvedValue({});
let token;
const payload = {
  subject: '服务更新 & Release', body: 'Headline\nBold and italic\nFirst item',
  body_html: '<h2>Headline</h2><h3>Details</h3><p><strong>Bold</strong> and <em>italic</em></p>'
    + '<ul><li>First item</li></ul><ol><li>Numbered</li></ol>'
    + '<p><a href="https://leandata.uk/updates">Read more</a></p>'
};
const post = data => request(app).post('/api/admin/announce/send').set('X-Admin-Token', token).send(data);
const document = html => new JSDOM(html).window.document;

beforeAll(async () => {
  token = (await request(app).post('/api/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token;
});
beforeEach(() => {
  send.mockClear();
  app.locals.announceSendMail = send;
  fs.writeFileSync(process.env.PROXY_USERS_FILE, JSON.stringify({ users: [
    { user_id: 'operator', email: 'operator@example.test', role: 'free' }
  ] }));
});
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

test('dry run retains rich semantics with inline styles and the verification email footer', async () => {
  const result = await post(payload);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ dry_run: true, format: 'multipart/alternative' });
  const doc = document(result.body.html);
  expect(doc.querySelector('h1').textContent).toBe(payload.subject);
  expect(doc.querySelector('h1').style.fontWeight).toBe('700');
  expect(doc.querySelector('h2').textContent).toBe('Headline');
  expect(doc.querySelector('h3').textContent).toBe('Details');
  expect(doc.querySelector('strong').style.fontWeight).toBe('700');
  expect(doc.querySelector('em').style.fontStyle).toBe('italic');
  expect(doc.querySelector('ul li').textContent).toBe('First item');
  expect(doc.querySelector('ol li').textContent).toBe('Numbered');
  expect(doc.querySelector('a').href).toBe('https://leandata.uk/updates');
  expect(result.body.sample.html).toBe(result.body.html);
  expect(result.body.sample.text).toBe(payload.body);
  const verification = (await request(app).get('/api/admin/email-template').set('X-Admin-Token', token)).body;
  const footer = verification.preview.html.match(/<hr[\s\S]*?<\/p>/)[0];
  expect(result.body.html).toContain(footer);
  expect(verification.preview.html).toContain('123456');
  expect(result.body.html).not.toContain('验证码');
  expect(send).not.toHaveBeenCalled();
});

test('confirmed send passes both alternatives and actual MIME contains decoded styled HTML', async () => {
  const preview = await post(payload);
  const result = await post({ ...payload, confirm: true, recipient_snapshot: preview.body.recipient_snapshot });
  expect(result.body.success).toBe(true);
  expect(result.body.format).toBe('multipart/alternative');
  expect(send).toHaveBeenCalledTimes(1);
  const mail = send.mock.calls[0][0];
  expect(mail.text).toBe(payload.body);
  expect(mail.html).toBe(preview.body.html);
  const mime = buildMessage({ ...mail, from: mail.config.from, fromName: 'Leandata' });
  expect(mime).toContain('Content-Type: multipart/alternative;');
  const boundary = mime.match(/boundary="([^"]+)"/)[1];
  const parts = mime.split('--' + boundary);
  const decoded = type => {
    const part = parts.find(part => part.includes('Content-Type: ' + type + ';'));
    return Buffer.from(part.split('\r\n\r\n')[1].trim(), 'base64').toString('utf8');
  };
  expect(decoded('text/plain')).toBe(payload.body);
  expect(decoded('text/html')).toBe(preview.body.html);
  expect(document(decoded('text/html')).querySelector('strong').style.fontWeight).toBe('700');
  const log = JSON.parse(fs.readFileSync(path.join(root, 'announce-log.jsonl'), 'utf8').trim().split('\n').at(-1));
  expect(log.format).toBe('multipart/alternative');
  expect(log.html_sha256).toBe(preview.body.html_sha256);
});

test('test_to sends exactly one rich email through the same template', async () => {
  const preview = await post(payload);
  const result = await post({ ...payload, test_to: 'operator-preview@example.test' });
  expect(result.body.success).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toMatchObject({ to: 'operator-preview@example.test', text: payload.body, html: preview.body.html });
});

test('unsafe author markup is removed while links and emphasis survive', async () => {
  const result = await post({ ...payload, subject: '<img src=x> & Title',
    body_html: '<script>alert(1)</script><img src=x onerror=alert(1)><p onclick="alert(1)" style="display:none">'
      + '<b>Visible</b><a href="javascript:alert(1)">Bad link</a><a href="https://leandata.uk">Good</a></p>' });
  const doc = document(result.body.html);
  expect(doc.querySelector('h1').textContent).toBe('<img src=x> & Title');
  expect(doc.querySelectorAll('script,img,[onclick],[onerror]')).toHaveLength(0);
  expect(doc.querySelector('p').style.display).toBe('');
  expect(doc.querySelector('b').style.fontWeight).toBe('700');
  expect(doc.querySelector('a').hasAttribute('href')).toBe(false);
  expect(result.body.html).not.toContain('javascript:');
  expect(send).not.toHaveBeenCalled();
});

test('personalization escapes recipient display names without creating markup', async () => {
  const name = '<img src=x onerror=alert(1)> & Reader';
  const result = await post({ subject: 'Welcome', body: 'Hi {user_id}', body_html: '<p>Hi <b>{user_id}</b></p>',
    selected_user_ids: [], manual_recipients: [{ email: 'reader@example.test', name }] });
  const doc = document(result.body.sample.html);
  expect(doc.querySelector('b').textContent).toBe(name);
  expect(doc.querySelector('img')).toBeNull();
  expect(result.body.sample.text).toBe('Hi ' + name);
  expect(result.body.html).toContain('{user_id}');
});

test('legacy plain-text callers get an escaped HTML alternative without changing their text', async () => {
  const body = 'Hello <script>literal</script>\nSecond line & detail';
  const result = await post({ subject: 'Legacy', body });
  expect(result.body.sample.text).toBe(body);
  const doc = document(result.body.html);
  expect(doc.querySelector('script')).toBeNull();
  expect(doc.querySelector('p').textContent).toBe(body.replace('\n', ''));
  expect(doc.querySelector('p br')).not.toBeNull();
});

test.each([42, null, {}, 'x'.repeat(100001)])('rejects invalid HTML field before sending', async body_html => {
  const result = await post({ ...payload, body_html, confirm: true });
  expect(result.status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});

test('HTML mail remains admin-only', async () => {
  const result = await request(app).post('/api/admin/announce/send').send(payload);
  expect(result.status).toBe(401);
  expect(send).not.toHaveBeenCalled();
});
