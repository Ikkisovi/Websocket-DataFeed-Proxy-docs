const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const tls = require('tls');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD_FILE = process.env.ADMIN_PASSWORD_FILE
  || path.join(DATA_DIR, 'admin-password.env');
const STRIPE_PAYMENT_ENV_FILE = process.env.STRIPE_PAYMENT_ENV_FILE
  || path.join(DATA_DIR, 'stripe-payment.env');
const ZPAY_PAYMENT_ENV_FILE = process.env.ZPAY_PAYMENT_ENV_FILE
  || path.join(DATA_DIR, 'zpay-payment.env');

function configuredAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    const stat = fs.statSync(ADMIN_PASSWORD_FILE);
    if ((stat.mode & 0o077) !== 0) return '';
    const password = fs.readFileSync(ADMIN_PASSWORD_FILE, 'utf8').trim();
    if (!password || /[\r\n]/.test(password)) return '';
    return password;
  } catch {
    // Tests retain the historical local default. Production fails closed.
    return process.env.NODE_ENV === 'test' ? 'admin123' : '';
  }
}

app.use(cors());
app.post(
  '/api/payment/stripe/webhook',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);
app.all(
  '/api/payment/zpay/notify',
  express.urlencoded({ extended: false }),
  handleZpayNotification
);
app.use(bodyParser.json());

// Mobile UA detection — serve mobile.html for phones/tablets
app.use((req, res, next) => {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i.test(ua);
  if (isMobile) {
    const mobileHome = path.join(__dirname, 'public', 'mobile.html');
    const mobileDocs = path.join(__dirname, 'public', 'docs', 'mobile.html');
    if ((req.path === '/' || req.path === '/index.html') && fs.existsSync(mobileHome)) {
      return res.sendFile(mobileHome);
    }
    if ((req.path === '/docs' || req.path === '/docs/' || req.path === '/docs/index.html')
      && fs.existsSync(mobileDocs)) {
      return res.sendFile(mobileDocs);
    }
    if ((req.path === '/register' || req.path === '/register.html')
      && fs.existsSync(path.join(__dirname, 'public', 'register-mobile.html'))) {
      return res.sendFile(path.join(__dirname, 'public', 'register-mobile.html'));
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Clean URL routes (no .html suffix needed)
app.get('/updates', (req, res) => res.sendFile(path.join(__dirname, 'public', 'updates.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/account', (req, res) => res.sendFile(path.join(__dirname, 'public', 'account.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, 'public', 'checkout.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// --- Data paths (overridable for tests via env) ---
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const BULK_ORDERS_FILE = path.join(DATA_DIR, 'bulk-orders.json');
const PAYMENT_ORDERS_FILE = path.join(DATA_DIR, 'payment-orders.json');
const PRODUCT_FEEDBACK_FILE = path.join(DATA_DIR, 'product-update-feedback.json');
const EMAIL_VERIFICATION_FILE = path.join(DATA_DIR, 'email-verifications.json');
const EMAIL_TEMPLATE_FILE = path.join(DATA_DIR, 'email-template.json');
const EMAIL_ENV_FILE = process.env.EMAIL_ENV_FILE || path.join(DATA_DIR, 'email.env');

const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_RESEND_COOLDOWN_MS = Number(process.env.EMAIL_CODE_RESEND_COOLDOWN_MS || 60 * 1000);
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODE_SEND_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_CODE_SEND_MAX = 5;

function readPrivateEnvFile(filepath) {
  try {
    const stat = fs.statSync(filepath);
    if ((stat.mode & 0o077) !== 0) return {};
    const values = {};
    for (const rawLine of fs.readFileSync(filepath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (value.length >= 2
        && ((value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

const EMAIL_TEMPLATE_PLACEHOLDERS = ['code', 'email', 'expires_minutes', 'site_name'];
const verificationSendAttempts = new Map();
const testVerificationEmails = [];

function currentEmailConfig() {
  const announceEnvFile = process.env.ANNOUNCE_SMTP_ENV_FILE
    || path.join(DATA_DIR, 'announce-smtp.env');
  return {
    ...readPrivateEnvFile(EMAIL_ENV_FILE),
    ...readPrivateEnvFile(announceEnvFile),
    ...process.env
  };
}

function emailSetting(name) {
  return String(currentEmailConfig()[name] || '').trim();
}

const DEFAULT_EMAIL_TEMPLATE = {
  subject: '{{site_name}} 邮箱验证码',
  text: [
    '您好，',
    '',
    '您正在注册 {{site_name}}。',
    '您的邮箱验证码是：{{code}}',
    '',
    '验证码在 {{expires_minutes}} 分钟内有效。',
    '如果不是您本人操作，请忽略此邮件。',
    '',
    '---',
    'Leandata Technologies Ltd.',
    '700 W Georgia St, Vancouver, BC V7Y 1B6, Canada',
    'https://leandata.uk'
  ].join('\n'),
  html: [
    '<div style="font-family:Arial,sans-serif;line-height:1.7;color:#25211d">',
    '<p>您好，</p>',
    '<p>您正在注册 {{site_name}}。</p>',
    '<p>您的邮箱验证码是：</p>',
    '<p style="font-size:32px;font-weight:700;letter-spacing:0.28em;color:#176b72">{{code}}</p>',
    '<p>验证码在 {{expires_minutes}} 分钟内有效。如果不是您本人操作，请忽略此邮件。</p>',
    '<hr style="border:0;border-top:1px solid #e0e0e0;margin:24px 0 16px" />',
    '<p style="font-size:12px;color:#888888;line-height:1.6;margin:0">',
    '  <strong>Leandata Technologies Ltd.</strong><br />',
    '  700 W Georgia St, Vancouver, BC V7Y 1B6, Canada<br />',
    '  <a href="https://leandata.uk" style="color:#176b72;text-decoration:none">https://leandata.uk</a>',
    '</p>',
    '</div>'
  ].join('')
};

const CLOUD_HOST_LABEL = process.env.CLOUD_HOST_LABEL || 'Aliyun';
const IS_CLOUD_HOST = fs.existsSync('/srv/leandata') || fs.existsSync('/mnt/leandata-v2') || fs.existsSync('/home/opc');

const PROXY_USERS_FILE = process.env.PROXY_USERS_FILE
  || path.join(__dirname, 'remote_proxy', 'users.json');

// --- Legacy remote sync config. Aliyun v2 keeps users.json local and shared by mount. ---
const EC2_HOST = process.env.EC2_HOST || 'ec2-user@52.37.182.24';
const EC2_USERS_PATH = process.env.EC2_USERS_PATH || '/home/ec2-user/cloud-proxy/users.json';
const EC2_SSH_KEY = process.env.EC2_SSH_KEY
  || (IS_CLOUD_HOST && fs.existsSync('/tmp/ec2_ed25519.pem') ? '/tmp/ec2_ed25519.pem'
    : IS_CLOUD_HOST && fs.existsSync('/home/opc/.ssh/ec2_ed25519.pem') ? '/home/opc/.ssh/ec2_ed25519.pem'
    : '/home/kai/.ssh/id_ed25519');

// --- Startup guard: warn if configuration paths mismatch current environment ---
(function startupPathGuard() {
  if (IS_CLOUD_HOST) {
    const expectedProxy = path.join(__dirname, 'remote_proxy', 'users.json');
    if (PROXY_USERS_FILE !== expectedProxy) {
      console.error(`\n⚠️  [GUARD] PROXY_USERS_FILE = "${PROXY_USERS_FILE}"`);
      console.error(`   Expected on ${CLOUD_HOST_LABEL}: "${expectedProxy}"`);
      console.error(`   This will cause users to be lost from the proxy registry!`);
      console.error(`   Fix: set PROXY_USERS_FILE env or ensure the path exists.\n`);
    }
    if (process.env.BYPASS_SYNC !== 'true' && !EC2_SSH_KEY.includes('ec2_ed25519') && !EC2_SSH_KEY.includes('oracle_key')) {
      console.error(`\n⚠️  [GUARD] EC2_SSH_KEY = "${EC2_SSH_KEY}"`);
      console.error(`   Legacy remote sync may fail with wrong key!\n`);
    }
  }
})();

// --- Service tier definitions ---
// Tiers control endpoint/channel permissions. Current runtime capacity limits
// are documented separately and must not be presented as tier entitlements.
const TIERS = {
  free: {
    role: 'free',
    expiryDays: 30,
    permissions: {
      ws: { stocks: true, options: true, overnight: true, crypto: true, news: true, boats: true, test: true },
      rest: { stocks_history: true, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: true, admin_token_lookup: false, news_history: true }
    }
  },
  trial: {
    role: 'standard',
    expiryDays: 3,
    permissions: {
      ws: { stocks: true, options: true, overnight: true, crypto: true, news: true, boats: true, test: true },
      rest: { stocks_history: true, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
    }
  },
  basic: {
    role: 'basic',
    expiryDays: 30,
    permissions: {
      ws: { stocks: false, options: false, overnight: false, crypto: false, news: false, boats: false, test: false },
      rest: { stocks_history: true, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
    }
  },
  value: {
    role: 'value',
    expiryDays: 30,
    modes: {
      stocks: {
        ws: { stocks: true, options: true, overnight: true, crypto: true, news: true, boats: true, test: true },
        rest: { stocks_history: true, options_history: false, options_contracts: false, options_snapshots: false, options_snapshots_expiry: false, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
      },
      options: {
        ws: { stocks: true, options: true, overnight: true, crypto: true, news: true, boats: true, test: true },
        rest: { stocks_history: false, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
      }
    },
    // Default permissions (used when mode not specified — shouldn't happen but safe fallback)
    permissions: {
      ws: { stocks: true, options: true, overnight: true, crypto: true, news: true, boats: true, test: true },
      rest: { stocks_history: true, options_history: false, options_contracts: false, options_snapshots: false, options_snapshots_expiry: false, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
    }
  },
  standard: {
    role: 'standard',
    expiryDays: 30,
    permissions: {
      ws: { stocks: true, options: true, overnight: true, crypto: true, news: true, boats: true, test: true },
      rest: { stocks_history: true, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
    }
  },
  premium: {
    role: 'premium',
    expiryDays: 30,
    permissions: {
      ws: { stocks: true, options: true, overnight: true, crypto: true, news: true, boats: true, test: true },
      rest: { stocks_history: true, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: true, admin_token_lookup: false, news_history: true }
    }
  },
  // Internal load-test tier — short expiry, high per-user limits. Marked
  // with test_user:true so the warmer/analytics filter these out of audit.
  test: {
    role: 'test',
    expiryDays: 1,
    permissions: {
      ws: { stocks: true, options: true, overnight: true, crypto: true, news: true, boats: true, test: true },
      rest: { stocks_history: true, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: true, admin_token_lookup: false, news_history: true }
    }
  }
};
const PAYMENT_METHOD_IDS = new Set(['alipay', 'wechat_pay', 'stripe_card']);
const PAYMENT_DURATION_MONTHS = [1, 2, 3, 6, 12];
const PAYMENT_MONTHLY_PRICES_CNY_FEN = {
  basic: 6000,
  value: 7000,
  standard: 10000,
  premium: 15000
};
const STRIPE_MONTHLY_PRICES_MINOR = {
  basic: { CAD: 1200, USD: 1000 },
  value: { CAD: 1400, USD: 1167 },
  standard: { CAD: 2000, USD: 1667 },
  premium: { CAD: 3000, USD: 2500 }
};

const PAYMENT_PLAN_DETAILS = {
  basic: {
    name: 'Basic',
    summary: '轻量历史数据访问',
    features: ['股票与期权历史查询', 'REST API 访问', '适合低频研究', '不包含实时 WebSocket'],
    renewal_only: true
  },
  value: {
    name: 'Value',
    summary: '实时数据与单方向历史数据',
    features: ['全部实时 WebSocket 通道', '股票或期权历史数据二选一', 'WS 按当前运行时 subject 限制', 'WS 不设账号级连接数硬上限'],
    modes: ['stocks', 'options']
  },
  standard: {
    name: 'Standard',
    summary: '主流研究与交易工作流',
    features: ['全部实时 WebSocket 通道', '股票与期权历史数据', 'WS 按当前运行时 subject 限制', 'WS 不设账号级连接数硬上限']
  },
  premium: {
    name: 'Premium',
    summary: '完整数据权限与最高容量',
    features: ['全部实时 WebSocket 通道', '完整 REST 数据范围', 'WS 按当前运行时 subject 限制', '包含 crypto 与 news 数据']
  }
};

function buildPaymentBundles() {
  const bundles = {};
  for (const [tier, details] of Object.entries(PAYMENT_PLAN_DETAILS)) {
    const modes = details.modes || [null];
    for (const mode of modes) {
      for (const months of PAYMENT_DURATION_MONTHS) {
        const id = [tier, mode, `${months}m`].filter(Boolean).join('-');
        const tierConfig = TIERS[tier];
        const days = months * (tierConfig.expiryDays || 30);
        bundles[id] = {
          id,
          tier,
          mode,
          months,
          days,
          currency: 'CNY',
          amount_cny_fen: PAYMENT_MONTHLY_PRICES_CNY_FEN[tier] * months,
          monthly_amount_cny_fen: PAYMENT_MONTHLY_PRICES_CNY_FEN[tier],
          role: tierConfig.role,
          permissions: resolvePermissions(tierConfig, mode),
          name: details.name,
          summary: details.summary,
          features: details.features,
          renewal_only: details.renewal_only === true
        };
      }
    }
  }
  return bundles;
}

const PAYMENT_BUNDLES = buildPaymentBundles();

// --- In-memory admin sessions ---
const adminSessions = new Set();
const accountSessions = new Map();
const accountLoginAttempts = new Map();
const paymentFulfillmentLocks = new Map();
const productFeedbackAttempts = new Map();
const ACCOUNT_SESSION_COOKIE = 'leandata_account_session';
const ACCOUNT_SESSION_TTL_MS = Math.max(
  15 * 60 * 1000,
  Math.min(Number(process.env.ACCOUNT_SESSION_TTL_MS) || 8 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000)
);
const ACCOUNT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LOGIN_MAX_ATTEMPTS = 8;

// --- Helpers ---
function readJSON(filepath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch { return fallback; }
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function writeJSONAtomic(filepath, data) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const temporaryPath = `${filepath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, filepath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch (_) {}
    throw error;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return value.length >= 3
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function verificationCodeHash(challengeId, code) {
  const secret = emailSetting('EMAIL_VERIFY_SECRET');
  if (!secret) throw new Error('EMAIL_VERIFY_SECRET is not configured');
  return crypto
    .createHmac('sha256', secret)
    .update(`${challengeId}:${code}`, 'utf8')
    .digest('hex');
}

function verificationRequestKey(req, email) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || req.socket?.remoteAddress || 'unknown';
  return `${email}:${address}`;
}

function checkVerificationSendRate(req, email) {
  const key = verificationRequestKey(req, email);
  const now = Date.now();
  const recent = (verificationSendAttempts.get(key) || [])
    .filter(timestamp => now - timestamp < EMAIL_CODE_SEND_WINDOW_MS);
  verificationSendAttempts.set(key, recent);
  if (recent.length >= EMAIL_CODE_SEND_MAX) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((recent[0] + EMAIL_CODE_SEND_WINDOW_MS - now) / 1000))
    };
  }
  recent.push(now);
  verificationSendAttempts.set(key, recent);
  return { allowed: true, retryAfter: 0 };
}

function readEmailTemplate() {
  const stored = readJSON(EMAIL_TEMPLATE_FILE, {});
  return {
    subject: String(stored.subject || DEFAULT_EMAIL_TEMPLATE.subject),
    text: String(stored.text || DEFAULT_EMAIL_TEMPLATE.text),
    html: String(stored.html || DEFAULT_EMAIL_TEMPLATE.html),
    updated_at: stored.updated_at || null
  };
}

function renderEmailTemplate(templateValue, variables) {
  return String(templateValue).replace(/\{\{([a-z_]+)\}\}/gi, (full, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : full
  ));
}

function validateEmailTemplate(input) {
  const template = {
    subject: String(input?.subject || '').trim(),
    text: String(input?.text || ''),
    html: String(input?.html || '')
  };
  if (!template.subject || template.subject.length > 200) {
    return { error: '邮件主题不能为空且不能超过 200 个字符。' };
  }
  if (!template.text.trim() || template.text.length > 20_000) {
    return { error: '纯文本模板不能为空且不能超过 20000 个字符。' };
  }
  if (!template.html.trim() || template.html.length > 50_000) {
    return { error: 'HTML 模板不能为空且不能超过 50000 个字符。' };
  }

  const placeholders = new Set();
  for (const content of [template.subject, template.text, template.html]) {
    for (const match of content.matchAll(/\{\{([a-z_]+)\}\}/gi)) placeholders.add(match[1]);
  }
  const unknown = [...placeholders].filter(name => !EMAIL_TEMPLATE_PLACEHOLDERS.includes(name));
  if (unknown.length) {
    return { error: `存在不支持的占位符：${unknown.map(name => `{{${name}}}`).join(', ')}` };
  }
  if (!template.text.includes('{{code}}') || !template.html.includes('{{code}}')) {
    return { error: '纯文本和 HTML 模板都必须包含 {{code}}。' };
  }
  return { template };
}

function emailTemplatePreview(template) {
  const variables = {
    code: '123456',
    email: 'demo@example.com',
    expires_minutes: Math.floor(EMAIL_CODE_TTL_MS / 60_000),
    site_name: 'leandata proxy'
  };
  return {
    subject: renderEmailTemplate(template.subject, variables),
    text: renderEmailTemplate(template.text, variables),
    html: renderEmailTemplate(template.html, variables)
  };
}

function emailSmtpConfig() {
  const settings = currentEmailConfig();
  const host = String(settings.SMTP_HOST || '').trim();
  const user = String(settings.SMTP_USER || '').trim();
  const password = String(settings.SMTP_PASSWORD || '').trim();
  const port = Number(settings.SMTP_PORT || 587);
  const from = String(settings.MAIL_FROM || user).trim();
  if (!host || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!ANNOUNCE_EMAIL_RE.test(from)) return null;
  return {
    host,
    port,
    user,
    password,
    from,
    fromName: String(settings.MAIL_FROM_NAME || 'leandata.uk').trim()
  };
}

async function sendVerificationEmail(email, code) {
  const template = readEmailTemplate();
  const variables = {
    code,
    email,
    expires_minutes: Math.floor(EMAIL_CODE_TTL_MS / 60_000),
    site_name: 'leandata proxy'
  };
  const text = renderEmailTemplate(template.text, variables);
  const html = renderEmailTemplate(template.html, variables);
  const subject = renderEmailTemplate(template.subject, variables);
  if (emailSetting('EMAIL_TEST_MODE') === 'memory') {
    testVerificationEmails.push({ email, code, subject, text, html, sent_at: new Date().toISOString() });
    return { messageId: `test-${testVerificationEmails.length}` };
  }
  const config = emailSmtpConfig();
  if (!config) throw new Error('SMTP email configuration is incomplete');
  return sendSmtpMail({ config, to: email, subject, text, html });
}

function getLastTestVerificationEmail() {
  return testVerificationEmails[testVerificationEmails.length - 1] || null;
}

function clearTestVerificationEmails() {
  testVerificationEmails.length = 0;
}

function isSingleFileBindMountReplaceError(error) {
  return ['EBUSY', 'EXDEV'].includes(String(error?.code || ''));
}

function writeProxyUsersFile(data) {
  try {
    writeJSONAtomic(PROXY_USERS_FILE, data);
    return;
  } catch (error) {
    if (!isSingleFileBindMountReplaceError(error)) throw error;

    // Production exposes this registry to the UI as a writable single-file bind
    // mount. Linux rejects renaming over that mount point, so retain the normal
    // atomic path everywhere else and use a fsync'd in-place write only here.
    const serialized = JSON.stringify(data, null, 2);
    const descriptor = fs.openSync(PROXY_USERS_FILE, 'r+');
    try {
      fs.ftruncateSync(descriptor, 0);
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
}

const PRODUCT_UPDATES = [
  {
    id: 'auth-abuse-protection-2026-08',
    date: '2026-08-18',
    title: '认证滥用防护已启用：5 分钟临时封禁与 7/30 天隐私保留',
    title_en: 'Invalid-token abuse protection is live: five-minute bans and 7/30-day privacy retention',
    body: 'REST 与 WebSocket 现在都会对重复无效 Token 采用 5 次/60 秒软限流和 15 次/5 分钟触发、持续 5 分钟的临时封禁；封禁 5 分钟后自动解除，不会升级。伪匿名状态最多保留 7 天，去标识日聚合最多保留 30 天；原始 IP 与 Token 不记录、不持久化。',
    body_en: 'REST and WebSocket authentication now apply a 5-per-60s soft throttle and a 15-per-5m trigger for a five-minute temporary ban; each ban expires automatically after five minutes and bans do not escalate. Pseudonymous state is retained for at most 7 days and identifier-free daily aggregates for at most 30 days; raw IPs and tokens are never logged or persisted.',
    tag: 'Security · Auth'
  },
  {
    id: 'ws-symbol-error-isolation-2026-08',
    date: '2026-08-06',
    title: 'WebSocket 股票订阅现可逐 symbol 返回结果',
    title_en: 'WebSocket stock subscriptions now report per-symbol results',
    body: '股票 trades/quotes 会逐项向 Alpaca 确认。合法 symbol 保持订阅；错误 symbol 会单独返回 Alpaca 原始 code/msg，并附带 mode、channel、symbol 与 source。一个错误 symbol 不会再清空整批合法订阅。',
    body_en: 'Stock trades/quotes are now confirmed with Alpaca one item at a time. Valid symbols remain subscribed, while each rejected symbol returns Alpaca’s original code/msg plus mode, channel, symbol, and source. One bad symbol no longer clears the valid subscriptions in the same request.',
    tag: 'WebSocket · Stocks'
  },
  {
    id: 'fmp-premium-eod-2026-08',
    date: '2026-08-04',
    title: 'Premium 用户可试用 FMP fundamentals Beta',
    title_en: 'FMP fundamentals Beta for Premium',
    body: '我们采购的 bulk snapshot 已向 Premium 开放 statements、ratios、key metrics、TTM、growth、enterprise values 与 financial scores。数据可能被上游事后修订，并非严格 PIT；欢迎反馈 ticker、字段、period 或修订问题。',
    body_en: 'Premium now includes sample-universe statements, ratios, key metrics, TTM, growth, enterprise values, and financial scores from our purchased bulk snapshot. This is not strict PIT and upstream values may be revised; feedback is welcome.',
    tag: 'FMP · Premium'
  },
  {
    id: 'index-options-support-2026-07',
    date: '2026-07-29',
    title: 'Index options 支持已上线',
    title_en: 'Index options support is live',
    body: '现已支持 SPX / SPXW、VIX / VIXW、DJX 与 XSP 的实时订阅和已发布 REST 数据能力；具体请求方式见 Index Data 文档。',
    body_en: 'Realtime subscriptions and documented REST data access are available for SPX/SPXW, VIX/VIXW, DJX, and XSP. See Index Data in the docs.',
    tag: 'Options · Index'
  }
];

function publicProductFeedback(entry) {
  return {
    id: entry.id,
    message: entry.message,
    created_at: entry.created_at,
    status: entry.status || 'received'
  };
}

function productFeedbackAllowed(userId) {
  const key = String(userId || '');
  const now = Date.now();
  const recent = (productFeedbackAttempts.get(key) || [])
    .filter(timestamp => now - timestamp < 60 * 60 * 1000);
  productFeedbackAttempts.set(key, recent);
  return recent.length < 5;
}

function paymentTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function paymentTokenMatches(token, expectedHash) {
  return Boolean(token && expectedHash && safeEqual(paymentTokenHash(token), expectedHash));
}

function refreshRegistrationCheckout(pending, entry) {
  const checkoutToken = crypto.randomBytes(32).toString('base64url');
  entry.checkout_token_hash = paymentTokenHash(checkoutToken);
  entry.checkout_token_issued_at = new Date().toISOString();
  writeJSONAtomic(PENDING_FILE, pending);
  return {
    checkout_token: checkoutToken,
    checkout_url: `/checkout?checkout_token=${encodeURIComponent(checkoutToken)}`
  };
}

function loadPrivatePaymentEnvFile(filepath) {
  try {
    const stat = fs.statSync(filepath);
    if ((stat.mode & 0o077) !== 0) return {};
    const values = {};
    for (const rawLine of fs.readFileSync(filepath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const splitAt = line.indexOf('=');
      const key = line.slice(0, splitAt).trim();
      let value = line.slice(splitAt + 1).trim();
      if (
        value.length >= 2
        && ((value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'")))
      ) value = value.slice(1, -1);
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function stripePaymentSetting(name) {
  return String(process.env[name] || loadPrivatePaymentEnvFile(STRIPE_PAYMENT_ENV_FILE)[name] || '').trim();
}

function zpayPaymentSetting(name) {
  return String(process.env[name] || loadPrivatePaymentEnvFile(ZPAY_PAYMENT_ENV_FILE)[name] || '').trim();
}

function stripeSecretKey() {
  return stripePaymentSetting('STRIPE_SECRET_KEY');
}

function zpayMerchantId() {
  return zpayPaymentSetting('ZPAY_PID');
}

function zpayMerchantKey() {
  return zpayPaymentSetting('ZPAY_KEY');
}

function stripeConfigured() {
  return Boolean(
    stripeSecretKey()
    && stripePaymentSetting('STRIPE_WEBHOOK_SECRET')
  );
}

function zpayConfigured() {
  return Boolean(zpayMerchantId() && zpayMerchantKey());
}

async function createStripeCheckoutSession(order, bundle, customerEmail, successUrl, cancelUrl) {
  const providerCharge = order.provider_charge;
  if (!providerCharge
      || !Number.isSafeInteger(providerCharge.amount_minor)
      || providerCharge.amount_minor < 1
      || !['CAD', 'USD'].includes(providerCharge.currency)) {
    throw new Error('Stripe charge currency is invalid.');
  }
  const form = new URLSearchParams();
  const checkoutLocale = order.checkout_locale === 'en' ? 'en' : 'zh';
  form.set('mode', 'payment');
  form.set('locale', checkoutLocale);
  form.set('client_reference_id', order.id);
  if (customerEmail) form.set('customer_email', customerEmail);
  form.set('line_items[0][price_data][currency]', providerCharge.currency.toLowerCase());
  form.set('line_items[0][price_data][unit_amount]', String(providerCharge.amount_minor));
  form.set(
    'line_items[0][price_data][product_data][name]',
    checkoutLocale === 'en' ? `Leandata ${bundle.name} Plan` : `Leandata ${bundle.name} 套餐`
  );
  form.set(
    'line_items[0][price_data][product_data][description]',
    checkoutLocale === 'en'
      ? `${bundle.months} ${bundle.months === 1 ? 'month' : 'months'} of data access`
      : `${bundle.months} 个月数据访问`
  );
  form.set('line_items[0][quantity]', '1');
  form.set('metadata[order_id]', order.id);
  form.set('metadata[bundle_id]', bundle.id);
  form.set('metadata[order_kind]', order.kind);
  form.set('payment_intent_data[metadata][order_id]', order.id);
  form.set('payment_intent_data[metadata][bundle_id]', bundle.id);
  form.set('success_url', successUrl);
  form.set('cancel_url', cancelUrl);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `checkout-session-${order.id}`,
      'Stripe-Version': '2026-02-25.clover',
      'User-Agent': 'Leandata-Checkout/1.0'
    },
    body: form.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe API returned HTTP ${response.status}.`);
  }
  if (!payload.id || !payload.url) {
    throw new Error('Stripe Checkout response did not include a session ID and URL.');
  }
  return payload;
}

function constructStripeWebhookEvent(payload, signatureHeader, webhookSecret) {
  const signatureParts = String(signatureHeader || '').split(',');
  let timestamp = '';
  const signatures = [];
  for (const part of signatureParts) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) {
    throw new Error('Stripe-Signature header is malformed.');
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) {
    throw new Error('Stripe webhook timestamp is outside the allowed tolerance.');
  }
  const rawPayload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.`, 'utf8')
    .update(rawPayload)
    .digest('hex');
  if (!signatures.some(signature => safeEqual(signature, expected))) {
    throw new Error('Stripe webhook signature does not match.');
  }
  return JSON.parse(rawPayload.toString('utf8'));
}

function paymentBaseUrl(req) {
  const configured = String(
    process.env.PAYMENT_PUBLIC_BASE_URL
    || zpayPaymentSetting('PAYMENT_PUBLIC_BASE_URL')
    || stripePaymentSetting('PAYMENT_PUBLIC_BASE_URL')
    || ''
  ).trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
}

function enabledPaymentMethods() {
  const mockEnabled = process.env.PAYMENT_MOCK_ENABLED === 'true';
  const methods = [{
    id: 'alipay',
    name: '支付宝',
    color: '#1677ff',
    configured: zpayConfigured(),
    available: mockEnabled || zpayConfigured(),
    status: mockEnabled || zpayConfigured()
      ? null
      : '暂不可用'
  }];
  if (process.env.PAYMENT_WECHAT_ENABLED === 'true') {
    methods.push({
      id: 'wechat_pay',
      name: '微信支付',
      color: '#07c160',
      available: true,
      status: null
    });
  }
  methods.push({
    id: 'stripe_card',
    name: '信用卡 / 借记卡',
    color: '#635bff',
    configured: stripeConfigured(),
    available: stripeConfigured() || mockEnabled,
    status: stripeConfigured() || mockEnabled ? null : '暂不可用',
    currencies: ['CAD', 'USD'].map(currency => ({ currency }))
  });
  return methods;
}

function stripeProviderCharge(bundle, requestedCurrency) {
  const currency = String(requestedCurrency || 'CAD').trim().toUpperCase();
  const monthlyAmountMinor = STRIPE_MONTHLY_PRICES_MINOR[bundle?.tier]?.[currency];
  if (!monthlyAmountMinor) return null;
  return {
    currency,
    amount_minor: monthlyAmountMinor * bundle.months,
    monthly_amount_minor: monthlyAmountMinor
  };
}

function zpayProviderCharge(bundle) {
  return {
    currency: 'CNY',
    amount_minor: bundle.amount_cny_fen,
    monthly_amount_minor: bundle.monthly_amount_cny_fen
  };
}

function zpayMoney(amountMinor) {
  return (Number(amountMinor) / 100).toFixed(2);
}

function zpaySignature(parameters, merchantKey) {
  const canonical = Object.entries(parameters)
    .filter(([key, value]) => key !== 'sign' && key !== 'sign_type' && value !== undefined && value !== null && String(value) !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
  return crypto.createHash('md5').update(`${canonical}${merchantKey}`, 'utf8').digest('hex');
}

function zpayReturnUrl(req, order, checkoutToken) {
  const params = new URLSearchParams({
    zpay_order: order.id,
    ...(order.kind === 'registration' && checkoutToken
      ? { checkout_token: checkoutToken }
      : {})
  });
  return `${paymentBaseUrl(req)}/checkout?${params.toString()}`;
}

function createZpayCheckoutUrl(req, order, bundle, checkoutToken) {
  const params = {
    pid: zpayMerchantId(),
    type: 'alipay',
    out_trade_no: order.id,
    notify_url: `${paymentBaseUrl(req)}/api/payment/zpay/notify`,
    return_url: zpayReturnUrl(req, order, checkoutToken),
    name: `Leandata ${bundle.name} ${bundle.months}M`,
    money: zpayMoney(order.provider_charge.amount_minor),
    sign_type: 'MD5'
  };
  params.sign = zpaySignature(params, zpayMerchantKey());
  return `https://z-pay.cn/submit.php?${new URLSearchParams(params).toString()}`;
}

function readPaymentOrders() {
  return readJSON(PAYMENT_ORDERS_FILE, []);
}

function writePaymentOrders(orders) {
  writeJSONAtomic(PAYMENT_ORDERS_FILE, orders);
}

function publicPaymentBundle(bundle) {
  return {
    id: bundle.id,
    tier: bundle.tier,
    mode: bundle.mode || null,
    months: bundle.months,
    days: bundle.days,
    currency: bundle.currency,
    amount_cny_fen: bundle.amount_cny_fen,
    monthly_amount_cny_fen: bundle.monthly_amount_cny_fen,
    stripe_monthly_prices_minor: STRIPE_MONTHLY_PRICES_MINOR[bundle.tier] || {},
    name: bundle.name,
    summary: bundle.summary,
    features: bundle.features,
    renewal_only: bundle.renewal_only
  };
}

function publicPaymentOrder(order) {
  const needsAttention = order.status === 'FAILED' || order.status === 'MANUAL_REVIEW';
  return {
    id: order.id,
    kind: order.kind,
    status: order.status,
    bundle: publicPaymentBundle(order.bundle),
    payment_method: order.payment_method,
    provider: order.provider,
    provider_charge: order.provider_charge || null,
    created_at: order.created_at,
    paid_at: order.paid_at || null,
    completed_at: order.completed_at || null,
    retryable: order.status === 'FAILED' && order.payment_status === 'PAID',
    error: needsAttention ? (order.last_error || '支付订单需要人工检查。') : null,
    account: order.account || null
  };
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ success: false, message: 'Admin auth required.' });
  }
  next();
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setAccountSessionCookie(res, sessionId) {
  const maxAgeSeconds = Math.floor(ACCOUNT_SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${ACCOUNT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`
  );
}

function clearAccountSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${ACCOUNT_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function accountLoginKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function accountLoginAllowed(req) {
  const key = accountLoginKey(req);
  const now = Date.now();
  const previous = accountLoginAttempts.get(key) || [];
  const recent = previous.filter(timestamp => now - timestamp < ACCOUNT_LOGIN_WINDOW_MS);
  accountLoginAttempts.set(key, recent);
  return recent.length < ACCOUNT_LOGIN_MAX_ATTEMPTS;
}

function recordAccountLoginFailure(req) {
  const key = accountLoginKey(req);
  const now = Date.now();
  const previous = accountLoginAttempts.get(key) || [];
  accountLoginAttempts.set(
    key,
    [...previous.filter(timestamp => now - timestamp < ACCOUNT_LOGIN_WINDOW_MS), now]
  );
}

function clearAccountLoginFailures(req) {
  accountLoginAttempts.delete(accountLoginKey(req));
}

function findLocalAccount(userId) {
  return readJSON(USERS_FILE).find(user => accountRegistryId(user) === userId) || null;
}

function findProxyAccount(userId) {
  const proxyData = readJSON(PROXY_USERS_FILE, { users: [] });
  return (proxyData.users || []).find(user => user.user_id === userId) || null;
}

const ACCOUNT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function canonicalAccountIdentity({ username, phone, email }) {
  return {
    username: String(username || '').trim().toLocaleLowerCase('en-US'),
    phone: String(phone || '').trim(),
    email: String(email || '').trim().toLocaleLowerCase('en-US')
  };
}

function hasCompleteAccountIdentity(identity) {
  return Boolean(identity.username && identity.phone);
}

function sameAccountIdentity(record, identity) {
  const candidate = canonicalAccountIdentity(record || {});
  return hasCompleteAccountIdentity(candidate)
    && candidate.username === identity.username
    && candidate.phone === identity.phone;
}

function accountRegistryId(record) {
  return String(record?.account_id || record?.username || '').trim();
}

function accountRegistryIdForNewIdentity(identity, displayUsername, users, proxyUsers) {
  const usernameAlreadyUsed = [
    ...(Array.isArray(users) ? users : []),
    ...(Array.isArray(proxyUsers) ? proxyUsers : [])
  ].some(record => canonicalAccountIdentity(record).username === identity.username);
  if (!usernameAlreadyUsed) return String(displayUsername || '').trim();

  const suffix = crypto
    .createHash('sha256')
    .update(`${identity.username}\u0000${identity.phone}\u0000${identity.email}`, 'utf8')
    .digest('hex')
    .slice(0, 20);
  return `account-${suffix}`;
}

function findLocalAccountByIdentity(identity) {
  return readJSON(USERS_FILE).filter(user => sameAccountIdentity(user, identity));
}

function maskToken(token) {
  const value = String(token || '');
  if (value.length < 12) return value ? '••••••••' : null;
  return `${value.slice(0, 6)}····${value.slice(-4)}`;
}

function createAccountSession(userId) {
  const sessionId = crypto.randomBytes(32).toString('base64url');
  accountSessions.set(sessionId, {
    user_id: userId,
    expires_at: Date.now() + ACCOUNT_SESSION_TTL_MS
  });
  return sessionId;
}

function resolveAccountSession(req) {
  const sessionId = parseCookies(req)[ACCOUNT_SESSION_COOKIE];
  if (!sessionId) return null;
  const session = accountSessions.get(sessionId);
  if (!session || session.expires_at <= Date.now()) {
    accountSessions.delete(sessionId);
    return null;
  }
  session.expires_at = Date.now() + ACCOUNT_SESSION_TTL_MS;
  return { sessionId, session };
}

function requireAccount(req, res, next) {
  const resolved = resolveAccountSession(req);
  if (!resolved) {
    clearAccountSessionCookie(res);
    return res.status(401).json({ success: false, message: '请先登录账户管理中心。' });
  }
  const localUser = findLocalAccount(resolved.session.user_id);
  const proxyUser = findProxyAccount(resolved.session.user_id);
  if (!localUser || !proxyUser || !proxyUser.token) {
    accountSessions.delete(resolved.sessionId);
    clearAccountSessionCookie(res);
    return res.status(401).json({ success: false, message: '账户凭证已失效，请联系管理员。' });
  }
  req.account = {
    sessionId: resolved.sessionId,
    userId: resolved.session.user_id,
    localUser,
    proxyUser
  };
  next();
}

function latestRenewalFor(userId) {
  return readJSON(PENDING_FILE)
    .filter(item => item.type === 'renewal' && accountRegistryId(item) === userId)
    .sort((left, right) => String(right.requested_at || '').localeCompare(String(left.requested_at || '')))[0] || null;
}

function publicRenewalStatus(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    status: entry.status,
    tier: entry.tier,
    mode: entry.mode || null,
    months: entry.months || Math.max(1, Math.round(Number(entry.renew_days || 30) / 30)),
    requested_at: entry.requested_at || entry.registered_at || null,
    approved_at: entry.approved_at || null,
    rejected_at: entry.rejected_at || null,
    reject_reason: entry.status === 'rejected' ? (entry.reject_reason || '审核未通过') : null
  };
}

async function fetchAccountUsage(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * No-op since v2 mounts the same users.json into REST and WS services.
 * users.json is local to the Aliyun host; nothing is copied to a remote proxy.
 * Signature kept for backward compatibility.
 */
function syncToEC2() {
  return;
}

/**
 * No-op (see syncToEC2). Always resolves success; users.json is local to Aliyun.
 * Signature kept for backward compatibility.
 */
function syncToEC2Async() {
  return Promise.resolve({ ok: true, message: 'Local registry (no remote sync needed)' });
}

/**
 * Write proxy users file. (WS proxy reads the same local users.json.)
 */
function writeProxyUsersAndSync(data) {
  writeJSON(PROXY_USERS_FILE, data);
  syncToEC2();
}

async function writeProxyUsersAndSyncAsync(data) {
  const beforeCount = data.users ? data.users.length : 0;
  writeProxyUsersFile(data);

  // Post-write verification: read back and confirm user count matches
  try {
    const readBack = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    const afterCount = (readBack.users || []).length;
    if (afterCount !== beforeCount) {
      console.error(`[GUARD] Post-write mismatch! Wrote ${beforeCount} users, read back ${afterCount}. File: ${PROXY_USERS_FILE}`);
      return { ok: false, message: `Post-write mismatch: wrote ${beforeCount}, read ${afterCount}` };
    }
  } catch (err) {
    console.error(`[GUARD] Post-write read-back failed: ${err.message}`);
    return { ok: false, message: `Read-back failed: ${err.message}` };
  }

  const result = await syncToEC2Async();
  return result;
}

/**
 * Resolve permissions for a tier, taking mode into account for value tier.
 */
function resolvePermissions(tierConfig, mode) {
  if (tierConfig.modes && mode && tierConfig.modes[mode]) {
    return tierConfig.modes[mode];
  }
  return tierConfig.permissions;
}

/**
 * Compute expiry date from tier config.
 */
function computeExpiry(tierConfig) {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + (tierConfig.expiryDays || 30));
  return expiry.toISOString();
}

function publicPlan(tierId) {
  if (tierId === 'free') {
    return {
      id: 'free',
      name: 'Free',
      rest_history_window_days: 31,
      ws_subscription_limit: 10
    };
  }
  return {
    id: tierId || 'unknown',
    name: PAYMENT_PLAN_DETAILS[tierId]?.name || tierId || 'Unknown'
  };
}

async function provisionFreeRegistration(entry) {
  const tierConfig = TIERS.free;
  const permissions = resolvePermissions(tierConfig);
  const users = readJSON(USERS_FILE);
  const proxyData = readJSON(PROXY_USERS_FILE, { users: [] });
  if (!Array.isArray(proxyData.users)) proxyData.users = [];
  const accountId = entry.account_id || accountRegistryIdForNewIdentity(
    canonicalAccountIdentity(entry),
    entry.username,
    users,
    proxyData.users
  );
  if (users.some(user => accountRegistryId(user) === accountId)
      || proxyData.users.some(user => String(user.user_id || '').trim() === accountId)) {
    const error = new Error('该账户组合已有访问凭据；请使用账户管理。');
    error.statusCode = 409;
    throw error;
  }

  const token = crypto.randomUUID();
  const expiresAt = computeExpiry(tierConfig);
  const localUser = {
    username: entry.username,
    phone: entry.phone,
    ...(entry.email && { email: entry.email }),
    ...(entry.email_verified && {
      email_verified: true,
      email_verified_at: entry.email_verified_at || null
    }),
    account_id: accountId,
    role: tierConfig.role,
    tier: 'free',
    permissions,
    registered_at: entry.registered_at,
    approved_at: new Date().toISOString()
  };
  const proxyUser = {
    token,
    user_id: accountId,
    ...(entry.email && { email: entry.email }),
    ...(entry.email_verified && { email_verified: true }),
    role: tierConfig.role,
    expires_at: expiresAt,
    permissions
  };
  const nextUsers = [...users, localUser];
  const nextProxyData = { ...proxyData, users: [...proxyData.users, proxyUser] };

  try {
    const syncResult = await writeProxyUsersAndSyncAsync(nextProxyData);
    if (!syncResult.ok) throw new Error('数据服务注册表同步失败。');
    writeJSONAtomic(USERS_FILE, nextUsers);
  } catch (cause) {
    console.error('[REGISTRATION] Free provisioning failed', {
      code: cause?.code || 'unknown',
      syscall: cause?.syscall || null,
      message: String(cause?.message || 'unknown').slice(0, 160)
    });
    try { writeProxyUsersFile(proxyData); } catch (_) {}
    try { writeJSONAtomic(USERS_FILE, users); } catch (_) {}
    const error = new Error('Free 计划开通失败，请稍后重试。');
    error.statusCode = 503;
    throw error;
  }
  return { token, expiresAt, role: tierConfig.role };
}

function computeRenewalExpiry(currentExpiry, days) {
  const now = new Date();
  const current = currentExpiry ? new Date(currentExpiry) : null;
  const base = current && !Number.isNaN(current.getTime()) && current > now ? current : now;
  const expiry = new Date(base);
  expiry.setDate(expiry.getDate() + (Number(days) || 30));
  return expiry.toISOString();
}

function resolvePaymentCheckoutContext(req, checkoutToken) {
  const token = String(checkoutToken || '').trim();
  if (token) {
    const entry = readJSON(PENDING_FILE).find(item =>
      item.type === 'registration'
      && item.status === 'payment_pending'
      && paymentTokenMatches(token, item.checkout_token_hash)
    );
    if (!entry) return null;
    return {
      kind: 'registration',
      registration: entry,
      suggested_tier: entry.tier || 'standard',
      suggested_mode: entry.mode || null
    };
  }

  const resolved = resolveAccountSession(req);
  if (!resolved) return null;
  const localUser = findLocalAccount(resolved.session.user_id);
  const proxyUser = findProxyAccount(resolved.session.user_id);
  if (!localUser || !proxyUser || !proxyUser.token) return null;
  return {
    kind: 'renewal',
    user_id: resolved.session.user_id,
    localUser,
    proxyUser,
    suggested_tier: localUser.tier || proxyUser.role || 'standard',
    suggested_mode: localUser.mode || null
  };
}

function paymentBundleAllowedForContext(bundle, context) {
  if (!bundle || !context) return false;
  if (context.kind === 'registration') {
    return bundle.renewal_only !== true;
  }
  return ['basic', 'value', 'standard', 'premium'].includes(bundle.tier);
}

function checkoutPlansForContext(context) {
  const allowedTiers = context.kind === 'registration'
    ? ['value', 'standard', 'premium']
    : ['basic', 'value', 'standard', 'premium'];
  return allowedTiers.map(tier => {
    const details = PAYMENT_PLAN_DETAILS[tier];
    return {
      id: tier,
      name: details.name,
      summary: details.summary,
      features: details.features,
      modes: details.modes || [],
      monthly_amount_cny_fen: PAYMENT_MONTHLY_PRICES_CNY_FEN[tier],
      duration_months: PAYMENT_DURATION_MONTHS
    };
  });
}

function paymentOrderAccessAllowed(req, order, resumeToken, checkoutToken) {
  if (paymentTokenMatches(resumeToken, order.resume_token_hash)) return true;
  if (order.kind === 'registration'
      && paymentTokenMatches(checkoutToken, order.checkout_token_hash)) {
    return true;
  }
  const checkoutContext = resolvePaymentCheckoutContext(req, checkoutToken);
  if (checkoutContext?.kind === 'registration'
      && order.kind === 'registration'
      && order.registration_id === checkoutContext.registration.id) {
    return true;
  }
  const resolved = resolveAccountSession(req);
  return Boolean(
    resolved
    && order.kind === 'renewal'
    && order.user_id === resolved.session.user_id
  );
}

function updatePaymentOrder(orderId, updater) {
  const orders = readPaymentOrders();
  const index = orders.findIndex(order => order.id === orderId);
  if (index < 0) return null;
  const updated = updater({ ...orders[index] }) || orders[index];
  orders[index] = updated;
  writePaymentOrders(orders);
  return updated;
}

function fulfilledPaymentOrderIds(user) {
  return Array.isArray(user?.fulfilled_payment_orders)
    ? user.fulfilled_payment_orders.filter(Boolean)
    : [];
}

function addFulfilledPaymentOrder(user, orderId) {
  user.fulfilled_payment_orders = [...new Set([...fulfilledPaymentOrderIds(user), orderId])];
}

async function fulfillPaymentOrderUnlocked(orderId) {
  let order = readPaymentOrders().find(item => item.id === orderId);
  if (!order) throw new Error('支付订单不存在。');
  if (order.status === 'COMPLETED') {
    const existing = findProxyAccount(
      order.user_id || accountRegistryId(order.registration)
    );
    return { order, token: existing?.token || null };
  }
  if (order.payment_status !== 'PAID') {
    throw new Error('订单尚未支付。');
  }

  order = updatePaymentOrder(orderId, current => ({
    ...current,
    status: 'FULFILLING',
    fulfillment_attempts: Number(current.fulfillment_attempts || 0) + 1,
    last_fulfillment_at: new Date().toISOString(),
    last_error: null
  }));

  const bundle = PAYMENT_BUNDLES[order.bundle_id];
  if (!bundle
      || bundle.amount_cny_fen !== order.bundle.amount_cny_fen
      || bundle.currency !== order.bundle.currency) {
    throw new Error('订单 bundle 快照校验失败。');
  }

  const targetUserId = order.kind === 'registration'
    ? accountRegistryId(order.registration)
    : order.user_id;
  const proxyData = readJSON(PROXY_USERS_FILE, { users: [] });
  if (!Array.isArray(proxyData.users)) proxyData.users = [];
  let proxyUser = proxyData.users.find(user => user.user_id === targetUserId);
  const proxyAlreadyApplied = proxyUser && fulfilledPaymentOrderIds(proxyUser).includes(order.id);

  if (order.kind === 'renewal' && (!proxyUser || !proxyUser.token)) {
    throw new Error('续费账户的现有 Token 不存在，无法自动续期。');
  }
  if (order.kind === 'registration' && proxyUser && !proxyAlreadyApplied) {
    throw new Error('该用户名已经开通过数据访问，请使用账户管理续费。');
  }

  if (!proxyAlreadyApplied) {
    if (!proxyUser) {
      proxyUser = {
        token: crypto.randomUUID(),
        user_id: targetUserId
      };
      proxyData.users.push(proxyUser);
    }
    proxyUser.role = bundle.role;
    proxyUser.permissions = bundle.permissions;
    proxyUser.expires_at = computeRenewalExpiry(
      order.kind === 'renewal' ? proxyUser.expires_at : null,
      bundle.days
    );
    if (order.registration?.email) proxyUser.email = order.registration.email;
    addFulfilledPaymentOrder(proxyUser, order.id);

    const syncResult = await writeProxyUsersAndSyncAsync(proxyData);
    if (!syncResult.ok) {
      throw new Error(`数据服务注册表同步失败：${syncResult.message}`);
    }
  }

  const localUsers = readJSON(USERS_FILE);
  const localIndex = localUsers.findIndex(user => accountRegistryId(user) === targetUserId);
  const previousLocalUser = localIndex >= 0 ? localUsers[localIndex] : null;
  if (order.kind === 'renewal' && !previousLocalUser) {
    throw new Error('本地账户记录不存在，无法自动续期。');
  }
  const localUser = {
    ...(previousLocalUser || {}),
    username: order.registration?.username || previousLocalUser?.username,
    phone: order.registration?.phone || previousLocalUser?.phone,
    email: order.registration?.email || previousLocalUser?.email,
    account_id: targetUserId,
    role: bundle.role,
    tier: bundle.tier,
    permissions: bundle.permissions,
    ...(bundle.mode ? { mode: bundle.mode } : {})
  };
  if (!bundle.mode) delete localUser.mode;
  addFulfilledPaymentOrder(localUser, order.id);
  if (localIndex >= 0) localUsers[localIndex] = localUser;
  else localUsers.push(localUser);
  writeJSONAtomic(USERS_FILE, localUsers);

  if (order.kind === 'registration') {
    const pending = readJSON(PENDING_FILE);
    const registration = pending.find(item => item.id === order.registration_id);
    if (!registration) throw new Error('注册记录不存在，无法完成自动开通。');
    registration.status = 'approved';
    registration.approved_at = new Date().toISOString();
    registration.payment_order_id = order.id;
    registration.payment_method = order.payment_method;
    delete registration.checkout_token_hash;
    writeJSONAtomic(PENDING_FILE, pending);
  }

  const completedAt = new Date().toISOString();
  order = updatePaymentOrder(order.id, current => ({
    ...current,
    status: 'COMPLETED',
    completed_at: completedAt,
    ...(order.kind === 'registration' && { issued_token: proxyUser.token }),
    account: {
      user_id: targetUserId,
      role: bundle.role,
      tier: bundle.tier,
      mode: bundle.mode || null,
      expiry: proxyUser.expires_at,
      token_masked: maskToken(proxyUser.token)
    }
  }));

  if (order.kind === 'registration') {
    const orders = readPaymentOrders();
    let changed = false;
    for (const sibling of orders) {
      if (sibling.id !== order.id
          && sibling.registration_id === order.registration_id
          && sibling.status === 'PENDING') {
        sibling.status = 'CANCELLED';
        sibling.cancelled_at = completedAt;
        sibling.last_error = '同一注册流程已由其他订单完成。';
        changed = true;
      }
    }
    if (changed) writePaymentOrders(orders);
  }

  return { order, token: proxyUser.token };
}

async function fulfillPaymentOrder(orderId) {
  if (paymentFulfillmentLocks.has(orderId)) {
    return paymentFulfillmentLocks.get(orderId);
  }
  const promise = fulfillPaymentOrderUnlocked(orderId)
    .catch(error => {
      updatePaymentOrder(orderId, current => ({
        ...current,
        status: 'FAILED',
        last_error: error.message,
        failed_at: new Date().toISOString()
      }));
      throw error;
    })
    .finally(() => {
      paymentFulfillmentLocks.delete(orderId);
    });
  paymentFulfillmentLocks.set(orderId, promise);
  return promise;
}

async function handleStripeWebhook(req, res) {
  const webhookSecret = stripePaymentSetting('STRIPE_WEBHOOK_SECRET');
  if (!stripeSecretKey() || !webhookSecret) {
    return res.status(503).send('Stripe webhook is not configured.');
  }

  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = constructStripeWebhookEvent(req.body, signature, webhookSecret);
  } catch (error) {
    return res.status(400).send(`Invalid Stripe signature: ${error.message}`);
  }

  const session = event.data?.object;
  const orderId = session?.metadata?.order_id || session?.client_reference_id;
  if (!orderId) return res.json({ received: true });

  const order = readPaymentOrders().find(item => item.id === orderId);
  if (!order || order.provider !== 'stripe_checkout') {
    return res.json({ received: true });
  }

  if (event.type === 'checkout.session.completed'
      || event.type === 'checkout.session.async_payment_succeeded') {
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return res.json({ received: true });
    }
    // Keep legacy CNY Checkout Sessions fulfillable if they were created before
    // the CAD/USD card-pricing launch and complete after this deployment.
    const expectedCharge = order.provider_charge || {
      amount_minor: order.bundle.amount_cny_fen,
      currency: order.bundle.currency
    };
    const amountMatches = Number(session.amount_total) === Number(expectedCharge.amount_minor);
    const currencyMatches = String(session.currency || '').toUpperCase()
      === String(expectedCharge.currency || '').toUpperCase();
    const bundleMatches = session.metadata?.bundle_id === order.bundle_id;
    if (!amountMatches || !currencyMatches || !bundleMatches) {
      updatePaymentOrder(order.id, current => ({
        ...current,
        status: 'MANUAL_REVIEW',
        payment_status: 'PAID_MISMATCH',
        paid_at: current.paid_at || new Date().toISOString(),
        provider_payment_id: session.payment_intent || session.id,
        stripe_checkout_session_id: session.id,
        last_error: 'Stripe 回调金额、币种或 bundle 与本地订单不一致，已阻止自动开通。'
      }));
      return res.json({ received: true, manual_review: true });
    }
    updatePaymentOrder(order.id, current => ({
      ...current,
      payment_status: 'PAID',
      status: current.status === 'COMPLETED' ? 'COMPLETED' : 'PAID',
      paid_at: current.paid_at || new Date().toISOString(),
      provider_payment_id: session.payment_intent || session.id,
      stripe_checkout_session_id: session.id
    }));
    try {
      await fulfillPaymentOrder(order.id);
    } catch (error) {
      return res.status(500).json({ received: false, message: error.message });
    }
  } else if (event.type === 'checkout.session.expired') {
    updatePaymentOrder(order.id, current => current.payment_status === 'PAID'
      ? current
      : {
          ...current,
          status: 'CANCELLED',
          cancelled_at: new Date().toISOString(),
          last_error: 'Stripe Checkout session expired.'
        });
  }

  return res.json({ received: true });
}

function zpayCallbackPayload(req) {
  const payload = {};
  for (const source of [req.query || {}, req.body || {}]) {
    for (const [key, value] of Object.entries(source)) {
      if (Array.isArray(value)) throw new Error('Callback parameters must not be repeated.');
      const normalized = String(value || '');
      if (Object.hasOwn(payload, key) && payload[key] !== normalized) {
        throw new Error('Callback parameters conflict.');
      }
      payload[key] = normalized;
    }
  }
  return payload;
}

function zpayExpectedMoney(order) {
  const charge = order.provider_charge || {
    currency: order.bundle?.currency,
    amount_minor: order.bundle?.amount_cny_fen
  };
  if (String(charge.currency || '').toUpperCase() !== 'CNY'
      || !Number.isSafeInteger(Number(charge.amount_minor))) {
    return null;
  }
  return zpayMoney(Number(charge.amount_minor));
}

function zpayPaymentMatches(order, payload) {
  const expectedMoney = zpayExpectedMoney(order);
  const receivedMoney = String(payload.money || '');
  const receivedAmountFen = /^\d+(?:\.\d{1,2})?$/.test(receivedMoney)
    ? Math.round(Number(receivedMoney) * 100)
    : NaN;
  return Boolean(
    expectedMoney
    && payload.pid === zpayMerchantId()
    && payload.type === 'alipay'
    && payload.out_trade_no === order.id
    && payload.out_trade_no === (order.zpay_out_trade_no || order.id)
    && payload.name === order.zpay_subject
    && Number.isSafeInteger(receivedAmountFen)
    && receivedAmountFen === Number(order.provider_charge?.amount_minor)
  );
}

async function handleZpayNotification(req, res) {
  if (!zpayConfigured()) return res.status(503).send('fail');

  let payload;
  try {
    payload = zpayCallbackPayload(req);
  } catch {
    return res.status(400).send('fail');
  }
  if (!payload.sign || !safeEqual(payload.sign, zpaySignature(payload, zpayMerchantKey()))) {
    return res.status(400).send('fail');
  }
  if (payload.trade_status !== 'TRADE_SUCCESS') return res.send('success');
  if (!payload.out_trade_no || !payload.trade_no) return res.status(400).send('fail');

  const order = readPaymentOrders().find(item => item.id === payload.out_trade_no);
  if (!order || order.provider !== 'zpay') return res.send('success');

  const sameProviderTransaction = readPaymentOrders().find(item =>
    item.id !== order.id
    && item.provider === 'zpay'
    && item.provider_payment_id === payload.trade_no
  );
  if (sameProviderTransaction || !zpayPaymentMatches(order, payload)) {
    updatePaymentOrder(order.id, current => ({
      ...current,
      status: 'MANUAL_REVIEW',
      payment_status: 'PAID_MISMATCH',
      paid_at: current.paid_at || new Date().toISOString(),
      provider_payment_id: payload.trade_no,
      zpay_trade_no: payload.trade_no,
      last_error: 'Z-Pay 回调的商户、订单、金额、名称或交易号与本地订单不一致，已阻止自动开通。'
    }));
    return res.send('success');
  }

  updatePaymentOrder(order.id, current => ({
    ...current,
    payment_status: 'PAID',
    status: current.status === 'COMPLETED' ? 'COMPLETED' : 'PAID',
    paid_at: current.paid_at || new Date().toISOString(),
    provider_payment_id: payload.trade_no,
    zpay_trade_no: payload.trade_no
  }));
  try {
    await fulfillPaymentOrder(order.id);
  } catch (_) {
    return res.status(500).send('fail');
  }
  return res.send('success');
}

function getNewYorkMarketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const weekday = parts.weekday;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const minutes = hour * 60 + minute;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const regularSession = isWeekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  return {
    is_open: isWeekday,
    regular_session: regularSession,
    weekend_closed: !isWeekday,
    market_state: isWeekday ? 'quote_driven' : 'weekend_closed',
    timezone: 'America/New_York',
    timestamp: now.toISOString(),
    note: 'Simulator hard-closes weekends only. Weekday fills are quote/liquidity driven so extended and overnight sessions can fill when executable quotes are available.'
  };
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractFirstFiniteByKey(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  const wanted = new Set(keys.map(k => String(k).toLowerCase()));
  for (const [key, value] of Object.entries(obj)) {
    if (wanted.has(String(key).toLowerCase())) {
      const n = firstFiniteNumber(value);
      if (n !== null) return n;
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const nested = extractFirstFiniteByKey(value, keys, depth + 1);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function extractFirstTimestampByKey(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  const wanted = new Set(keys.map(k => String(k).toLowerCase()));
  for (const [key, value] of Object.entries(obj)) {
    if (wanted.has(String(key).toLowerCase())) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const nested = extractFirstTimestampByKey(value, keys, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function extractSubscriptionHint(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  const keys = new Set([
    'active_subscription', 'active_subs', 'subscription_active', 'subscriptions_active',
    'ws_active', 'stream_active', 'boat_active', 'boats_active', 'feed_active', 'is_active'
  ]);
  for (const [key, value] of Object.entries(obj)) {
    const normalized = String(key).toLowerCase();
    if (keys.has(normalized)) {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value > 0;
      if (typeof value === 'string') {
        if (/^(true|active|ok|open|subscribed|yes|1)$/i.test(value)) return true;
        if (/^(false|inactive|closed|stale|no|0)$/i.test(value)) return false;
      }
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const nested = extractSubscriptionHint(value, depth + 1);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function pickQuoteRoot(data, symbol) {
  const sym = String(symbol || '').toUpperCase();
  const candidates = [
    data?.quote,
    data?.latestQuote,
    data?.latest_quote,
    data?.snapshot?.latestQuote,
    data?.snapshot?.latest_quote,
    data?.snapshots?.[sym]?.latestQuote,
    data?.snapshots?.[sym]?.latest_quote,
    data?.quotes?.[sym],
    Array.isArray(data?.quotes) ? data.quotes[0] : null,
    Array.isArray(data?.data) ? data.data[0] : null,
    data?.[sym]?.latestQuote,
    data?.[sym],
    data
  ];
  return candidates.find(v => v && typeof v === 'object') || {};
}

function normalizeSimulatorQuote(data, symbol) {
  const root = pickQuoteRoot(data, symbol);
  const bid = firstFiniteNumber(
    root.bp, root.bid_price, root.bidPrice, root.bid,
    extractFirstFiniteByKey(root, ['bp', 'bid_price', 'bidPrice', 'bid'])
  );
  const ask = firstFiniteNumber(
    root.ap, root.ask_price, root.askPrice, root.ask,
    extractFirstFiniteByKey(root, ['ap', 'ask_price', 'askPrice', 'ask'])
  );
  const last = firstFiniteNumber(
    root.price, root.p, root.last_price, root.lastPrice, root.last, root.close,
    extractFirstFiniteByKey(root, ['price', 'p', 'last_price', 'lastPrice', 'last', 'close'])
  );
  const timestamp = extractFirstTimestampByKey(root, ['t', 'timestamp', 'time', 'updated_at', 'updatedAt', 'last_updated', 'lastUpdated']);
  const ageMs = timestamp ? Date.now() - new Date(timestamp).getTime() : null;
  const stale = ageMs !== null ? ageMs > 5 * 60 * 1000 : null;
  return {
    symbol: String(symbol || '').toUpperCase(),
    bid,
    ask,
    last,
    timestamp,
    age_ms: ageMs,
    stale,
    subscription_active: extractSubscriptionHint(data) ?? extractSubscriptionHint(root),
    source: data?.source || data?.provider || 'leandata-realtime'
  };
}

async function fetchSimulatorLiquidity({ token, symbol, assetClass, args = {} }) {
  if (assetClass === 'crypto') {
    return {
      quote: {
        symbol,
        bid: null,
        ask: null,
        last: firstFiniteNumber(args.simulated_price, args.limit_price, 100),
        timestamp: new Date().toISOString(),
        stale: false,
        subscription_active: true,
        source: 'simulator-crypto'
      }
    };
  }
  const REST = 'https://api.leandata.uk';
  const RT = 'https://rt-api.leandata.uk';
  const url = assetClass === 'option'
    ? `${REST}/v1/options/snapshots/quote`
    : `${RT}/v1/stocks/latest/quote`;
  const payload = assetClass === 'option'
    ? { ...args, symbol, symbols: args.symbols || symbol }
    : { symbol, feed: args.feed || args.data_feed || args.feed_name || 'iex' };
  const data = await postLeandataJson(token, url, payload);
  return { quote: normalizeSimulatorQuote(data, symbol), raw_status: data?.status };
}

function decideSimulatorFill({ assetClass, orderType, side, limitPrice, simulatedPrice, liquidity }) {
  const clock = getNewYorkMarketClock();
  if (assetClass !== 'crypto' && clock.weekend_closed) {
    return { fill: false, status: 'accepted', clock, price: null, reason: 'weekend_closed', quote: liquidity?.quote || null };
  }

  const quote = liquidity?.quote || {};
  const executablePrice = side === 'buy'
    ? firstFiniteNumber(quote.ask, quote.last, simulatedPrice)
    : firstFiniteNumber(quote.bid, quote.last, simulatedPrice);

  if (assetClass !== 'crypto' && side === 'buy' && !quote.ask && !quote.last) {
    return { fill: false, status: 'accepted', clock, price: null, reason: 'no_executable_ask', quote };
  }
  if (assetClass !== 'crypto' && side === 'sell' && !quote.bid && !quote.last) {
    return { fill: false, status: 'accepted', clock, price: null, reason: 'no_executable_bid', quote };
  }

  if (orderType === 'market') {
    return { fill: true, status: 'filled', clock, price: executablePrice, reason: quote.stale ? 'marketable_quote_stale' : 'marketable_quote', quote };
  }
  if (orderType === 'limit') {
    const referencePrice = side === 'buy'
      ? firstFiniteNumber(quote.ask, quote.last, simulatedPrice)
      : firstFiniteNumber(quote.bid, quote.last, simulatedPrice);
    const marketable = side === 'buy'
      ? Number(limitPrice) >= Number(referencePrice)
      : Number(limitPrice) <= Number(referencePrice);
    return {
      fill: marketable,
      status: marketable ? 'filled' : 'accepted',
      clock,
      price: marketable ? referencePrice : null,
      reason: marketable ? (quote.stale ? 'limit_crossed_quote_stale' : 'limit_crossed_quote') : 'limit_not_marketable',
      quote
    };
  }
  return { fill: false, status: 'accepted', clock, price: null, reason: 'order_type_waiting_for_trigger', quote };
}

// ============================================================
// MCP: Alpaca-style paper simulator facade
// ============================================================

const MCP_PAPER_DIR = path.join(DATA_DIR, 'mcp-paper', 'accounts');
const MCP_WATCHLIST_DIR = path.join(DATA_DIR, 'mcp-paper', 'watchlists');
const MCP_AUDIT_DIR = path.join(DATA_DIR, 'mcp-paper', 'audit');

function mcpJsonRpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function mcpJsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function mcpTextResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text', text }],
    structuredContent: typeof payload === 'string' ? { message: payload } : payload
  };
}

function resolveMcpPrincipal(req) {
  const auth = req.headers.authorization;
  const match = typeof auth === 'string' ? auth.match(/^Bearer\s+(\S+)$/i) : null;
  const token = match ? match[1] : '';
  if (!token) return null;

  const registry = readJSON(PROXY_USERS_FILE, { users: [] });
  const user = (registry.users || []).find(u => u.token === token);
  if (!user) return null;

  const expiry = user.expires_at ? new Date(user.expires_at) : null;
  if (expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) {
    return { expired: true, user, token };
  }
  return { expired: false, user, token };
}

function legacyPaperUserId(userId) {
  return String(userId || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
}

function safePaperUserId(userId) {
  return `u-${crypto.createHash('sha256').update(String(userId || 'unknown')).digest('hex')}`;
}

function paperAccountPath(userId) {
  return path.join(MCP_PAPER_DIR, `${safePaperUserId(userId)}.json`);
}

function watchlistPath(userId) {
  return path.join(MCP_WATCHLIST_DIR, `${safePaperUserId(userId)}.json`);
}

function migrateLegacyMcpState(directory, userId, targetFile) {
  const legacyFile = path.join(directory, `${legacyPaperUserId(userId)}.json`);
  if (fs.existsSync(targetFile) || !fs.existsSync(legacyFile)) return;

  const legacyState = readJSON(legacyFile, null);
  if (!legacyState || legacyState.user_id !== userId) return;

  try {
    fs.renameSync(legacyFile, targetFile);
  } catch (err) {
    console.error('[MCP state] migration failed:', err.message);
  }
}

function defaultPaperAccount(userId) {
  const now = new Date().toISOString();
  return {
    user_id: userId,
    currency: 'USD',
    cash: 100000,
    buying_power: 100000,
    equity: 100000,
    initial_equity: 100000,
    positions: [],
    orders: [],
    created_at: now,
    updated_at: now
  };
}

function readPaperAccount(userId) {
  fs.mkdirSync(MCP_PAPER_DIR, { recursive: true });
  const file = paperAccountPath(userId);
  migrateLegacyMcpState(MCP_PAPER_DIR, userId, file);
  if (!fs.existsSync(file)) {
    const account = defaultPaperAccount(userId);
    writeJSON(file, account);
    return account;
  }
  return readJSON(file, defaultPaperAccount(userId));
}

function defaultWatchlistBook(userId) {
  const now = new Date().toISOString();
  return {
    user_id: userId,
    watchlists: [
      {
        id: 'default',
        name: 'Default Universe',
        symbols: [],
        created_at: now,
        updated_at: now
      }
    ],
    created_at: now,
    updated_at: now
  };
}

function readWatchlists(userId) {
  fs.mkdirSync(MCP_WATCHLIST_DIR, { recursive: true });
  const file = watchlistPath(userId);
  migrateLegacyMcpState(MCP_WATCHLIST_DIR, userId, file);
  if (!fs.existsSync(file)) {
    const book = defaultWatchlistBook(userId);
    writeJSON(file, book);
    return book;
  }
  const book = readJSON(file, defaultWatchlistBook(userId));
  if (!Array.isArray(book.watchlists) || book.watchlists.length === 0) {
    book.watchlists = defaultWatchlistBook(userId).watchlists;
  }
  return book;
}

function writeWatchlists(book) {
  book.updated_at = new Date().toISOString();
  for (const list of book.watchlists || []) {
    list.updated_at = list.updated_at || book.updated_at;
    list.symbols = Array.from(new Set((list.symbols || []).map(s => String(s).trim().toUpperCase()).filter(Boolean))).sort();
  }
  writeJSON(watchlistPath(book.user_id), book);
}

function findWatchlist(book, watchlistIdOrName = 'default') {
  const key = String(watchlistIdOrName || 'default').trim();
  return (book.watchlists || []).find(w => w.id === key || w.name === key) || null;
}

function assertSymbolInUniverse(userId, symbol) {
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  const book = readWatchlists(userId);
  const inUniverse = (book.watchlists || []).some(w => (w.symbols || []).includes(cleanSymbol));
  if (!inUniverse) {
    throw new Error(`${cleanSymbol} is not in your MCP watchlist/universe. Call alpaca_add_asset_to_watchlist first.`);
  }
}

function appendMcpAudit(userId, entry) {
  try {
    fs.mkdirSync(MCP_AUDIT_DIR, { recursive: true });
    const file = path.join(MCP_AUDIT_DIR, `${safePaperUserId(userId)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({
      ts: new Date().toISOString(),
      user_id: userId,
      ...entry
    }) + '\n');
  } catch (err) {
    console.error('[MCP audit] write failed:', err.message);
  }
}

function summarizeMcpResult(payload) {
  if (!payload || typeof payload !== 'object') return { type: typeof payload };
  if (Array.isArray(payload)) return { type: 'array', count: payload.length };
  const summary = {};
  for (const [key, value] of Object.entries(payload).slice(0, 8)) {
    if (Array.isArray(value)) summary[key] = { type: 'array', count: value.length };
    else if (value && typeof value === 'object') summary[key] = { type: 'object', keys: Object.keys(value).slice(0, 8) };
    else summary[key] = value;
  }
  return summary;
}

function cleanMcpArgs(args = {}) {
  const clone = JSON.parse(JSON.stringify(args || {}));
  for (const key of Object.keys(clone)) {
    if (/token|secret|key|authorization/i.test(key)) clone[key] = '[redacted]';
  }
  return clone;
}

async function postLeandataJson(token, url, payload = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ ...payload, token })
  });
  const text = await resp.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!resp.ok) {
    const message = data.error || data.message || `Leandata proxy returned HTTP ${resp.status}`;
    const err = new Error(message);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

function firstSymbolArg(args = {}) {
  return args.symbol || args.underlying_symbol || args.underlying || args.ticker || args.symbols?.[0] || '';
}

function assertMcpUniverseForArgs(userId, args = {}) {
  const symbols = [];
  if (Array.isArray(args.symbols)) symbols.push(...args.symbols);
  const first = firstSymbolArg(args);
  if (first) symbols.push(first);
  for (const raw of symbols) {
    const symbol = String(raw || '').trim().toUpperCase();
    if (symbol) assertSymbolInUniverse(userId, symbol);
  }
}

function writePaperAccount(account) {
  account.updated_at = new Date().toISOString();
  account.equity = Number(account.cash || 0) + (account.positions || []).reduce((sum, p) => {
    return sum + Number(p.market_value || 0);
  }, 0);
  account.buying_power = Math.max(0, Number(account.cash || 0));
  writeJSON(paperAccountPath(account.user_id), account);
}

function updatePaperPosition(account, symbol, side, qty, price) {
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  const cleanQty = Number(qty);
  const cleanPrice = Number(price);
  if (!cleanSymbol) throw new Error('symbol is required');
  if (!Number.isFinite(cleanQty) || cleanQty <= 0) throw new Error('qty must be a positive number');
  if (!Number.isFinite(cleanPrice) || cleanPrice <= 0) throw new Error('price must be a positive number');

  const signedQty = side === 'sell' ? -cleanQty : cleanQty;
  const positions = account.positions || [];
  let position = positions.find(p => p.symbol === cleanSymbol);
  if (!position) {
    position = {
      symbol: cleanSymbol,
      asset_class: 'us_equity',
      qty: 0,
      avg_entry_price: cleanPrice,
      market_price: cleanPrice,
      market_value: 0,
      unrealized_pl: 0,
      side: 'long'
    };
    positions.push(position);
  }

  const oldQty = Number(position.qty || 0);
  const newQty = oldQty + signedQty;
  const oldCost = oldQty * Number(position.avg_entry_price || cleanPrice);

  account.cash = Number(account.cash || 0) - signedQty * cleanPrice;

  if (Math.abs(newQty) < 1e-9) {
    account.positions = positions.filter(p => p.symbol !== cleanSymbol);
    return;
  }

  if (Math.sign(oldQty) === Math.sign(newQty) && Math.sign(oldQty) === Math.sign(signedQty)) {
    position.avg_entry_price = Math.abs((oldCost + signedQty * cleanPrice) / newQty);
  } else if (Math.sign(oldQty) !== Math.sign(newQty)) {
    position.avg_entry_price = cleanPrice;
  }
  position.qty = newQty;
  position.market_price = cleanPrice;
  position.market_value = newQty * cleanPrice;
  position.unrealized_pl = (cleanPrice - Number(position.avg_entry_price || cleanPrice)) * newQty;
  position.side = newQty >= 0 ? 'long' : 'short';
}

const ALPACA_PAPER_TOOLS = [
  {
    name: 'alpaca_get_watchlists',
    description: 'List this user MCP watchlists. Watchlists act as the allowed universe for paper trading and data tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'alpaca_create_watchlist',
    description: 'Create a user watchlist/universe. Symbols added here are allowed for later MCP operations.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        symbols: { type: 'array', items: { type: 'string' }, default: [] }
      },
      additionalProperties: false
    }
  },
  {
    name: 'alpaca_add_asset_to_watchlist',
    description: 'Add a symbol to a watchlist/universe. Paper trading and data tools require symbols to be in a watchlist first.',
    inputSchema: {
      type: 'object',
      required: ['symbol'],
      properties: {
        symbol: { type: 'string' },
        watchlist_id: { type: 'string', default: 'default' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'alpaca_remove_asset_from_watchlist',
    description: 'Remove a symbol from a watchlist/universe.',
    inputSchema: {
      type: 'object',
      required: ['symbol'],
      properties: {
        symbol: { type: 'string' },
        watchlist_id: { type: 'string', default: 'default' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'alpaca_get_watchlist_assets',
    description: 'List symbols in a watchlist/universe.',
    inputSchema: {
      type: 'object',
      properties: { watchlist_id: { type: 'string', default: 'default' } },
      additionalProperties: false
    }
  },
  {
    name: 'alpaca_paper_get_account',
    description: 'Get the current isolated Leandata paper account. This never connects to a real Alpaca trading account.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'alpaca_paper_get_positions',
    description: 'List simulated paper positions for this Leandata user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'alpaca_paper_get_orders',
    description: 'List simulated paper orders for this Leandata user.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'open', 'closed', 'filled', 'canceled'], default: 'all' },
        limit: { type: 'number', minimum: 1, maximum: 200, default: 50 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'alpaca_paper_place_order',
    description: 'Place a simulated stock paper order. The symbol must first be added to a watchlist/universe. Orders are quote-driven: weekends are closed; weekday extended/overnight sessions can fill when Leandata realtime bid/ask is executable. No real Alpaca order is sent.',
    inputSchema: {
      type: 'object',
      required: ['symbol', 'side', 'qty'],
      properties: {
        symbol: { type: 'string', description: 'US equity symbol, for example AAPL.' },
        side: { type: 'string', enum: ['buy', 'sell'] },
        qty: { type: 'number', exclusiveMinimum: 0 },
        type: { type: 'string', enum: ['market', 'limit'], default: 'market' },
        time_in_force: { type: 'string', enum: ['day', 'gtc', 'ioc', 'fok'], default: 'day' },
        limit_price: { type: 'number', exclusiveMinimum: 0 },
        simulated_price: { type: 'number', exclusiveMinimum: 0, description: 'Fallback simulation price used only when realtime quote price is unavailable.' },
        extended_hours: { type: 'boolean', default: false, description: 'Accepted for Alpaca compatibility; simulator fill logic is quote-driven and can use extended/overnight quotes on weekdays.' },
        client_order_id: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'alpaca_paper_cancel_order',
    description: 'Cancel a simulated order if it has not filled. Immediate-fill simulator orders are returned unchanged with status filled.',
    inputSchema: {
      type: 'object',
      required: ['order_id'],
      properties: { order_id: { type: 'string' } },
      additionalProperties: false
    }
  },
  {
    name: 'alpaca_paper_reset_account',
    description: 'Reset this user paper account to 100,000 USD cash. This affects only the simulator ledger.',
    inputSchema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', description: 'Must be true.' } },
      required: ['confirm'],
      additionalProperties: false
    }
  }
];

const STRING_FILTER_SCHEMA = { type: 'object', properties: {}, additionalProperties: true };
const SYMBOL_SCHEMA = {
  type: 'object',
  required: ['symbol'],
  properties: { symbol: { type: 'string' } },
  additionalProperties: true
};

const ALPACA_FULL_TOOLS = [
  // Account & Portfolio
  ['get_account_info', 'Balance, margin, and simulated account status.', {}],
  ['get_account_config', 'Trading restrictions, margin settings, and PDT-style simulator config.', {}],
  ['update_account_config', 'Update simulated account configuration settings.', STRING_FILTER_SCHEMA],
  ['get_portfolio_history', 'Simulated equity and P/L over time.', STRING_FILTER_SCHEMA],
  ['get_account_activities', 'Simulator fills, dividends, transfers, and account activities.', STRING_FILTER_SCHEMA],
  ['get_account_activities_by_type', 'Simulator activities filtered by type.', { type: 'object', required: ['activity_type'], properties: { activity_type: { type: 'string' } }, additionalProperties: true }],

  // Trading
  ['get_orders', 'Retrieve simulated orders with filters.', STRING_FILTER_SCHEMA],
  ['get_order_by_id', 'Get a simulated order by ID.', { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } }, additionalProperties: false }],
  ['get_order_by_client_id', 'Get a simulated order by client order ID.', { type: 'object', required: ['client_order_id'], properties: { client_order_id: { type: 'string' } }, additionalProperties: false }],
  ['replace_order_by_id', 'Replace an existing open simulated order.', STRING_FILTER_SCHEMA],
  ['cancel_order_by_id', 'Cancel a specific simulated order.', { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } }, additionalProperties: false }],
  ['cancel_all_orders', 'Cancel all open simulated orders.', {}],
  ['place_stock_order', 'Stocks/ETFs paper order. Symbol must be in watchlist/universe first.', STRING_FILTER_SCHEMA],
  ['place_crypto_order', 'Crypto paper order. Symbol must be in watchlist/universe first.', STRING_FILTER_SCHEMA],
  ['place_option_order', 'Options paper order. Underlying must be in watchlist/universe first.', STRING_FILTER_SCHEMA],

  // Positions
  ['get_all_positions', 'All current simulated positions.', {}],
  ['get_open_position', 'Details for a specific simulated position.', SYMBOL_SCHEMA],
  ['close_position', 'Close a specific simulated position.', SYMBOL_SCHEMA],
  ['close_all_positions', 'Liquidate entire simulated portfolio.', {}],
  ['exercise_options_position', 'Simulated exercise instruction for an option position.', SYMBOL_SCHEMA],
  ['do_not_exercise_options_position', 'Simulated do-not-exercise instruction for an option position.', SYMBOL_SCHEMA],

  // Watchlists
  ['create_watchlist', 'Create a new watchlist/universe.', { type: 'object', required: ['name'], properties: { name: { type: 'string' }, symbols: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }],
  ['get_watchlists', 'List all watchlists/universes.', {}],
  ['get_watchlist_by_id', 'Get a specific watchlist/universe.', { type: 'object', required: ['watchlist_id'], properties: { watchlist_id: { type: 'string' } }, additionalProperties: false }],
  ['update_watchlist_by_id', 'Update a watchlist name and/or symbols.', STRING_FILTER_SCHEMA],
  ['delete_watchlist_by_id', 'Delete a watchlist/universe.', { type: 'object', required: ['watchlist_id'], properties: { watchlist_id: { type: 'string' } }, additionalProperties: false }],
  ['add_asset_to_watchlist_by_id', 'Add an asset to a watchlist/universe.', { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string' }, watchlist_id: { type: 'string', default: 'default' } }, additionalProperties: false }],
  ['remove_asset_from_watchlist_by_id', 'Remove an asset from a watchlist/universe.', { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string' }, watchlist_id: { type: 'string', default: 'default' } }, additionalProperties: false }],

  // Assets & Market Info
  ['get_all_assets', 'List assets with optional filtering.', STRING_FILTER_SCHEMA],
  ['get_asset', 'Detailed info for a specific asset.', SYMBOL_SCHEMA],
  ['get_option_contracts', 'ThetaData-backed option contracts for underlying symbols.', STRING_FILTER_SCHEMA],
  ['get_option_contract', 'Single option contract by symbol or ID.', STRING_FILTER_SCHEMA],
  ['get_calendar', 'Market calendar for a date range.', STRING_FILTER_SCHEMA],
  ['get_clock', 'Current market status and next open/close.', {}],
  ['get_corporate_action_announcements', 'Corporate action announcements.', STRING_FILTER_SCHEMA],
  ['get_corporate_action_announcement', 'Single announcement by ID.', STRING_FILTER_SCHEMA],

  // Stock Data
  ['get_stock_bars', 'Historical OHLCV bars from Leandata stock data.', STRING_FILTER_SCHEMA],
  ['get_stock_quotes', 'Historical bid/ask quotes from Leandata stock data.', STRING_FILTER_SCHEMA],
  ['get_stock_trades', 'Historical trades from Leandata stock data.', STRING_FILTER_SCHEMA],
  ['get_stock_latest_bar', 'Latest stock minute bar.', SYMBOL_SCHEMA],
  ['get_stock_latest_quote', 'Latest stock quote.', SYMBOL_SCHEMA],
  ['get_stock_latest_trade', 'Latest stock trade.', SYMBOL_SCHEMA],
  ['get_stock_snapshot', 'Comprehensive stock snapshot.', SYMBOL_SCHEMA],
  ['get_most_active_stocks', 'Most active stocks by volume/trade count.', STRING_FILTER_SCHEMA],
  ['get_market_movers', 'Top gainers and losers.', STRING_FILTER_SCHEMA],

  // Crypto Data
  ['get_crypto_bars', 'Historical crypto OHLCV bars.', STRING_FILTER_SCHEMA],
  ['get_crypto_quotes', 'Historical crypto quotes.', STRING_FILTER_SCHEMA],
  ['get_crypto_trades', 'Historical crypto trades.', STRING_FILTER_SCHEMA],
  ['get_crypto_latest_bar', 'Latest crypto minute bar.', SYMBOL_SCHEMA],
  ['get_crypto_latest_quote', 'Latest crypto quote.', SYMBOL_SCHEMA],
  ['get_crypto_latest_trade', 'Latest crypto trade.', SYMBOL_SCHEMA],
  ['get_crypto_snapshot', 'Comprehensive crypto snapshot.', SYMBOL_SCHEMA],
  ['get_crypto_latest_orderbook', 'Latest crypto orderbook from Leandata.', SYMBOL_SCHEMA],

  // Options Data + ThetaData
  ['get_option_bars', 'ThetaData-backed historical option OHLCV bars.', STRING_FILTER_SCHEMA],
  ['get_option_trades', 'ThetaData-backed historical option trades.', STRING_FILTER_SCHEMA],
  ['get_option_latest_trade', 'Latest option trade when available.', STRING_FILTER_SCHEMA],
  ['get_option_latest_quote', 'Latest option quote with bid/ask and exchange info when available.', STRING_FILTER_SCHEMA],
  ['get_option_snapshot', 'ThetaData/Leandata option snapshot with Greeks and IV when available.', STRING_FILTER_SCHEMA],
  ['get_option_chain', 'ThetaData-backed full option chain for an underlying.', STRING_FILTER_SCHEMA],
  ['get_option_exchange_codes', 'Option exchange code to name mapping.', {}],

  // Corporate Actions, News, Fixed Income, Index, Locates
  ['get_corporate_actions', 'Corporate action announcements from market data.', STRING_FILTER_SCHEMA],
  ['get_news', 'News articles for stocks and crypto.', STRING_FILTER_SCHEMA],
  ['get_fixed_income_latest_quotes', 'Latest fixed income quotes by ISIN when available.', STRING_FILTER_SCHEMA],
  ['get_index_latest_values', 'Latest market index values when available.', STRING_FILTER_SCHEMA],
  ['get_index_values', 'Historical market index values when available.', STRING_FILTER_SCHEMA],
  ['get_locates', 'Simulator locate requests filtered by status, symbol, or date.', STRING_FILTER_SCHEMA],
  ['create_locate', 'Create a simulated locate request for a short sale.', STRING_FILTER_SCHEMA],
  ['get_locate', 'Get a single simulated locate request by ID.', STRING_FILTER_SCHEMA],
  ['get_locate_quotes', 'Get simulated locate availability and pricing for symbols.', STRING_FILTER_SCHEMA],
].map(([name, description, inputSchema]) => ({
  name,
  description,
  inputSchema: inputSchema && Object.keys(inputSchema).length ? inputSchema : { type: 'object', properties: {}, additionalProperties: false }
}));

const LEGACY_TOOL_ALIASES = {
  alpaca_paper_get_account: 'get_account_info',
  alpaca_paper_get_positions: 'get_all_positions',
  alpaca_paper_get_orders: 'get_orders',
  alpaca_paper_place_order: 'place_stock_order',
  alpaca_paper_cancel_order: 'cancel_order_by_id',
  alpaca_paper_reset_account: 'reset_paper_account',
  alpaca_get_watchlists: 'get_watchlists',
  alpaca_create_watchlist: 'create_watchlist',
  alpaca_add_asset_to_watchlist: 'add_asset_to_watchlist_by_id',
  alpaca_remove_asset_from_watchlist: 'remove_asset_from_watchlist_by_id',
  alpaca_get_watchlist_assets: 'get_watchlist_by_id'
};

const ALL_MCP_TOOLS = [
  ...ALPACA_FULL_TOOLS,
  {
    name: 'reset_paper_account',
    description: 'Reset this user paper account to 100,000 USD cash.',
    inputSchema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'boolean' } }, additionalProperties: false }
  },
  ...ALPACA_PAPER_TOOLS,
];

async function callAlpacaPaperTool(user, name, args = {}, token = '') {
  const userId = user.user_id || user.username || 'unknown';
  const account = readPaperAccount(userId);
  name = LEGACY_TOOL_ALIASES[name] || name;

  if (name === 'get_watchlists') {
    return readWatchlists(userId);
  }

  if (name === 'create_watchlist') {
    const cleanName = String(args.name || '').trim();
    if (!cleanName) throw new Error('name is required');
    const book = readWatchlists(userId);
    const existing = findWatchlist(book, cleanName);
    if (existing) return { watchlist: existing, created: false };

    const now = new Date().toISOString();
    const watchlist = {
      id: crypto.randomUUID(),
      name: cleanName,
      symbols: Array.from(new Set((args.symbols || []).map(s => String(s).trim().toUpperCase()).filter(Boolean))).sort(),
      created_at: now,
      updated_at: now
    };
    book.watchlists.push(watchlist);
    writeWatchlists(book);
    return { watchlist, created: true };
  }

  if (name === 'add_asset_to_watchlist_by_id') {
    const symbol = String(args.symbol || '').trim().toUpperCase();
    if (!symbol) throw new Error('symbol is required');
    const book = readWatchlists(userId);
    const watchlist = findWatchlist(book, args.watchlist_id || 'default');
    if (!watchlist) throw new Error('watchlist not found');
    watchlist.symbols = Array.from(new Set([...(watchlist.symbols || []), symbol])).sort();
    watchlist.updated_at = new Date().toISOString();
    writeWatchlists(book);
    return { watchlist, symbol, added: true };
  }

  if (name === 'remove_asset_from_watchlist_by_id') {
    const symbol = String(args.symbol || '').trim().toUpperCase();
    if (!symbol) throw new Error('symbol is required');
    const book = readWatchlists(userId);
    const watchlist = findWatchlist(book, args.watchlist_id || 'default');
    if (!watchlist) throw new Error('watchlist not found');
    watchlist.symbols = (watchlist.symbols || []).filter(s => s !== symbol);
    watchlist.updated_at = new Date().toISOString();
    writeWatchlists(book);
    return { watchlist, symbol, removed: true };
  }

  if (name === 'get_watchlist_by_id') {
    const book = readWatchlists(userId);
    const watchlist = findWatchlist(book, args.watchlist_id || 'default');
    if (!watchlist) throw new Error('watchlist not found');
    return { watchlist };
  }

  if (name === 'update_watchlist_by_id') {
    const book = readWatchlists(userId);
    const watchlist = findWatchlist(book, args.watchlist_id || 'default');
    if (!watchlist) throw new Error('watchlist not found');
    if (args.name) watchlist.name = String(args.name).trim();
    if (Array.isArray(args.symbols)) watchlist.symbols = args.symbols.map(s => String(s).trim().toUpperCase()).filter(Boolean);
    watchlist.updated_at = new Date().toISOString();
    writeWatchlists(book);
    return { watchlist };
  }

  if (name === 'delete_watchlist_by_id') {
    const key = String(args.watchlist_id || '').trim();
    if (!key || key === 'default') throw new Error('default watchlist cannot be deleted');
    const book = readWatchlists(userId);
    const before = book.watchlists.length;
    book.watchlists = book.watchlists.filter(w => w.id !== key && w.name !== key);
    writeWatchlists(book);
    return { deleted: before !== book.watchlists.length, watchlists: book.watchlists };
  }

  if (name === 'get_account_info') {
    return {
      account: {
        user_id: account.user_id,
        status: 'ACTIVE',
        trading_blocked: false,
        transfers_blocked: true,
        account_blocked: false,
        currency: account.currency,
        cash: account.cash,
        buying_power: account.buying_power,
        equity: account.equity,
        initial_equity: account.initial_equity,
        paper_only: true,
        broker: 'leandata-paper-simulator'
      }
    };
  }

  if (name === 'get_account_config') {
    return {
      config: {
        paper_only: true,
        trade_confirm_email: 'none',
        no_shorting: false,
        suspend_trade: false,
        fractional_trading: true,
        max_margin_multiplier: '1',
        pdt_check: 'simulated',
        universe_required: true
      }
    };
  }

  if (name === 'get_clock') {
    return getNewYorkMarketClock();
  }

  if (name === 'update_account_config') {
    account.config = { ...(account.config || {}), ...args, updated_at: new Date().toISOString() };
    writePaperAccount(account);
    return { config: account.config };
  }

  if (name === 'get_portfolio_history') {
    return {
      portfolio_history: {
        timestamp: [account.updated_at || account.created_at],
        equity: [account.equity],
        profit_loss: [Number(account.equity || 0) - Number(account.initial_equity || 100000)],
        profit_loss_pct: [(Number(account.equity || 0) - Number(account.initial_equity || 100000)) / Number(account.initial_equity || 100000)],
        paper_only: true
      }
    };
  }

  if (name === 'get_account_activities' || name === 'get_account_activities_by_type') {
    const activities = (account.orders || []).map(o => ({
      id: o.id,
      activity_type: 'FILL',
      transaction_time: o.filled_at || o.submitted_at,
      symbol: o.symbol,
      qty: o.filled_qty || o.qty,
      price: o.filled_avg_price,
      side: o.side,
      order_id: o.id,
      paper_only: true
    }));
    const wanted = String(args.activity_type || '').toUpperCase();
    return { activities: wanted ? activities.filter(a => a.activity_type === wanted) : activities.reverse() };
  }

  if (name === 'get_all_positions') {
    return { positions: account.positions || [] };
  }

  if (name === 'get_open_position') {
    const symbol = String(args.symbol || '').trim().toUpperCase();
    assertSymbolInUniverse(userId, symbol);
    const position = (account.positions || []).find(p => p.symbol === symbol);
    if (!position) throw new Error('position not found');
    return { position };
  }

  if (name === 'get_orders') {
    const status = args.status || 'all';
    const limit = Math.max(1, Math.min(Number(args.limit || 50), 200));
    let orders = account.orders || [];
    if (status === 'open') orders = orders.filter(o => ['new', 'accepted', 'open'].includes(o.status));
    else if (status === 'closed') orders = orders.filter(o => ['filled', 'canceled', 'rejected'].includes(o.status));
    else if (status !== 'all') orders = orders.filter(o => o.status === status);
    return { orders: orders.slice(-limit).reverse() };
  }

  if (name === 'get_order_by_id' || name === 'get_order_by_client_id') {
    const orderId = args.order_id || args.client_order_id;
    const order = (account.orders || []).find(o => o.id === orderId || o.client_order_id === orderId);
    if (!order) throw new Error('order not found');
    return { order };
  }

  if (name === 'place_stock_order' || name === 'place_crypto_order' || name === 'place_option_order') {
    const symbol = String(args.symbol || '').trim().toUpperCase();
    const underlying = String(args.underlying_symbol || args.underlying || symbol).trim().toUpperCase();
    const side = String(args.side || '').toLowerCase();
    const qty = Number(args.qty);
    const orderType = args.type || 'market';
    const limitPrice = args.limit_price === undefined ? undefined : Number(args.limit_price);
    const fallbackPrice = Number(args.simulated_price || limitPrice || 100);
    const assetClass = name === 'place_crypto_order' ? 'crypto' : name === 'place_option_order' ? 'option' : 'us_equity';
    if (!symbol) throw new Error('symbol is required');
    assertSymbolInUniverse(userId, underlying || symbol);
    if (!['buy', 'sell'].includes(side)) throw new Error('side must be buy or sell');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('qty must be a positive number');
    if (orderType === 'limit' && (!Number.isFinite(limitPrice) || limitPrice <= 0)) throw new Error('limit_price is required for limit orders');

    const now = new Date().toISOString();
    const simulatorClock = getNewYorkMarketClock();
    let liquidity = null;
    let liquidityError = null;
    if (assetClass === 'crypto' || !simulatorClock.weekend_closed) {
      try {
        liquidity = await fetchSimulatorLiquidity({ token, symbol, assetClass, args });
      } catch (err) {
        liquidityError = err.message || String(err);
      }
    }
    const fillDecision = assetClass !== 'crypto' && simulatorClock.weekend_closed
      ? {
          fill: false,
          status: 'accepted',
          clock: simulatorClock,
          price: null,
          reason: 'weekend_closed',
          quote: null
        }
      : liquidityError
      ? {
          fill: false,
          status: 'accepted',
          clock: simulatorClock,
          price: null,
          reason: 'liquidity_unavailable',
          quote: null,
          liquidity_error: liquidityError
        }
      : decideSimulatorFill({
          assetClass,
          orderType,
          side,
          limitPrice,
          simulatedPrice: fallbackPrice,
          liquidity,
        });
    const fillPrice = Number(fillDecision.price || fallbackPrice);
    const order = {
      id: crypto.randomUUID(),
      client_order_id: args.client_order_id || crypto.randomUUID(),
      symbol,
      asset_class: assetClass,
      side,
      qty,
      type: orderType,
      time_in_force: args.time_in_force || 'day',
      limit_price: limitPrice,
      extended_hours: Boolean(args.extended_hours),
      status: fillDecision.status,
      submitted_at: now,
      filled_at: fillDecision.fill ? now : null,
      filled_qty: fillDecision.fill ? qty : 0,
      filled_avg_price: fillDecision.fill ? fillPrice : null,
      notional: qty * fillPrice,
      simulator_clock: fillDecision.clock,
      simulator_liquidity: {
        quote: fillDecision.quote || null,
        raw_status: liquidity?.raw_status || null,
        error: fillDecision.liquidity_error || null
      },
      simulator_fill_reason: fillDecision.reason,
      simulator_note: fillDecision.fill
        ? 'Simulator fill applied because executable quote/liquidity rules allowed it.'
        : 'Simulator accepted the order but did not fill it because no executable quote was available, it is weekend-closed, or the order is not marketable.',
      paper_only: true
    };

    if (fillDecision.fill) {
      updatePaperPosition(account, symbol, side, qty, fillPrice);
    }
    account.orders = account.orders || [];
    account.orders.push(order);
    writePaperAccount(account);
    return { order, account: (await callAlpacaPaperTool(user, 'get_account_info', {}, token)).account };
  }

  if (name === 'replace_order_by_id') {
    const order = (account.orders || []).find(o => o.id === args.order_id);
    if (!order) throw new Error('order not found');
    if (order.status === 'filled') throw new Error('filled simulator orders cannot be replaced');
    Object.assign(order, args, { replaced_at: new Date().toISOString() });
    writePaperAccount(account);
    return { order };
  }

  if (name === 'cancel_order_by_id') {
    const order = (account.orders || []).find(o => o.id === args.order_id || o.client_order_id === args.order_id);
    if (!order) throw new Error('order not found');
    if (!['filled', 'canceled', 'rejected'].includes(order.status)) {
      order.status = 'canceled';
      order.canceled_at = new Date().toISOString();
      writePaperAccount(account);
    }
    return { order };
  }

  if (name === 'cancel_all_orders') {
    let canceled = 0;
    for (const order of account.orders || []) {
      if (!['filled', 'canceled', 'rejected'].includes(order.status)) {
        order.status = 'canceled';
        order.canceled_at = new Date().toISOString();
        canceled += 1;
      }
    }
    writePaperAccount(account);
    return { canceled };
  }

  if (name === 'close_position') {
    const symbol = String(args.symbol || '').trim().toUpperCase();
    assertSymbolInUniverse(userId, symbol);
    const position = (account.positions || []).find(p => p.symbol === symbol);
    if (!position) throw new Error('position not found');
    const side = Number(position.qty) > 0 ? 'sell' : 'buy';
    const qty = Math.abs(Number(position.qty));
    const price = Number(args.simulated_price || position.market_price || position.avg_entry_price || 100);
    updatePaperPosition(account, symbol, side, qty, price);
    writePaperAccount(account);
    return { closed: true, symbol, qty, simulated_price: price };
  }

  if (name === 'close_all_positions') {
    const positions = [...(account.positions || [])];
    for (const p of positions) {
      const side = Number(p.qty) > 0 ? 'sell' : 'buy';
      updatePaperPosition(account, p.symbol, side, Math.abs(Number(p.qty)), Number(p.market_price || p.avg_entry_price || 100));
    }
    writePaperAccount(account);
    return { closed: positions.length, positions };
  }

  if (name === 'exercise_options_position' || name === 'do_not_exercise_options_position') {
    return { accepted: true, instruction: name, paper_only: true, note: 'Recorded as simulator instruction only.' };
  }

  if (name === 'reset_paper_account') {
    if (args.confirm !== true) throw new Error('confirm must be true');
    const fresh = defaultPaperAccount(userId);
    writeJSON(paperAccountPath(userId), fresh);
    return { reset: true, account: fresh };
  }

  return callAlpacaDataTool(user, name, args, token);
}

async function callAlpacaDataTool(user, name, args = {}, token = '') {
  const userId = user.user_id || user.username || 'unknown';
  assertMcpUniverseForArgs(userId, args);
  const REST = 'https://api.leandata.uk';
  const RT = 'https://rt-api.leandata.uk';

  const routes = {
    get_stock_bars: [`${REST}/v1/history/bars`, args],
    get_stock_quotes: [`${REST}/v1/stock/history/trade_quote`, { ...args, data_type: 'quotes' }],
    get_stock_trades: [`${REST}/v1/stock/history/trade_quote`, { ...args, data_type: 'trades' }],
    get_stock_snapshot: [`${RT}/v1/stocks/snapshot`, args],
    get_stock_latest_bar: [`${RT}/v1/stocks/latest/bar`, args],
    get_stock_latest_quote: [`${RT}/v1/stocks/latest/quote`, args],
    get_stock_latest_trade: [`${RT}/v1/stocks/latest/trade`, args],
    get_crypto_latest_orderbook: [`${REST}/v1/crypto/us/latest/orderbooks`, args],
    get_option_contracts: [`${REST}/v1/options/contracts`, args],
    get_option_chain: [`${REST}/v1/options/snapshots/expiry`, args],
    get_option_snapshot: [`${REST}/v1/options/snapshots`, args],
    get_option_bars: [`${REST}/v1/history/options/bars`, args],
    get_option_trades: [`${REST}/v1/history/options/trades`, args],
    get_option_latest_trade: [`${REST}/v1/options/snapshots/trade`, args],
    get_option_latest_quote: [`${REST}/v1/options/snapshots/quote`, args],
    get_news: [`${REST}/v1/history/news`, args],
    get_corporate_actions: [`${REST}/v1/corporate/actions`, args],
    get_corporate_action_announcements: [`${REST}/v1/corporate/actions`, args],
    get_calendar: [`${REST}/v1/market/calendar`, args],
    get_clock: [`${RT}/v1/market/clock`, args],
    get_most_active_stocks: [`${RT}/v1/stocks/most-active`, args],
    get_market_movers: [`${RT}/v1/stocks/movers`, args],
  };

  if (name === 'get_all_assets') {
    return { assets: [], note: 'Asset directory is not fully materialized yet; add symbols to watchlist before using data/trading tools.' };
  }

  if (name === 'get_asset') {
    const symbol = String(args.symbol || '').toUpperCase();
    assertSymbolInUniverse(userId, symbol);
    return { asset: { symbol, tradable: true, status: 'active', asset_class: 'us_equity', exchange: args.exchange || 'US', source: 'leandata-watchlist' } };
  }

  if (name === 'get_option_contract') {
    return postLeandataJson(token, `${REST}/v1/options/contracts`, args);
  }

  if (name === 'get_option_exchange_codes') {
    return {
      exchanges: {
        A: 'NYSE American Options',
        B: 'BOX Options',
        C: 'Cboe Options',
        I: 'Nasdaq ISE',
        P: 'NYSE Arca Options',
        Q: 'Nasdaq Options',
        W: 'Cboe C2 Options',
        X: 'Nasdaq PHLX',
      },
      source: 'static-reference'
    };
  }

  if (['get_fixed_income_latest_quotes', 'get_index_latest_values', 'get_index_values'].includes(name)) {
    return { unavailable: true, tool: name, message: 'Tool is exposed for Alpaca compatibility; Leandata backend route is not enabled yet.' };
  }

  if (['get_locates', 'create_locate', 'get_locate', 'get_locate_quotes'].includes(name)) {
    return { simulated: true, tool: name, locates: [], message: 'Locate tools are simulator-only and do not contact a broker.' };
  }

  if (['get_corporate_action_announcement'].includes(name)) {
    return { unavailable: true, tool: name, message: 'Single announcement lookup route is not enabled yet.' };
  }

  const route = routes[name];
  if (route) {
    const [url, payload] = route;
    return postLeandataJson(token, url, payload);
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleMcpRequest(principal, message) {
  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : undefined;
  if (!message || message.jsonrpc !== '2.0') {
    return mcpJsonRpcError(id, -32600, 'Invalid JSON-RPC request');
  }

  if (message.method === 'initialize') {
    const requestedVersion = message.params?.protocolVersion || '2025-06-18';
    return mcpJsonRpc(id, {
      protocolVersion: requestedVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'leandata-alpaca-paper', version: '0.1.0' }
    });
  }

  if (message.method === 'notifications/initialized') {
    return undefined;
  }

  if (message.method === 'tools/list') {
    return mcpJsonRpc(id, { tools: ALL_MCP_TOOLS });
  }

  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    const userId = principal.user.user_id || principal.user.username || 'unknown';
    const started = Date.now();
    try {
      const payload = await callAlpacaPaperTool(principal.user, name, args, principal.token);
      appendMcpAudit(userId, {
        tool: name,
        arguments: cleanMcpArgs(args),
        ok: true,
        duration_ms: Date.now() - started,
        result_summary: summarizeMcpResult(payload)
      });
      return mcpJsonRpc(id, mcpTextResult(payload));
    } catch (err) {
      appendMcpAudit(userId, {
        tool: name,
        arguments: cleanMcpArgs(args),
        ok: false,
        duration_ms: Date.now() - started,
        error: err.message || 'Tool call failed'
      });
      return mcpJsonRpcError(id, -32000, err.message || 'Tool call failed');
    }
  }

  if (message.method === 'ping') {
    return mcpJsonRpc(id, {});
  }

  if (id === undefined) return undefined;
  return mcpJsonRpcError(id, -32601, `Method not found: ${message.method}`);
}

const MCP_MAX_BATCH_SIZE = Math.max(1, Math.min(Number(process.env.MCP_MAX_BATCH_SIZE) || 20, 100));
const MCP_BATCH_CONCURRENCY = Math.max(1, Math.min(Number(process.env.MCP_BATCH_CONCURRENCY) || 4, MCP_MAX_BATCH_SIZE));

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

app.get('/mcp/alpaca', (req, res) => {
  const principal = resolveMcpPrincipal(req);
  if (!principal) return res.status(401).json({ error: 'Missing or invalid Leandata bearer token.' });
  if (principal.expired) return res.status(403).json({ error: 'Leandata token expired.' });
  return res.json({
    name: 'leandata-alpaca-paper',
    transport: 'streamable-http',
    endpoint: '/mcp/alpaca',
    paper_only: true,
    user_id: principal.user.user_id,
    tools: ALPACA_PAPER_TOOLS.map(t => t.name)
  });
});

app.post('/mcp/alpaca', async (req, res) => {
  const principal = resolveMcpPrincipal(req);
  if (!principal) return res.status(401).json({ error: 'Missing or invalid Leandata bearer token.' });
  if (principal.expired) return res.status(403).json({ error: 'Leandata token expired.' });

  const messages = Array.isArray(req.body) ? req.body : [req.body];
  if (messages.length > MCP_MAX_BATCH_SIZE) {
    return res.status(400).json({ error: `MCP batch limit is ${MCP_MAX_BATCH_SIZE} requests.` });
  }
  const replies = (await mapWithConcurrency(messages, MCP_BATCH_CONCURRENCY, msg => handleMcpRequest(principal, msg))).filter(Boolean);
  if (replies.length === 0) return res.status(202).end();
  res.setHeader('Mcp-Session-Id', safePaperUserId(principal.user.user_id || 'unknown'));
  return res.json(Array.isArray(req.body) ? replies : replies[0]);
});

// ============================================================
// PAYMENT: Server-authoritative bundles and local mock provider
// ============================================================
app.use('/api/payment', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

app.get('/api/payment/checkout-info', (req, res) => {
  const context = resolvePaymentCheckoutContext(req, req.query.checkout_token);
  if (!context) {
    return res.status(401).json({
      success: false,
      message: '结账凭证已失效，请从注册页或账户管理页重新进入。'
    });
  }
  const suggestedMode = context.suggested_tier === 'value'
    ? (context.suggested_mode || 'stocks')
    : null;
  const suggestedBundleId = [
    context.suggested_tier,
    suggestedMode,
    '1m'
  ].filter(Boolean).join('-');
  return res.json({
    success: true,
    kind: context.kind,
    identity: context.kind === 'registration'
      ? {
          user_id: context.registration.username,
          email: context.registration.email
        }
      : {
          user_id: context.localUser.username || context.user_id,
          current_tier: context.localUser.tier || context.proxyUser.role || 'standard',
          current_expiry: context.proxyUser.expires_at || null
        },
    plans: checkoutPlansForContext(context),
    bundles: Object.values(PAYMENT_BUNDLES)
      .filter(bundle => paymentBundleAllowedForContext(bundle, context))
      .map(publicPaymentBundle),
    payment_methods: enabledPaymentMethods(),
    suggested_bundle_id: PAYMENT_BUNDLES[suggestedBundleId]
      && paymentBundleAllowedForContext(PAYMENT_BUNDLES[suggestedBundleId], context)
      ? suggestedBundleId
      : (context.kind === 'registration' ? 'standard-1m' : 'standard-1m'),
    mock_enabled: process.env.PAYMENT_MOCK_ENABLED === 'true',
    pricing_notice: '人民币套餐价与 Stripe 卡支付价分开计价；结账前会显示最终币种和金额。'
  });
});

app.post('/api/payment/orders', async (req, res) => {
  const context = resolvePaymentCheckoutContext(req, req.body?.checkout_token);
  if (!context) {
    return res.status(401).json({
      success: false,
      message: '结账凭证已失效，请重新进入结账页。'
    });
  }
  const bundleId = String(req.body?.bundle_id || '').trim();
  const paymentMethod = String(req.body?.payment_method || '').trim();
  const bundle = PAYMENT_BUNDLES[bundleId];
  if (!bundle || !paymentBundleAllowedForContext(bundle, context)) {
    return res.status(400).json({ success: false, message: '请选择有效的支付套餐。' });
  }
  if (!PAYMENT_METHOD_IDS.has(paymentMethod)) {
    return res.status(400).json({ success: false, message: '请选择有效的支付方式。' });
  }
  const paymentMethodConfig = enabledPaymentMethods().find(method => method.id === paymentMethod);
  if (!paymentMethodConfig) {
    return res.status(400).json({ success: false, message: '该支付方式尚未启用。' });
  }
  if (!paymentMethodConfig.available) {
    return res.status(503).json({
      success: false,
      message: paymentMethod === 'alipay'
        ? '支付宝暂时不可用，请稍后重试。'
        : '该支付方式暂时不可用。'
    });
  }
  const providerCharge = paymentMethod === 'stripe_card'
    ? stripeProviderCharge(bundle, req.body?.stripe_currency)
    : paymentMethod === 'alipay'
      ? zpayProviderCharge(bundle)
      : null;
  if (paymentMethod === 'stripe_card' && !providerCharge) {
    return res.status(400).json({
      success: false,
      message: 'Stripe 仅支持 CAD 或 USD 结账。'
    });
  }

  if (context.kind === 'registration') {
    const approved = findLocalAccount(accountRegistryId(context.registration));
    if (approved) {
      return res.status(409).json({
        success: false,
        message: '该用户名已经开通，请使用账户管理续费。'
      });
    }
  }

  const resumeToken = crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  let order = {
    id: `pay_${crypto.randomUUID()}`,
    kind: context.kind,
    registration_id: context.kind === 'registration' ? context.registration.id : null,
    registration: context.kind === 'registration'
      ? {
          username: context.registration.username,
          phone: context.registration.phone,
          email: context.registration.email
        }
      : null,
    user_id: context.kind === 'renewal' ? context.user_id : null,
    bundle_id: bundle.id,
    bundle: publicPaymentBundle(bundle),
    payment_method: paymentMethod,
    checkout_locale: req.body?.checkout_locale === 'en' ? 'en' : 'zh',
    ...(providerCharge && { provider_charge: providerCharge }),
    provider: process.env.PAYMENT_MOCK_ENABLED === 'true'
      ? 'local_mock'
      : paymentMethod === 'stripe_card'
        ? 'stripe_checkout'
        : paymentMethod === 'alipay'
          ? 'zpay'
          : 'easypay',
    status: 'PENDING',
    payment_status: 'UNPAID',
    resume_token_hash: paymentTokenHash(resumeToken),
    ...(context.kind === 'registration' && {
      checkout_token_hash: context.registration.checkout_token_hash
    }),
    created_at: now,
    fulfillment_attempts: 0
  };
  const orders = readPaymentOrders();
  orders.push(order);
  writePaymentOrders(orders);

  let checkoutUrl = null;
  if (paymentMethod === 'alipay' && process.env.PAYMENT_MOCK_ENABLED !== 'true') {
    if (!zpayConfigured()) {
      updatePaymentOrder(order.id, current => ({
        ...current,
        status: 'FAILED',
        last_error: 'Z-Pay 尚未配置。'
      }));
      return res.status(503).json({
        success: false,
        message: '支付宝商户信息尚未配置。'
      });
    }
    try {
      checkoutUrl = createZpayCheckoutUrl(
        req,
        order,
        bundle,
        context.kind === 'registration' ? String(req.body.checkout_token || '') : ''
      );
      order = updatePaymentOrder(order.id, current => ({
        ...current,
        zpay_out_trade_no: order.id,
        zpay_subject: `Leandata ${bundle.name} ${bundle.months}M`,
        checkout_url: checkoutUrl
      }));
    } catch (error) {
      updatePaymentOrder(order.id, current => ({
        ...current,
        status: 'FAILED',
        last_error: `Z-Pay 结账创建失败：${error.message}`
      }));
      return res.status(502).json({
        success: false,
        message: '无法创建支付宝支付，请稍后重试。'
      });
    }
  }
  if (paymentMethod === 'stripe_card' && process.env.PAYMENT_MOCK_ENABLED !== 'true') {
    if (!stripeConfigured()) {
      updatePaymentOrder(order.id, current => ({
        ...current,
        status: 'FAILED',
        last_error: 'Stripe 尚未配置。'
      }));
      return res.status(503).json({
        success: false,
        message: 'Stripe 测试/正式密钥与 webhook secret 尚未配置。'
      });
    }

    const baseUrl = paymentBaseUrl(req);
    const returnQuery = new URLSearchParams({
      stripe_order: order.id,
      ...(context.kind === 'registration' && req.body?.checkout_token
        ? { checkout_token: String(req.body.checkout_token) }
        : {})
    });
    const successUrl = `${baseUrl}/checkout?${returnQuery.toString()}`;
    const cancelQuery = new URLSearchParams(returnQuery);
    cancelQuery.set('stripe_cancelled', '1');

    try {
      const session = await createStripeCheckoutSession(
        order,
        bundle,
        context.kind === 'registration'
          ? context.registration.email
          : (context.localUser.email || undefined),
        successUrl,
        `${baseUrl}/checkout?${cancelQuery.toString()}`
      );
      checkoutUrl = session.url;
      order = updatePaymentOrder(order.id, current => ({
        ...current,
        stripe_checkout_session_id: session.id,
        checkout_url: session.url
      }));
    } catch (error) {
      updatePaymentOrder(order.id, current => ({
        ...current,
        status: 'FAILED',
        last_error: `Stripe Checkout 创建失败：${error.message}`
      }));
      return res.status(502).json({
        success: false,
        message: '无法创建 Stripe Checkout，请稍后重试。'
      });
    }
  }

  return res.status(201).json({
    success: true,
    order: publicPaymentOrder(order),
    resume_token: resumeToken,
    mock_enabled: process.env.PAYMENT_MOCK_ENABLED === 'true',
    checkout_url: checkoutUrl
  });
});

app.get('/api/payment/orders/:id', (req, res) => {
  const order = readPaymentOrders().find(item => item.id === req.params.id);
  if (!order || !paymentOrderAccessAllowed(
    req,
    order,
    req.query.resume_token,
    req.query.checkout_token
  )) {
    return res.status(404).json({ success: false, message: '支付订单不存在。' });
  }
  return res.json({
    success: true,
    order: publicPaymentOrder(order),
    ...(order.kind === 'registration'
      && order.status === 'COMPLETED'
      && order.issued_token
      ? { issued_token: order.issued_token }
      : {})
  });
});

app.post('/api/payment/mock/:id/complete', async (req, res) => {
  if (process.env.PAYMENT_MOCK_ENABLED !== 'true') {
    return res.status(404).json({ success: false, message: '本地模拟支付未启用。' });
  }
  let order = readPaymentOrders().find(item => item.id === req.params.id);
  if (!order || !paymentOrderAccessAllowed(req, order, req.body?.resume_token)) {
    return res.status(404).json({ success: false, message: '支付订单不存在。' });
  }
  if (order.status === 'CANCELLED') {
    return res.status(409).json({ success: false, message: '订单已取消。' });
  }
  if (order.status !== 'COMPLETED' && order.payment_status !== 'PAID') {
    const paidAt = new Date().toISOString();
    order = updatePaymentOrder(order.id, current => ({
      ...current,
      payment_status: 'PAID',
      status: 'PAID',
      paid_at: paidAt,
      provider_payment_id: `mock_${crypto.randomUUID()}`
    }));
  }

  try {
    const fulfilled = await fulfillPaymentOrder(order.id);
    return res.json({
      success: true,
      order: publicPaymentOrder(fulfilled.order),
      issued_token: fulfilled.order.kind === 'registration' ? fulfilled.token : undefined
    });
  } catch (error) {
    const failedOrder = readPaymentOrders().find(item => item.id === order.id);
    return res.status(500).json({
      success: false,
      retryable: failedOrder?.payment_status === 'PAID',
      message: error.message,
      order: failedOrder ? publicPaymentOrder(failedOrder) : null
    });
  }
});

// ============================================================
// PUBLIC: Buyer Registration
// ============================================================
app.post('/api/register/request-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: '请输入有效的邮箱地址。' });
  }
  if (!emailSetting('EMAIL_VERIFY_SECRET')
    || (emailSetting('EMAIL_TEST_MODE') !== 'memory' && !emailSmtpConfig())) {
    return res.status(503).json({ success: false, message: '邮箱验证服务尚未配置完成。' });
  }

  const rate = checkVerificationSendRate(req, email);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({
      success: false,
      message: '验证码发送次数过多，请稍后再试。',
      retry_after: rate.retryAfter
    });
  }

  const now = Date.now();
  const challenges = readJSON(EMAIL_VERIFICATION_FILE, []);
  const previous = challenges.find(entry => entry.email === email && entry.status === 'pending');
  if (previous && now - new Date(previous.sent_at).getTime() < EMAIL_CODE_RESEND_COOLDOWN_MS) {
    const retryAfter = Math.max(
      1,
      Math.ceil((new Date(previous.sent_at).getTime() + EMAIL_CODE_RESEND_COOLDOWN_MS - now) / 1000)
    );
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      message: '验证码已发送，请稍后再试。',
      retry_after: retryAfter
    });
  }

  const challengeId = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const sentAt = new Date(now).toISOString();
  const challenge = {
    id: challengeId,
    email,
    code_hash: verificationCodeHash(challengeId, code),
    attempts: 0,
    status: 'pending',
    sent_at: sentAt,
    expires_at: new Date(now + EMAIL_CODE_TTL_MS).toISOString()
  };
  const nextChallenges = challenges
    .filter(entry => !(entry.email === email && entry.status === 'pending'));
  nextChallenges.push(challenge);
  writeJSONAtomic(EMAIL_VERIFICATION_FILE, nextChallenges);

  try {
    await sendVerificationEmail(email, code);
  } catch (error) {
    writeJSONAtomic(
      EMAIL_VERIFICATION_FILE,
      nextChallenges.filter(entry => entry.id !== challengeId)
    );
    console.error('Verification email send error:', error.message);
    return res.status(502).json({ success: false, message: '验证码邮件发送失败，请稍后重试。' });
  }

  return res.status(202).json({
    success: true,
    challenge_id: challengeId,
    expires_in: Math.floor(EMAIL_CODE_TTL_MS / 1000),
    message: `验证码已发送到 ${email}。`
  });
});

app.post('/api/register', async (req, res) => {
  const {
    username,
    phone,
    tier,
    email,
    verification_id: verificationId,
    verification_code: verificationCode
  } = req.body || {};
  const cleanUsername = (username || '').trim();
  const cleanPhone = (phone || '').trim();
  const cleanEmail = normalizeEmail(email);
  const identity = canonicalAccountIdentity({
    username: cleanUsername,
    phone: cleanPhone,
    email: cleanEmail
  });

  if (!cleanUsername || !cleanPhone) {
    return res.status(400).json({ success: false, message: '用户名和手机号都是必填的。' });
  }
  if (cleanEmail && !isValidEmail(cleanEmail)) {
    return res.status(400).json({ success: false, message: '邮箱格式不正确。' });
  }
  if (!hasCompleteAccountIdentity(identity)) {
    return res.status(400).json({ success: false, message: '用户名和手机号必须共同构成账户标识。' });
  }

  const requestedTier = String(tier || 'free').trim().toLowerCase();
  if (requestedTier !== 'free') {
    return res.status(400).json({
      success: false,
      error: 'registration_is_free_only',
      message: '注册默认开通 Free。付费套餐请先注册并从账户管理中心升级。'
    });
  }
  const selectedTier = 'free';

  const users = readJSON(USERS_FILE);
  const proxyData = readJSON(PROXY_USERS_FILE, { users: [] });
  const proxyUsers = Array.isArray(proxyData.users) ? proxyData.users : [];
  const existingUser = users.find(user => sameAccountIdentity(user, identity));
  if (existingUser) {
    const proxyUser = proxyUsers.find(user => user.user_id === accountRegistryId(existingUser));
    if (proxyUser?.token) {
      const tierId = existingUser.tier || proxyUser.role || 'free';
      return res.json({
        success: true,
        status: 'existing_account',
        message: '该用户名和手机号的组合已开通。请前往账户管理升级或查看用量。',
        account_url: '/account',
        tier: tierId,
        current_plan: publicPlan(tierId)
      });
    }
    return res.json({
      success: true,
      status: 'sync_pending',
      message: '该账户组合正在同步到数据服务；请稍后从账户管理登录。'
    });
  }

  const accountId = accountRegistryIdForNewIdentity(identity, cleanUsername, users, proxyUsers);
  const entry = {
    id: crypto.randomUUID(),
    type: 'registration',
    username: cleanUsername,
    phone: cleanPhone,
    tier: selectedTier,
    ...(cleanEmail && { email: cleanEmail }),
    account_id: accountId,
    registered_at: new Date().toISOString()
  };
  try {
    const provisioned = await provisionFreeRegistration(entry);
    return res.status(201).json({
      success: true,
      status: 'approved',
      message: 'Free 计划已启用。请立即复制并安全保存你的 Token。',
      token: provisioned.token,
      expiry: provisioned.expiresAt,
      role: provisioned.role,
      tier: 'free',
      current_plan: publicPlan('free')
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || '无法启用 Free 计划。'
    });
  }
});

// ============================================================
// PUBLIC: One-off bulk download estimates and order requests
// ============================================================
const BULK_SCHEMA_IDS = new Set([
  'options_eod_theta',
  'options_eod_alpaca',
  'options_oi',
  'options_contracts',
  'stock_minute',
  'stock_daily'
]);
const BULK_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizeBulkRequest(body = {}) {
  const tickers = [...new Set(
    (Array.isArray(body.tickers) ? body.tickers : String(body.tickers || '').split(/[\s,]+/))
      .map(value => String(value).trim().toUpperCase())
      .filter(Boolean)
  )];
  const schemasInput = body.schemas ?? body.datasets;
  const schemas = [...new Set(
    (Array.isArray(schemasInput) ? schemasInput : String(schemasInput || '').split(','))
      .map(value => String(value).trim().toLowerCase())
      .filter(Boolean)
  )];
  return {
    tickers,
    schemas,
    start: String(body.start || '2021-01-01').trim(),
    end: String(body.end || '2026-07-22').trim(),
    custom_request: String(body.custom_request || '').trim()
  };
}

function validateBulkRequest({ tickers, schemas, start, end, custom_request: customRequest }) {
  if (schemas.length > 0 && tickers.length === 0) {
    return 'At least one ticker is required for measured datasets.';
  }
  if (tickers.length > 1000) return 'A single order supports at most 1,000 tickers.';
  if (tickers.some(ticker => !/^(?:\^[A-Z0-9]+|[A-Z0-9][A-Z0-9./-]{0,31})$/.test(ticker) || ticker.includes('..'))) {
    return 'One or more tickers are invalid.';
  }
  if (schemas.length === 0 && !customRequest) {
    return 'Select at least one bulk dataset or describe a custom endpoint request.';
  }
  if (schemas.some(schema => !BULK_SCHEMA_IDS.has(schema))) {
    return 'One or more bulk datasets are not available for measured estimates.';
  }
  if (customRequest.length > 2000) {
    return 'Custom endpoint requests must be 2,000 characters or fewer.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return 'Start and end must use YYYY-MM-DD.';
  }
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'Start or end date is invalid.';
  }
  if (startDate > endDate) return 'Start must be on or before end.';
  return null;
}

async function fetchBulkEstimate(payload) {
  const response = await fetch(`${PROXY_REST_URL}/v1/bulk/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tickers: payload.tickers,
      schemas: payload.schemas
    })
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'Bulk estimate failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

app.post('/api/bulk/estimate', async (req, res) => {
  const payload = normalizeBulkRequest(req.body);
  const validationError = validateBulkRequest(payload);
  if (validationError) {
    return res.status(400).json({
      success: false,
      error: 'invalid_bulk_request',
      message: validationError
    });
  }
  if (payload.schemas.length === 0) {
    return res.status(422).json({
      success: false,
      error: 'manual_quote_required',
      message: 'Custom endpoint requests require a manual quote. Submit the request with your contact details.'
    });
  }
  try {
    const estimate = await fetchBulkEstimate(payload);
    return res.json({
      success: true,
      ...estimate,
      requested_range: { start: payload.start, end: payload.end },
      range_pricing_note: 'The current estimate uses the measured full archive window. Final billing uses the fulfilled slice measured in uncompressed bytes.'
    });
  } catch (error) {
    console.error('Bulk estimate proxy error:', error.message);
    return res.status(error.status || 502).json({
      success: false,
      error: 'bulk_estimate_unavailable',
      message: error.message
    });
  }
});

app.post('/api/bulk/orders', async (req, res) => {
  const payload = normalizeBulkRequest(req.body);
  const validationError = validateBulkRequest(payload);
  if (validationError) {
    return res.status(400).json({
      success: false,
      error: 'invalid_bulk_request',
      message: validationError
    });
  }

  const username = String(req.body?.username || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const email = String(req.body?.email || '').trim();
  if (!username || !phone || !email) {
    return res.status(400).json({
      success: false,
      error: 'contact_required',
      message: 'Username, phone, and email are required.'
    });
  }
  if (!BULK_EMAIL_RE.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'invalid_email',
      message: 'A valid email address is required.'
    });
  }

  try {
    const estimate = payload.schemas.length > 0
      ? await fetchBulkEstimate(payload)
      : null;
    const orders = readJSON(BULK_ORDERS_FILE, []);
    const quoteMode = payload.custom_request
      ? (payload.schemas.length > 0 ? 'mixed' : 'manual')
      : 'measured';
    const order = {
      id: crypto.randomUUID(),
      status: 'pending',
      quote_mode: quoteMode,
      username,
      phone,
      email,
      tickers: payload.tickers,
      schemas: payload.schemas,
      start: payload.start,
      end: payload.end,
      estimate,
      custom_request: payload.custom_request.slice(0, 2000),
      note: String(req.body?.note || '').trim().slice(0, 1000),
      created_at: new Date().toISOString()
    };
    orders.push(order);
    writeJSON(BULK_ORDERS_FILE, orders);
    return res.status(201).json({
      success: true,
      order_id: order.id,
      status: order.status,
      quote_mode: quoteMode,
      manual_quote_required: Boolean(payload.custom_request),
      estimated_raw_bytes: estimate?.estimated_raw_bytes ?? null,
      estimated_transfer_bytes: estimate?.estimated_transfer_bytes ?? null,
      estimated_price: estimate?.pricing?.estimated_price ?? null,
      currency: estimate?.pricing?.currency || 'CNY'
    });
  } catch (error) {
    console.error('Bulk order estimate error:', error.message);
    return res.status(error.status || 502).json({
      success: false,
      error: 'bulk_order_unavailable',
      message: error.message
    });
  }
});

app.get('/api/admin/bulk-orders', requireAdmin, (_req, res) => {
  const orders = readJSON(BULK_ORDERS_FILE, [])
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
  return res.json({ success: true, orders });
});

app.post('/api/admin/bulk-orders/:id/status', requireAdmin, (req, res) => {
  const allowed = new Set(['pending', 'approved', 'rejected', 'fulfilled']);
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!allowed.has(status)) {
    return res.status(400).json({ success: false, message: 'Invalid bulk order status.' });
  }

  const orders = readJSON(BULK_ORDERS_FILE, []);
  const order = orders.find(item => item.id === req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Bulk order not found.' });
  }

  order.status = status;
  order.updated_at = new Date().toISOString();
  const actualRawBytes = Number(req.body?.actual_raw_bytes);
  if (Number.isSafeInteger(actualRawBytes) && actualRawBytes >= 0) {
    const billableGb = Math.max(50, Math.ceil(actualRawBytes / 1_000_000_000));
    order.actual_raw_bytes = actualRawBytes;
    order.final_price = 50 + Math.max(0, billableGb - 50);
    order.currency = 'CNY';
  }
  const quotedPrice = Number(req.body?.quoted_price);
  if (Number.isFinite(quotedPrice) && quotedPrice >= 0 && quotedPrice <= 1_000_000_000) {
    order.quoted_price = Math.round(quotedPrice * 100) / 100;
    order.currency = 'CNY';
    if (status === 'fulfilled' && order.final_price === undefined) {
      order.final_price = order.quoted_price;
    }
  }
  order.admin_note = String(req.body?.admin_note || '').trim().slice(0, 1000);
  writeJSON(BULK_ORDERS_FILE, orders);
  return res.json({
    success: true,
    order_id: order.id,
    status: order.status,
    quoted_price: order.quoted_price ?? null,
    final_price: order.final_price ?? null,
    currency: order.currency || order.estimate?.pricing?.currency || 'CNY'
  });
});

// ============================================================
// ACCOUNT: Login, overview, logout, and renewal request
// ============================================================
app.use('/api/account', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

app.post('/api/account/login', (req, res) => {
  if (!accountLoginAllowed(req)) {
    return res.status(429).json({ success: false, message: '登录尝试过多，请 15 分钟后重试。' });
  }
  const credential = req.body?.credential;
  const username = String(credential?.user_id || '').trim();
  const phone = String(credential?.phone || '').trim();
  if (!username || !phone || username.length > 128 || phone.length > 64) {
    return res.status(400).json({ success: false, message: '请提供用户名和手机号。' });
  }

  const identity = canonicalAccountIdentity({ username, phone });
  const localMatches = findLocalAccountByIdentity(identity);
  const localUser = localMatches.length === 1 ? localMatches[0] : null;
  const accountId = localUser ? accountRegistryId(localUser) : '';
  const proxyUser = accountId ? findProxyAccount(accountId) : null;
  if (!localUser || !proxyUser || !proxyUser.token) {
    recordAccountLoginFailure(req);
    return res.status(401).json({ success: false, message: '用户名或手机号不匹配。' });
  }

  clearAccountLoginFailures(req);
  const sessionId = createAccountSession(accountId);
  setAccountSessionCookie(res, sessionId);
  return res.json({
    success: true,
    account: {
      user_id: localUser.username,
      role: proxyUser.role || localUser.role || 'standard',
      email: localUser.email || proxyUser.email || null,
      expiry: proxyUser.expires_at || null
    }
  });
});

app.post('/api/account/logout', (req, res) => {
  const resolved = resolveAccountSession(req);
  if (resolved) accountSessions.delete(resolved.sessionId);
  clearAccountSessionCookie(res);
  return res.json({ success: true });
});

app.get('/api/account/session', requireAccount, (req, res) => {
  return res.json({
    success: true,
    account: {
      user_id: req.account.localUser.username || req.account.userId,
      role: req.account.proxyUser.role || req.account.localUser.role || 'standard',
      expiry: req.account.proxyUser.expires_at || null
    }
  });
});

app.get('/api/account/token', requireAccount, (req, res) => {
  const token = String(req.account.proxyUser.token || '');
  if (!token) {
    return res.status(404).json({ success: false, message: '当前账户没有可用 Token。' });
  }
  return res.json({
    success: true,
    token,
    expires_at: req.account.proxyUser.expires_at || null
  });
});

app.get('/api/account/overview', requireAccount, async (req, res) => {
  const { userId, localUser, proxyUser } = req.account;
  const wsUsageUrl = process.env.PROXY_WS_USAGE_URL
    || `http://${PROXY_WS_HOST}:${PROXY_WS_PORT}/account/usage`;
  const [restUsage, wsUsage] = await Promise.all([
    fetchAccountUsage(`${PROXY_REST_URL}/v1/account/usage`, proxyUser.token),
    fetchAccountUsage(wsUsageUrl, proxyUser.token)
  ]);
  const expiry = proxyUser.expires_at || null;
  const expiryMs = expiry ? new Date(expiry).getTime() : NaN;
  const daysRemaining = Number.isNaN(expiryMs)
    ? null
    : Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000));
  return res.json({
    success: true,
    account: {
      user_id: localUser.username || userId,
      role: proxyUser.role || localUser.role || 'standard',
      tier: localUser.tier || proxyUser.role || 'standard',
      mode: localUser.mode || null,
      email: proxyUser.email || localUser.email || null,
      expiry,
      days_remaining: daysRemaining,
      token_masked: maskToken(proxyUser.token)
    },
    usage: {
      rest: restUsage?.rest || null,
      ws: wsUsage?.ws || null,
      windows: {
        rest: restUsage?.window || null,
        ws: wsUsage?.window || null
      }
    },
    renewal: publicRenewalStatus(latestRenewalFor(userId))
  });
});

app.post('/api/account/email', requireAccount, (req, res) => {
  return res.status(410).json({
    success: false,
    error: 'account_identity_immutable',
    message: '注册邮箱是账户标识的一部分，不能在线修改。'
  });
});

app.post('/api/account/renew', requireAccount, (req, res) => {
  const selectedTier = String(req.body?.tier || '').trim();
  const mode = String(req.body?.mode || '').trim();
  const months = Number(req.body?.months);
  if (!['basic', 'value', 'standard', 'premium'].includes(selectedTier)) {
    return res.status(400).json({ success: false, message: '请选择有效的续费套餐。' });
  }
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    return res.status(400).json({ success: false, message: '续费月数必须是 1–12 个月。' });
  }
  if (selectedTier === 'value' && !TIERS.value.modes[mode]) {
    return res.status(400).json({ success: false, message: 'Value 套餐请选择 stocks 或 options 方向。' });
  }

  const pending = readJSON(PENDING_FILE);
  const alreadyPending = pending.find(p => accountRegistryId(p) === req.account.userId && p.status === 'pending' && p.type === 'renewal');
  if (alreadyPending) {
    return res.status(409).json({ success: false, message: '该账号已有续费申请正在审核中，请等待管理员确认。', id: alreadyPending.id });
  }

  const renewDays = months * (TIERS[selectedTier].expiryDays || 30);
  const entry = {
    id: crypto.randomUUID(),
    type: 'renewal',
    username: req.account.localUser.username,
    phone: req.account.localUser.phone,
    email: req.account.localUser.email,
    account_id: req.account.userId,
    tier: selectedTier,
    ...(selectedTier === 'value' && { mode }),
    months,
    renew_days: renewDays,
    registered_at: new Date().toISOString(),
    requested_at: new Date().toISOString(),
    status: 'pending'
  };

  pending.push(entry);
  writeJSON(PENDING_FILE, pending);

  return res.status(201).json({
    success: true,
    status: 'pending',
    message: '续费申请已提交，请等待管理员确认订单。',
    renewal: publicRenewalStatus(entry)
  });
});

// ============================================================
// PRODUCT UPDATES: public changelog + account-scoped feedback
// ============================================================
app.get('/api/product-updates', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.json({ success: true, updates: PRODUCT_UPDATES });
});

app.get('/api/product-updates/feedback/mine', requireAccount, (req, res) => {
  const entries = readJSON(PRODUCT_FEEDBACK_FILE, [])
    .filter(entry => entry.user_id === req.account.userId)
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
    .map(publicProductFeedback);
  return res.json({ success: true, feedback: entries });
});

app.post('/api/product-updates/feedback', requireAccount, (req, res) => {
  if (!productFeedbackAllowed(req.account.userId)) {
    return res.status(429).json({ success: false, error: 'feedback_rate_limited', message: '留言次数已达上限，请稍后再试。' });
  }
  const message = String(req.body?.message || '').trim();
  if (!message || message.length > 2000) {
    return res.status(400).json({ success: false, error: 'invalid_feedback', message: '留言不能为空，且最多 2000 个字符。' });
  }
  const now = new Date().toISOString();
  const entry = {
    id: `feedback_${crypto.randomUUID()}`,
    user_id: req.account.userId,
    message,
    created_at: now,
    status: 'received'
  };
  const entries = readJSON(PRODUCT_FEEDBACK_FILE, []);
  entries.push(entry);
  try {
    writeJSONAtomic(PRODUCT_FEEDBACK_FILE, entries);
  } catch {
    return res.status(500).json({ success: false, error: 'feedback_persist_failed', message: '留言保存失败，请稍后重试。' });
  }
  productFeedbackAttempts.set(req.account.userId, [
    ...(productFeedbackAttempts.get(req.account.userId) || []),
    Date.now()
  ]);
  return res.status(201).json({ success: true, feedback: publicProductFeedback(entry) });
});

app.post('/api/renew', (_req, res) => {
  return res.status(410).json({
    success: false,
    message: '续费入口已迁移到账户管理中心，请先登录 /account。'
  });
});

// ============================================================
// PUBLIC: Buyer check status (by username + phone)
// ============================================================
app.post('/api/check-status', (req, res) => {
  const { username, phone, email } = req.body;
  const identity = canonicalAccountIdentity({ username, phone, email });
  if (!hasCompleteAccountIdentity(identity)) {
    return res.status(400).json({ success: false, message: '请提供用户名和手机号。' });
  }

  const users = readJSON(USERS_FILE);
  const approved = users.find(user => sameAccountIdentity(user, identity));
  if (approved) {
      // Look up proxy users.json for token + expiry
      let maskedToken = null, expiresAt = null, role = null;
      try {
        const proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
        const proxyUser = (proxyData.users || []).find(u => u.user_id === accountRegistryId(approved));
        if (proxyUser?.token) {
          const t = proxyUser.token;
          maskedToken = t.slice(0, 6) + '····' + t.slice(-4);
          expiresAt = proxyUser.expires_at;
          role = proxyUser.role;
        }
      } catch (_) {}
      const tier = approved.tier || role;
      if (!maskedToken || !expiresAt || !role) {
        return res.json({
          success: true,
          status: 'sync_pending',
          message: '账户正在同步到数据服务；请稍后重新查询。'
        });
      }
    return res.json({
      success: true,
      status: 'approved',
      message: '账户已开通。',
      token: maskedToken,
      expiry: expiresAt,
      role,
      tier,
      current_plan: publicPlan(tier)
    });
  }

  const pending = readJSON(PENDING_FILE);
  const entry = pending.find(p => sameAccountIdentity(p, identity));
  if (!entry) {
    return res.json({ success: true, status: 'not_found', message: '未找到注册记录。' });
  }
  if (entry.status === 'payment_pending') {
    return res.json({
      success: true,
      status: 'free_registration_available',
      message: '旧版未完成支付申请不会占用此账户组合。请重新提交 Free 注册；付费升级请在账户管理中完成。'
    });
  }

  const result = {
    success: true,
    status: entry.status,
    message: entry.status === 'pending'
        ? '审核中，请耐心等待。'
        : entry.status === 'rejected'
          ? (entry.reject_reason || '审核未通过，请联系卖家。')
          : '已通过！'
  };

  // If approved, look up token + expiry from proxy users.json
  if (entry.status === 'approved') {
    try {
      const proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
      const proxyUser = (proxyData.users || []).find(u => u.user_id === accountRegistryId(entry));
      if (proxyUser?.token) {
        const t = proxyUser.token;
        result.token = t.slice(0, 6) + '····' + t.slice(-4);
        result.expiry = proxyUser.expires_at;
        result.role = proxyUser.role;
        result.tier = entry.tier || proxyUser.role;
        result.current_plan = publicPlan(result.tier);
      }
    } catch (_) {}
  }

  return res.json(result);
});

// ============================================================
// ADMIN: Login
// ============================================================
app.post('/api/admin/login', (req, res) => {
  const adminPassword = configuredAdminPassword();
  if (!adminPassword) {
    return res.status(503).json({
      success: false,
      error: 'admin_not_configured',
      message: 'Admin authentication is not configured on this host.'
    });
  }
  const { password } = req.body;
  if (password !== adminPassword) {
    return res.status(401).json({ success: false, message: '密码错误。' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.add(token);
  return res.json({ success: true, token });
});

// ============================================================
// ADMIN: Registration email template
// ============================================================
app.get('/api/admin/email-template', requireAdmin, (_req, res) => {
  const template = readEmailTemplate();
  return res.json({
    success: true,
    template,
    placeholders: EMAIL_TEMPLATE_PLACEHOLDERS.map(name => `{{${name}}}`),
    preview: emailTemplatePreview(template)
  });
});

app.put('/api/admin/email-template', requireAdmin, (req, res) => {
  const validated = validateEmailTemplate(req.body || {});
  if (validated.error) {
    return res.status(400).json({ success: false, message: validated.error });
  }
  const saved = {
    ...validated.template,
    updated_at: new Date().toISOString()
  };
  writeJSONAtomic(EMAIL_TEMPLATE_FILE, saved);
  return res.json({
    success: true,
    message: '注册验证码邮件模板已保存。',
    template: saved,
    preview: emailTemplatePreview(saved)
  });
});

// ============================================================
// ADMIN: List pending registrations
// ============================================================
app.get('/api/admin/pending', requireAdmin, (req, res) => {
  const pending = readJSON(PENDING_FILE);
  return res.json({ success: true, items: pending.filter(p => p.status === 'pending') });
});

// ============================================================
// ADMIN: List all registrations (pending + approved + rejected)
// ============================================================
app.get('/api/admin/all', requireAdmin, (req, res) => {
  const pending = readJSON(PENDING_FILE);
  const users = readJSON(USERS_FILE);

  const all = [
    ...pending.map(p => ({ ...p, source: 'pending' })),
    ...users.map(u => ({
      username: u.username,
      phone: u.phone,
      ...(u.email && { email: u.email }),
      tier: u.role,
      status: 'approved',
      source: 'users'
    }))
  ];

  return res.json({ success: true, items: all });
});

// ============================================================
// ADMIN: Approve a registration
// ============================================================
app.post('/api/admin/approve', requireAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, message: 'Missing id.' });

  const pending = readJSON(PENDING_FILE);
  const entry = pending.find(p => p.id === id && ['pending', 'payment_pending'].includes(p.status));
  if (!entry) return res.status(404).json({ success: false, message: '未找到该待审核记录。' });

  const tierConfig = TIERS[entry.tier] || TIERS.premium;
  const perms = resolvePermissions(tierConfig, entry.mode);
  const isRenewal = entry.type === 'renewal';
  const targetUserId = accountRegistryId(entry);

  const users = readJSON(USERS_FILE);
  const existingLocalUser = users.find(user => accountRegistryId(user) === targetUserId);
  const persistApproval = () => {
    const filtered = users.filter(user => accountRegistryId(user) !== targetUserId);
    filtered.push({
      username: entry.username,
      phone: entry.phone || existingLocalUser?.phone,
      email: entry.email || existingLocalUser?.email,
      account_id: targetUserId,
      role: tierConfig.role,
      tier: entry.tier,
      ...(entry.mode && { mode: entry.mode }),
      permissions: perms
    });
    writeJSON(USERS_FILE, filtered);
    entry.status = 'approved';
    entry.approved_at = new Date().toISOString();
    delete entry.checkout_token_hash;
    writeJSON(PENDING_FILE, pending);
  };

  // Update the shared auth registry first. A renewal must preserve the existing
  // token and fails closed if that token disappeared before admin approval.
  try {
    var proxyData = { users: [] };
    if (fs.existsSync(PROXY_USERS_FILE)) {
      proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    }
    if (!proxyData.users) proxyData.users = [];

    const existing = proxyData.users.find(u => u.user_id === targetUserId);
    if (isRenewal && (!existing || !existing.token)) {
      return res.status(409).json({
        success: false,
        message: '续费账户的现有 Token 已不存在，申请保持待审核；请先恢复原账户。'
      });
    }

    if (existing) {
      existing.role = tierConfig.role;
      existing.permissions = perms;
      if (entry.email) existing.email = entry.email;
      existing.expires_at = isRenewal
        ? computeRenewalExpiry(existing.expires_at, entry.renew_days || tierConfig.expiryDays || 30)
        : (existing.expires_at || computeExpiry(tierConfig));
      if (entry.tier === 'test') existing.test_user = true;
      else delete existing.test_user;

      const syncResult = await writeProxyUsersAndSyncAsync(proxyData);
      if (!syncResult.ok) {
        return res.status(500).json({
          success: false,
          message: `数据服务注册表更新失败，申请保持待审核: ${syncResult.message}`
        });
      }
      persistApproval();
      const action = isRenewal ? '续费已批准并延长有效期' : '已批准，Token 已存在并更新套餐';
      return res.json({
        success: true,
        message: `${action}：${entry.username}，已同步到数据服务。`,
        token: existing.token,
        expiry: existing.expires_at,
        role: existing.role
      });
    }

    const token = crypto.randomUUID();
    const expiresAt = computeExpiry(tierConfig);

    proxyData.users = proxyData.users.filter(u => u.user_id !== targetUserId);
    proxyData.users.push({
      token,
      user_id: targetUserId,
      role: tierConfig.role,
      expires_at: expiresAt,
      permissions: perms,
      ...(entry.email && { email: entry.email }),
      ...(entry.tier === 'test' && { test_user: true })
    });

    const syncResult = await writeProxyUsersAndSyncAsync(proxyData);
    if (!syncResult.ok) {
      return res.status(500).json({
        success: false,
        message: `数据服务注册表更新失败，申请保持待审核: ${syncResult.message}`
      });
    }
    persistApproval();

    return res.json({
      success: true,
      message: `已批准 ${entry.username}，Token 已注册并同步到数据服务。`,
      token,
      expiry: expiresAt,
      role: tierConfig.role
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: `数据服务注册表更新失败，申请保持待审核: ${err.message}`
    });
  }
});

// ============================================================
// ADMIN: User email announcements
// ============================================================
// Recipients come from the shared registry's optional `email` field. Expired,
// test, and service accounts are skipped by default. SMTP credentials are
// injected through host-only environment variables and are never logged.
const ANNOUNCE_LOG_FILE = path.join(DATA_DIR, 'announce-log.jsonl');
const ANNOUNCE_SMTP_ENV_FILE = process.env.ANNOUNCE_SMTP_ENV_FILE
  || path.join(DATA_DIR, 'announce-smtp.env');
const ANNOUNCE_TEST_ID_RE = /^(perftest_|smoke_|debug_|oracle_test_)/;
const ANNOUNCE_SERVICE_IDS = new Set(['lean-live']);
const ANNOUNCE_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ANNOUNCE_MAX_SUBJECT_LENGTH = 200;
const ANNOUNCE_MAX_BODY_LENGTH = 100_000;
const ANNOUNCE_MAX_MANUAL_RECIPIENTS = 500;
const ANNOUNCE_MAX_RECIPIENT_NAME_LENGTH = 120;
const DEFAULT_ANNOUNCE_FROM_NAME = '恺 Kai · leandata.uk';
const DEFAULT_ANNOUNCE_TEMPLATE = `Hi {user_id},

I’m writing to let you know about an update to leandata.uk.

What changed
------------
<Write one concise sentence describing the update.>

What this means for you
-----------------------
<Explain the user-visible impact, including affected endpoints or data coverage.>

Do you need to do anything?
---------------------------
<State “No action is needed” or give exact, minimal steps.>

Your current account role is {role}, and your access is valid through
{expires_date}. Unless stated above, your token, permissions, and existing
integration remain unchanged.

你好，{user_id}：

想和你同步一项 leandata.uk 更新。

更新内容
--------
<用一句简洁的话说明本次更新。>

对你的影响
----------
<说明用户可感知的变化，包括受影响的接口或数据覆盖。>

是否需要操作
------------
<明确写“无需任何操作”，或给出准确且最少的操作步骤。>

你当前的账户角色是 {role}，访问有效期至 {expires_date}。除非上文另有说明，
你的 Token、权限和现有接入方式均保持不变。

If you have any questions or notice an issue, simply reply to this email.
如有问题或发现异常，直接回复这封邮件即可。

Best,
恺 Kai
leandata.uk`;

function resolveAnnounceRecipients(options = {}) {
  const { includeExpired = false, includeTest = false, includeService = false } = options;
  const proxyData = readJSON(PROXY_USERS_FILE, { users: [] });
  const now = Date.now();
  const reachable = [];
  const skipped = [];

  for (const user of proxyData.users || []) {
    const userId = String(user.user_id || '');
    if (!userId) continue;

    const entry = {
      user_id: userId,
      role: user.role || 'default',
      expires_at: user.expires_at || null
    };

    let reason = null;
    if (ANNOUNCE_SERVICE_IDS.has(userId) && !includeService) reason = 'service_principal';
    else if ((user.test_user || ANNOUNCE_TEST_ID_RE.test(userId)) && !includeTest) reason = 'test_user';
    else if (
      user.expires_at
      && !Number.isNaN(Date.parse(user.expires_at))
      && Date.parse(user.expires_at) <= now
      && !includeExpired
    ) reason = 'expired';

    if (reason) {
      skipped.push({ ...entry, reason });
      continue;
    }

    const email = typeof user.email === 'string' ? user.email.trim() : '';
    if (!email) {
      skipped.push({ ...entry, reason: 'no_email' });
      continue;
    }
    if (!ANNOUNCE_EMAIL_RE.test(email)) {
      skipped.push({ ...entry, reason: 'invalid_email' });
      continue;
    }
    reachable.push({ ...entry, email });
  }

  return { reachable, skipped };
}

function renderAnnounceBody(template, user) {
  const expiry = (user.expires_at || '').slice(0, 10) || 'n/a';
  return String(template)
    .replaceAll('{user_id}', user.user_id)
    .replaceAll('{role}', user.role || '')
    .replaceAll('{expires_date}', expiry);
}

function announceRecipientSnapshot(recipients) {
  const stable = recipients
    .map(({ source, user_id, email, role, expires_at }) => ({
      source: source || 'registry',
      user_id,
      email,
      role,
      expires_at
    }))
    .sort((a, b) => (
      a.email.toLowerCase().localeCompare(b.email.toLowerCase())
      || a.user_id.localeCompare(b.user_id)
    ));
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function resolveAnnounceSelection(input = {}) {
  // Announcements may target expired human accounts when they still have a
  // valid email address. Test accounts and service principals remain excluded.
  const registry = resolveAnnounceRecipients({ includeExpired: true });
  const reachableById = new Map(registry.reachable.map(user => [user.user_id, user]));
  const skippedById = new Map(registry.skipped.map(user => [user.user_id, user]));
  const hasExplicitSelection = Object.prototype.hasOwnProperty.call(input, 'selected_user_ids');
  const rawSelectedIds = hasExplicitSelection ? input.selected_user_ids : registry.reachable.map(user => user.user_id);

  if (!Array.isArray(rawSelectedIds)) {
    return { error: 'selected_user_ids must be an array of user IDs.' };
  }
  if (rawSelectedIds.length > 10_000) {
    return { error: 'selected_user_ids contains too many entries.' };
  }

  const selectedIds = [];
  const selectedIdSet = new Set();
  for (const rawUserId of rawSelectedIds) {
    if (typeof rawUserId !== 'string' || !rawUserId.trim()) {
      return { error: 'selected_user_ids must contain only non-empty strings.' };
    }
    const userId = rawUserId.trim();
    if (!selectedIdSet.has(userId)) {
      selectedIdSet.add(userId);
      selectedIds.push(userId);
    }
  }

  const invalidSelections = [];
  const selectedRegistry = [];
  for (const userId of selectedIds) {
    const reachable = reachableById.get(userId);
    if (reachable) {
      selectedRegistry.push({ ...reachable, source: 'registry' });
      continue;
    }
    const skipped = skippedById.get(userId);
    invalidSelections.push({
      user_id: userId,
      reason: skipped?.reason || 'unknown_user'
    });
  }
  if (invalidSelections.length) {
    return {
      error: 'One or more selected registry users are unknown or ineligible.',
      errorCode: 'invalid_selected_users',
      invalidSelections
    };
  }

  const rawManual = input.manual_recipients === undefined ? [] : input.manual_recipients;
  if (!Array.isArray(rawManual)) {
    return { error: 'manual_recipients must be an array.' };
  }
  if (rawManual.length > ANNOUNCE_MAX_MANUAL_RECIPIENTS) {
    return {
      error: `manual_recipients must contain at most ${ANNOUNCE_MAX_MANUAL_RECIPIENTS} entries.`
    };
  }

  const manual = [];
  for (let index = 0; index < rawManual.length; index++) {
    const item = rawManual[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: `manual_recipients[${index}] must be an object.` };
    }
    const email = typeof item.email === 'string' ? item.email.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!ANNOUNCE_EMAIL_RE.test(email)) {
      return { error: `manual_recipients[${index}] has an invalid email address.` };
    }
    if (/[\r\n]/.test(name)) {
      return { error: `manual_recipients[${index}].name must be a single line.` };
    }
    if (name.length > ANNOUNCE_MAX_RECIPIENT_NAME_LENGTH) {
      return {
        error: `manual_recipients[${index}].name must be at most ${ANNOUNCE_MAX_RECIPIENT_NAME_LENGTH} characters.`
      };
    }
    manual.push({
      source: 'manual',
      user_id: name || email,
      name: name || null,
      email,
      role: 'manual',
      expires_at: null
    });
  }

  // A selected registry row is authoritative for its email. Manual duplicates
  // and repeated manual addresses are ignored case-insensitively.
  const recipients = [];
  const duplicateRecipients = [];
  const seenEmails = new Map();
  for (const recipient of [...selectedRegistry, ...manual]) {
    const emailKey = recipient.email.toLowerCase();
    const existing = seenEmails.get(emailKey);
    if (existing) {
      duplicateRecipients.push({
        source: recipient.source,
        user_id: recipient.user_id,
        email: recipient.email,
        reason: 'duplicate_email',
        kept_user_id: existing.user_id
      });
      continue;
    }
    seenEmails.set(emailKey, recipient);
    recipients.push(recipient);
  }

  return {
    recipients,
    skipped: registry.skipped,
    duplicateRecipients,
    selected_user_ids: selectedIds,
    manual_recipients: manual.map(({ email, name }) => ({ email, name }))
  };
}

function validateAnnounceInput(subject, body) {
  if (!subject || !body) return 'subject and body are required.';
  if (/[\r\n]/.test(subject)) return 'subject must be a single line.';
  if (subject.length > ANNOUNCE_MAX_SUBJECT_LENGTH) {
    return `subject must be at most ${ANNOUNCE_MAX_SUBJECT_LENGTH} characters.`;
  }
  if (body.length > ANNOUNCE_MAX_BODY_LENGTH) {
    return `body must be at most ${ANNOUNCE_MAX_BODY_LENGTH} characters.`;
  }
  return null;
}

function loadAnnounceSmtpEnvFile() {
  try {
    const stat = fs.statSync(ANNOUNCE_SMTP_ENV_FILE);
    if ((stat.mode & 0o077) !== 0) return {};

    const values = {};
    for (const rawLine of fs.readFileSync(ANNOUNCE_SMTP_ENV_FILE, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const splitAt = line.indexOf('=');
      const key = line.slice(0, splitAt).trim();
      let value = line.slice(splitAt + 1).trim();
      if (
        value.length >= 2
        && ((value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'")))
      ) value = value.slice(1, -1);
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function announceSmtpConfig() {
  const fileEnv = loadAnnounceSmtpEnvFile();
  const SMTP_HOST = process.env.SMTP_HOST || fileEnv.SMTP_HOST;
  const SMTP_PORT = process.env.SMTP_PORT || fileEnv.SMTP_PORT;
  const SMTP_USER = process.env.SMTP_USER || fileEnv.SMTP_USER;
  const SMTP_PASSWORD = process.env.SMTP_PASSWORD || fileEnv.SMTP_PASSWORD;
  const MAIL_FROM = process.env.MAIL_FROM || fileEnv.MAIL_FROM;
  const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || fileEnv.MAIL_FROM_NAME;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) return null;

  const port = Number(SMTP_PORT || 465);
  const from = MAIL_FROM || SMTP_USER;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !ANNOUNCE_EMAIL_RE.test(from)) return null;

  return {
    host: SMTP_HOST,
    port,
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    from,
    fromName: MAIL_FROM_NAME || DEFAULT_ANNOUNCE_FROM_NAME
  };
}

function smtpResponse(socket, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('SMTP response timed out.'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('SMTP connection closed unexpectedly.'));
    };
    const onData = chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      const complete = lines.find(line => /^\d{3} /.test(line));
      if (!complete) return;
      cleanup();
      resolve({
        code: Number(complete.slice(0, 3)),
        message: lines.filter(Boolean).join('\n')
      });
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
  });
}

async function smtpCommand(socket, command, expectedCodes) {
  const pending = smtpResponse(socket);
  socket.write(`${command}\r\n`);
  const response = await pending;
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP command failed (${response.code}): ${response.message.slice(0, 300)}`);
  }
  return response;
}

function openTcpSocket(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function openTlsSocket(options) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ ...options, rejectUnauthorized: true });
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function encodeMailHeader(value) {
  const text = String(value || '');
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function wrapBase64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
}

function buildSmtpMessage({ from, fromName, to, subject, text, html }) {
  const fromHeader = fromName ? `${encodeMailHeader(fromName)} <${from}>` : from;
  if (html) {
    const boundary = `=_leandata_${crypto.randomBytes(12).toString('hex')}`;
    return [
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Subject: ${encodeMailHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@leandata.uk>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(text),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(html),
      `--${boundary}--`
    ].join('\r\n');
  }
  return [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encodeMailHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@leandata.uk>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(text)
  ].join('\r\n');
}

async function sendSmtpMail({ config, to, subject, text, html }) {
  let socket;
  try {
    if (config.port === 465) {
      socket = await openTlsSocket({ host: config.host, port: config.port, servername: config.host });
      const greeting = await smtpResponse(socket);
      if (greeting.code !== 220) throw new Error(`SMTP greeting failed (${greeting.code}).`);
    } else {
      socket = await openTcpSocket(config.host, config.port);
      const greeting = await smtpResponse(socket);
      if (greeting.code !== 220) throw new Error(`SMTP greeting failed (${greeting.code}).`);
      await smtpCommand(socket, 'EHLO leandata.uk', [250]);
      await smtpCommand(socket, 'STARTTLS', [220]);
      socket = await openTlsSocket({ socket, servername: config.host });
    }

    await smtpCommand(socket, 'EHLO leandata.uk', [250]);
    const auth = Buffer.from(`\0${config.user}\0${config.password}`, 'utf8').toString('base64');
    await smtpCommand(socket, `AUTH PLAIN ${auth}`, [235]);
    await smtpCommand(socket, `MAIL FROM:<${config.from}>`, [250]);
    await smtpCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await smtpCommand(socket, 'DATA', [354]);

    const message = buildSmtpMessage({
      from: config.from,
      fromName: config.fromName,
      to,
      subject,
      text,
      html
    });
    const dotStuffed = message
      .split('\r\n')
      .map(line => line.startsWith('.') ? `.${line}` : line)
      .join('\r\n');
    const accepted = smtpResponse(socket);
    socket.write(`${dotStuffed}\r\n.\r\n`);
    const response = await accepted;
    if (response.code !== 250) {
      throw new Error(`SMTP message rejected (${response.code}): ${response.message.slice(0, 300)}`);
    }

    try {
      await smtpCommand(socket, 'QUIT', [221]);
    } catch {
      // The message was already accepted; a dropped QUIT response is harmless.
    }
  } finally {
    socket?.destroy();
  }
}

function appendAnnounceLog(record) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(
      ANNOUNCE_LOG_FILE,
      JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n',
      { mode: 0o600 }
    );
    fs.chmodSync(ANNOUNCE_LOG_FILE, 0o600);
  } catch (err) {
    console.error('announce log write failed:', err.message);
  }
}

app.get('/api/admin/announce/template', requireAdmin, (_req, res) => {
  const cfg = announceSmtpConfig();
  return res.json({
    success: true,
    subject: 'leandata.uk 更新 / Service update',
    body: DEFAULT_ANNOUNCE_TEMPLATE,
    from_name: cfg?.fromName || DEFAULT_ANNOUNCE_FROM_NAME,
    placeholders: ['{user_id}', '{role}', '{expires_date}']
  });
});

app.get('/api/admin/announce/recipients', requireAdmin, (req, res) => {
  const { reachable, skipped } = resolveAnnounceRecipients({
    includeExpired: req.query.include_expired !== '0',
    includeTest: req.query.include_test === '1',
    includeService: req.query.include_service === '1'
  });
  return res.json({
    success: true,
    reachable,
    skipped,
    recipient_snapshot: announceRecipientSnapshot(reachable),
    smtp_configured: Boolean(announceSmtpConfig())
  });
});

app.post('/api/admin/announce/send', requireAdmin, async (req, res) => {
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const body = typeof req.body?.body === 'string'
    ? req.body.body.replaceAll('\r\n', '\n').trim()
    : '';
  const testTo = typeof req.body?.test_to === 'string' ? req.body.test_to.trim() : '';
  const confirm = req.body?.confirm === true;
  const validationError = validateAnnounceInput(subject, body);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const selection = resolveAnnounceSelection(req.body || {});
  if (selection.error) {
    return res.status(400).json({
      success: false,
      error: selection.errorCode || 'invalid_recipient_selection',
      message: selection.error,
      invalid_selections: selection.invalidSelections || []
    });
  }
  const {
    recipients,
    skipped,
    duplicateRecipients,
    selected_user_ids: selectedUserIds,
    manual_recipients: manualRecipients
  } = selection;
  const recipientSnapshot = announceRecipientSnapshot(recipients);

  // Dry run by default: report exactly what would be sent and send nothing.
  if (!testTo && !confirm) {
    if (!recipients.length) {
      return res.status(422).json({
        success: false,
        error: 'no_recipients',
        message: 'Select at least one eligible registry user or add a manual email address.',
        skipped,
        duplicate_recipients: duplicateRecipients
      });
    }
    return res.json({
      success: true,
      dry_run: true,
      reachable: recipients,
      skipped,
      duplicate_recipients: duplicateRecipients,
      selected_user_ids: selectedUserIds,
      manual_recipients: manualRecipients,
      recipient_snapshot: recipientSnapshot,
      sample: recipients.length
        ? { to: recipients[0].email, text: renderAnnounceBody(body, recipients[0]) }
        : null
    });
  }

  const cfg = announceSmtpConfig();
  if (!cfg) {
    return res.status(503).json({
      success: false,
      error: 'announce_not_configured',
      message: 'SMTP environment is not configured on this host.'
    });
  }

  const sendMail = app.locals.announceSendMail || sendSmtpMail;

  if (testTo) {
    if (!ANNOUNCE_EMAIL_RE.test(testTo)) {
      return res.status(400).json({ success: false, message: 'invalid test_to address.' });
    }
    const previewUser = recipients[0] || { user_id: 'preview', role: '', expires_at: null };
    const results = [];
    try {
      await sendMail({
        config: cfg,
        to: testTo,
        subject,
        text: renderAnnounceBody(body, previewUser)
      });
      results.push({ email: testTo, status: 'sent' });
    } catch (err) {
      results.push({
        email: testTo,
        status: 'failed',
        error: String(err.message || err).slice(0, 200)
      });
    }
    appendAnnounceLog({
      subject,
      test_to: testTo,
      recipient_snapshot: recipientSnapshot,
      results
    });
    return res.json({
      success: results[0].status === 'sent',
      test_to: testTo,
      results,
      reachable_count: recipients.length,
      recipient_snapshot: recipientSnapshot
    });
  }

  if (!recipients.length) {
    return res.status(422).json({
      success: false,
      error: 'no_recipients',
      skipped,
      duplicate_recipients: duplicateRecipients
    });
  }
  if (req.body?.recipient_snapshot !== recipientSnapshot) {
    return res.status(409).json({
      success: false,
      error: 'recipient_snapshot_changed',
      message: 'Recipients changed or were not previewed. Run a dry preview again before sending.',
      recipient_snapshot: recipientSnapshot,
      reachable: recipients,
      skipped,
      duplicate_recipients: duplicateRecipients
    });
  }

  const results = [];
  for (const recipient of recipients) {
    try {
      await sendMail({
        config: cfg,
        to: recipient.email,
        subject,
        text: renderAnnounceBody(body, recipient)
      });
      results.push({
        source: recipient.source,
        user_id: recipient.user_id,
        email: recipient.email,
        status: 'sent'
      });
    } catch (err) {
      results.push({
        source: recipient.source,
        user_id: recipient.user_id,
        email: recipient.email,
        status: 'failed',
        error: String(err.message || err).slice(0, 200)
      });
    }
  }

  appendAnnounceLog({
    subject,
    recipient_snapshot: recipientSnapshot,
    selected_user_ids: selectedUserIds,
    manual_recipient_count: manualRecipients.length,
    results
  });
  const failures = results.filter(result => result.status !== 'sent').length;
  return res.json({
    success: failures === 0,
    results,
    skipped,
    duplicate_recipients: duplicateRecipients,
    failures
  });
});

// ============================================================
// ADMIN: Reject a registration
// ============================================================
app.post('/api/admin/reject', requireAdmin, (req, res) => {
  const { id, reason } = req.body;
  if (!id) return res.status(400).json({ success: false, message: 'Missing id.' });

  const pending = readJSON(PENDING_FILE);
  const entry = pending.find(p => p.id === id && p.status === 'pending');
  if (!entry) return res.status(404).json({ success: false, message: '未找到该待审核记录。' });

  entry.status = 'rejected';
  entry.reject_reason = reason || '审核未通过';
  entry.rejected_at = new Date().toISOString();
  writeJSON(PENDING_FILE, pending);

  return res.json({ success: true, message: `已拒绝 ${entry.username}。` });
});

// ============================================================
// ADMIN: Delete a user from all registries (local + shared proxy registry)
// ============================================================
app.post('/api/admin/delete-user', requireAdmin, async (req, res) => {
  const accountId = String(req.body?.account_id || '').trim();
  if (!accountId) {
    return res.status(400).json({
      success: false,
      message: 'Missing account_id. Deletion must target one exact account.'
    });
  }

  const logs = [];

  // 1. Remove from local approved users
  const users = readJSON(USERS_FILE);
  const userIdx = users.findIndex(user => accountRegistryId(user) === accountId);
  if (userIdx >= 0) {
    users.splice(userIdx, 1);
    writeJSON(USERS_FILE, users);
    logs.push(`Removed from local users.json`);
  }

  // 2. Remove from pending
  const pending = readJSON(PENDING_FILE);
  const pendIdx = pending.findIndex(entry => accountRegistryId(entry) === accountId);
  if (pendIdx >= 0) {
    pending.splice(pendIdx, 1);
    writeJSON(PENDING_FILE, pending);
    logs.push(`Removed from pending.json`);
  }

  // 3. Remove from shared proxy users file.
  try {
    let proxyData = { users: [] };
    if (fs.existsSync(PROXY_USERS_FILE)) {
      proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    }
    const before = (proxyData.users || []).length;
    proxyData.users = (proxyData.users || []).filter(user => user.user_id !== accountId);
    const after = proxyData.users.length;

    if (before > after) {
      const syncResult = await writeProxyUsersAndSyncAsync(proxyData);
      logs.push(`Removed from proxy registry (${before}→${after} users)`);
      logs.push(syncResult.ok ? 'local proxy registry updated' : `proxy registry update failed: ${syncResult.message}`);
    } else {
      logs.push('Not found in proxy registry');
    }
  } catch (err) {
    logs.push(`Proxy registry error: ${err.message}`);
  }

  if (logs.length === 0) {
    return res.status(404).json({ success: false, message: `Account "${accountId}" not found in any registry.` });
  }

  return res.json({ success: true, message: `Deleted account "${accountId}".`, logs });
});

// ============================================================
// ADMIN: Verify registry — compare local approved users with shared proxy users.
// ============================================================
app.get('/api/admin/sync-verify', requireAdmin, async (req, res) => {
  const result = { tc: null, ec2: null, match: false, missingOnEC2: [], extraOnEC2: [] };

  // 1. Read TC proxy users (local file)
  try {
    const tcData = readJSON(PROXY_USERS_FILE, { users: [] });
    result.tc = (tcData.users || []).map(u => u.user_id).sort();
  } catch (err) {
    return res.json({ success: false, message: `Cannot read TC proxy file: ${err.message}` });
  }

  // 2. Legacy remote check, normally disabled on Aliyun.
  if (process.env.BYPASS_SYNC === 'true') {
    return res.json({ success: true, ...result, message: 'Remote check skipped (BYPASS_SYNC=true)' });
  }

  try {
    const ec2Data = await new Promise((resolve, reject) => {
      execFile('ssh', [
        '-i', EC2_SSH_KEY,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        EC2_HOST,
        `cat ${EC2_USERS_PATH}`
      ], { timeout: 20000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(JSON.parse(stdout));
      });
    });
    result.ec2 = (ec2Data.users || []).map(u => u.user_id).sort();
  } catch (err) {
    return res.json({ success: false, tc: result.tc, message: `Remote SSH failed: ${err.message}` });
  }

  // 3. Diff
  result.missingOnEC2 = result.tc.filter(u => !result.ec2.includes(u));
  result.extraOnEC2 = result.ec2.filter(u => !result.tc.includes(u));
  result.match = result.missingOnEC2.length === 0 && result.extraOnEC2.length === 0;

  return res.json({
    success: true,
    match: result.match,
    tcCount: result.tc.length,
    ec2Count: result.ec2.length,
    missingOnEC2: result.missingOnEC2,
    extraOnEC2: result.extraOnEC2
  });
});

// ============================================================
// ADMIN: Force reload shared users.json
// ============================================================
app.post('/api/admin/sync-users', requireAdmin, async (req, res) => {
  const logs = [];
  const log = (msg) => { logs.push(`[${new Date().toISOString()}] ${msg}`); };

  // 1. Read current proxy users.json
  let proxyData;
  try {
    proxyData = readJSON(PROXY_USERS_FILE, { users: [] });
    const count = (proxyData.users || []).length;
    log(`Read ${count} users from proxy registry`);
  } catch (err) {
    log(`ERROR reading proxy users: ${err.message}`);
    return res.json({ success: false, logs });
  }

  // 2. REST and WS proxy services mount the same users.json locally.
  log('Reloading shared users.json (REST and WS services read the same file)...');
  const syncResult = await syncToEC2Async();
  log(syncResult.ok ? '✓ ' + syncResult.message : '✗ ' + syncResult.message);

  return res.json({
    success: syncResult.ok,
    userCount: (proxyData.users || []).length,
    logs
  });
});

// ============================================================
// ADMIN: Usage monitoring (per-user request/WS usage from the
// shared REST+WS usage.jsonl log; read-only, never exposes tokens)
// ============================================================

const USAGE_LOG_PATH = () => process.env.USAGE_LOG_PATH
  || '/var/log/leandata-v2/usage.jsonl';
const USAGE_RETENTION_DAYS = 35;
const USAGE_REFRESH_MIN_INTERVAL_MS = 15000;
const USAGE_MAX_ROUTES_PER_USER = 128;
const USAGE_MAX_RECENT_EVENTS = 5000;
const USAGE_MAX_PARTIAL_LINE_BYTES = 1024 * 1024;
const ACCESS_LOG_DIR = () => process.env.ACCESS_LOG_DIR
  || '/var/log/leandata-v2/access';
const ATTRIBUTION_DEFAULT_LINES = 5000;
const ATTRIBUTION_MAX_LINES = 20000;
const ATTRIBUTION_MAX_BYTES_PER_SOURCE = 4 * 1024 * 1024;
const ATTRIBUTION_MAX_RECENT_EVENTS = 50;
const ATTRIBUTION_SCHEMA = 'request_attribution_v2';
const ATTRIBUTION_GEO_MAX_LOOKUPS = 20;
const ATTRIBUTION_GEO_LOOKUP_TIMEOUT_MS = 2500;
const ATTRIBUTION_GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ATTRIBUTION_GEO_FAILURE_TTL_MS = 60 * 60 * 1000;
const attributionGeoCache = new Map();

function usageDayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function utcDayStartMs(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function usageRetentionStartMs(nowMs = Date.now()) {
  return utcDayStartMs(nowMs) - (USAGE_RETENTION_DAYS - 1) * 86400000;
}

function usageWindowStartDay(nowMs, days) {
  return usageDayKey(utcDayStartMs(nowMs) - (days - 1) * 86400000);
}

function compactUsageEvent(entry, eventMs) {
  return {
    user_id: entry.user_id || 'anonymous',
    t: entry.timestamp,
    m: eventMs,
    ev: entry.event,
    route: entry.route || undefined,
    mode: entry.mode || undefined,
    status: entry.status,
    b_out: entry.bytes_out_hint || 0
  };
}

function createUsageUserState() {
  return {
    lastSeenMs: 0,
    dailyEvents: new Map(),
    roles: new Map(),
    dailyHttp: new Map(),
    dailyBytesOut: new Map(),
    dailyErrors: new Map(),
    dailyWsSessions: new Map(),
    routes: new Map()
  };
}

const usageAggregator = (() => {
  let state = null; // { offset, inode, users: Map, recentEvents: Array }
  let refreshCompletedAt = 0;
  let refreshPromise = null;
  let testHooks = null;

  function parseTimestamp(value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }

  function addDayValue(map, day, value) {
    map.set(day, (map.get(day) || 0) + value);
  }

  function addNestedDayValue(map, key, day, value) {
    let buckets = map.get(key);
    if (!buckets) {
      buckets = new Map();
      map.set(key, buckets);
    }
    addDayValue(buckets, day, value);
  }

  function nestedTotal(buckets) {
    let total = 0;
    for (const value of buckets.values()) total += value;
    return total;
  }

  function evictLeastUsedRoute(routes) {
    let leastRoute = null;
    let leastCount = Infinity;
    for (const [route, buckets] of routes) {
      const count = nestedTotal(buckets);
      if (count < leastCount || (count === leastCount && (leastRoute === null || route < leastRoute))) {
        leastRoute = route;
        leastCount = count;
      }
    }
    if (leastRoute !== null) routes.delete(leastRoute);
  }

  function addUserEvent(users, entry, eventMs) {
    const userId = entry.user_id || 'anonymous';
    let user = users.get(userId);
    if (!user) {
      user = createUsageUserState();
      users.set(userId, user);
    }
    const day = usageDayKey(new Date(eventMs));
    const isHttp = entry.event === 'http_request';
    const isWsSession = entry.event === 'ws_session';
    const bytesOut = Number(entry.bytes_out_hint) || 0;
    const isError = typeof entry.status === 'number' && entry.status >= 400;

    const activity = user.dailyEvents.get(day) || { events: 0, firstMs: eventMs, lastMs: eventMs };
    activity.events += 1;
    activity.firstMs = Math.min(activity.firstMs, eventMs);
    activity.lastMs = Math.max(activity.lastMs, eventMs);
    user.dailyEvents.set(day, activity);

    const role = entry.user_role || 'unknown';
    if (role !== 'unknown') addNestedDayValue(user.roles, role, day, 1);
    if (eventMs > user.lastSeenMs) user.lastSeenMs = eventMs;
    addDayValue(user.dailyBytesOut, day, bytesOut);

    if (isHttp) {
      addDayValue(user.dailyHttp, day, 1);
      if (isError) addDayValue(user.dailyErrors, day, 1);
      const route = String(entry.route || 'unknown');
      if (!user.routes.has(route) && user.routes.size >= USAGE_MAX_ROUTES_PER_USER) {
        evictLeastUsedRoute(user.routes);
      }
      addNestedDayValue(user.routes, route, day, 1);
    } else if (isWsSession) {
      addDayValue(user.dailyWsSessions, day, 1);
    }
  }

  function ingestLine(line, users, nowMs) {
    const trimmed = line.toString('utf8').trim();
    if (!trimmed) return null;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      return { parseError: true };
    }
    if (!entry || typeof entry !== 'object') return { parseError: true };
    const eventMs = parseTimestamp(entry.timestamp);
    if (!eventMs || eventMs < usageRetentionStartMs(nowMs)) return { skippedOld: true };
    addUserEvent(users, entry, eventMs);
    return { eventMs, event: compactUsageEvent(entry, eventMs) };
  }

  async function scanSnapshot(fd, start, snapshotSize, users, recentEvents, nowMs) {
    if (start >= snapshotSize) return { offset: start, trailingFragmentBytes: 0, partialTooLarge: false };
    const stream = fs.createReadStream(null, {
      fd,
      autoClose: false,
      start,
      end: snapshotSize - 1
    });
    let pending = Buffer.alloc(0);
    let pendingStart = start;
    let partialTooLarge = false;
    for await (const chunk of stream) {
      const buffer = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let consumed = 0;
      for (let newline = buffer.indexOf(0x0a, consumed);
        newline !== -1;
        newline = buffer.indexOf(0x0a, consumed)) {
        const result = ingestLine(buffer.subarray(consumed, newline), users, nowMs);
        if (result && result.event) recentEvents.push(result.event);
        consumed = newline + 1;
      }
      pending = buffer.subarray(consumed);
      pendingStart += consumed;
      // Only newline-terminated records advance the offset. A final fragment is
      // reread after its newline arrives, never parsed or skipped at EOF.
      if (pending.length > USAGE_MAX_PARTIAL_LINE_BYTES) {
        partialTooLarge = true;
        stream.destroy();
        break;
      }
    }
    return {
      offset: pendingStart,
      trailingFragmentBytes: pending.length,
      partialTooLarge
    };
  }

  function createUsageState(inode) {
    return {
      offset: 0,
      inode,
      users: new Map(),
      recentEvents: [],
      trailingFragmentBytes: 0,
      partialTooLarge: false
    };
  }

  function pruneDayMap(map, firstDay) {
    for (const day of map.keys()) {
      if (day < firstDay) map.delete(day);
    }
  }

  function pruneNestedDayMap(map, firstDay) {
    for (const [key, buckets] of map) {
      pruneDayMap(buckets, firstDay);
      if (!buckets.size) map.delete(key);
    }
  }

  function pruneState(nowMs = Date.now()) {
    if (!state) return;
    const firstDay = usageDayKey(usageRetentionStartMs(nowMs));
    for (const [userId, user] of state.users) {
      pruneDayMap(user.dailyEvents, firstDay);
      pruneDayMap(user.dailyHttp, firstDay);
      pruneDayMap(user.dailyBytesOut, firstDay);
      pruneDayMap(user.dailyErrors, firstDay);
      pruneDayMap(user.dailyWsSessions, firstDay);
      pruneNestedDayMap(user.roles, firstDay);
      pruneNestedDayMap(user.routes, firstDay);
      if (!user.dailyEvents.size) {
        state.users.delete(userId);
        continue;
      }
      user.lastSeenMs = 0;
      for (const activity of user.dailyEvents.values()) {
        user.lastSeenMs = Math.max(user.lastSeenMs, activity.lastMs);
      }
    }
    state.recentEvents = state.recentEvents
      .filter(event => event.m >= usageRetentionStartMs(nowMs))
      .slice(-USAGE_MAX_RECENT_EVENTS);
  }

  function openUsageSnapshot(logPath) {
    const fd = fs.openSync(logPath, 'r');
    try {
      return { fd, stat: fs.fstatSync(fd) };
    } catch (err) {
      fs.closeSync(fd);
      throw err;
    }
  }

  async function fullReload(fd, stat, nowMs) {
    // A new inode or smaller file starts with fresh aggregates and coverage.
    const fresh = createUsageState(stat.ino);
    state = fresh;
    const summary = await scanSnapshot(fd, 0, stat.size, fresh.users, fresh.recentEvents, nowMs);
    fresh.offset = summary.offset;
    fresh.trailingFragmentBytes = summary.trailingFragmentBytes;
    fresh.partialTooLarge = summary.partialTooLarge;
    pruneState(nowMs);
  }

  async function refreshNow() {
    const logPath = USAGE_LOG_PATH();
    let snapshot;
    try {
      snapshot = openUsageSnapshot(logPath);
    } catch {
      state = null; // log unavailable (e.g. local dev without the mount)
      return;
    }
    try {
      if (testHooks && typeof testHooks.afterSnapshot === 'function') {
        await testHooks.afterSnapshot({ path: logPath, size: snapshot.stat.size, inode: snapshot.stat.ino });
      }
      const nowMs = Date.now();
      if (!state || state.inode !== snapshot.stat.ino || snapshot.stat.size < state.offset) {
        await fullReload(snapshot.fd, snapshot.stat, nowMs);
        return;
      }
      if (snapshot.stat.size > state.offset) {
        const summary = await scanSnapshot(
          snapshot.fd, state.offset, snapshot.stat.size, state.users, state.recentEvents, nowMs
        );
        state.offset = summary.offset;
        state.trailingFragmentBytes = summary.trailingFragmentBytes;
        state.partialTooLarge = summary.partialTooLarge;
      }
      pruneState(nowMs);

      // Appends beyond the original boundary are deliberately left for the
      // next refresh. A replacement or truncation is different: discard this
      // snapshot's aggregates and immediately rebuild from a fresh empty state.
      let currentPathStat;
      try {
        currentPathStat = fs.statSync(logPath);
      } catch {
        state = null;
        return;
      }
      if (currentPathStat.ino !== snapshot.stat.ino || currentPathStat.size < snapshot.stat.size) {
        const replacement = openUsageSnapshot(logPath);
        try {
          await fullReload(replacement.fd, replacement.stat, Date.now());
        } finally {
          fs.closeSync(replacement.fd);
        }
      }
    } finally {
      fs.closeSync(snapshot.fd);
    }
  }

  function ensureFresh(maxAgeMs = USAGE_REFRESH_MIN_INTERVAL_MS) {
    if (refreshPromise) return refreshPromise;
    const nowMs = Date.now();
    if (state && nowMs - refreshCompletedAt < maxAgeMs) {
      pruneState(nowMs);
      return Promise.resolve();
    }
    refreshPromise = refreshNow().catch((err) => {
      console.error('Usage log refresh error:', err.message);
    }).finally(() => {
      refreshCompletedAt = Date.now();
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function sumCalendarDays(map, firstDay) {
    let total = 0;
    for (const [day, value] of map) {
      if (day >= firstDay) total += value;
    }
    return total;
  }

  function activeRoles(user) {
    return [...user.roles.keys()];
  }

  function windowCounts(user, nowMs) {
    const today = usageWindowStartDay(nowMs, 1);
    const days7 = usageWindowStartDay(nowMs, 7);
    const days30 = usageWindowStartDay(nowMs, 30);
    return {
      requests_today_utc: sumCalendarDays(user.dailyHttp, today),
      requests_7d_utc: sumCalendarDays(user.dailyHttp, days7),
      requests_30d_utc: sumCalendarDays(user.dailyHttp, days30),
      ws_sessions_today_utc: sumCalendarDays(user.dailyWsSessions, today),
      ws_sessions_7d_utc: sumCalendarDays(user.dailyWsSessions, days7),
      ws_sessions_30d_utc: sumCalendarDays(user.dailyWsSessions, days30),
      bytes_out_7d_utc: sumCalendarDays(user.dailyBytesOut, days7),
      errors_7d_utc: sumCalendarDays(user.dailyErrors, days7)
    };
  }

  function publicUserRow(userId, user, nowMs) {
    return {
      user_id: userId,
      roles: activeRoles(user),
      last_seen: user.lastSeenMs ? new Date(user.lastSeenMs).toISOString() : null,
      ...windowCounts(user, nowMs)
    };
  }

  function retainedCoverage() {
    if (!state) return null;
    let firstTs = 0;
    let lastTs = 0;
    let retainedEvents = 0;
    for (const user of state.users.values()) {
      for (const activity of user.dailyEvents.values()) {
        retainedEvents += activity.events;
        if (!firstTs || activity.firstMs < firstTs) firstTs = activity.firstMs;
        if (activity.lastMs > lastTs) lastTs = activity.lastMs;
      }
    }
    return {
      first_ts: firstTs ? new Date(firstTs).toISOString() : null,
      last_ts: lastTs ? new Date(lastTs).toISOString() : null,
      retained_events: retainedEvents,
      retention_utc_calendar_days: USAGE_RETENTION_DAYS,
      trailing_fragment_bytes: state.trailingFragmentBytes,
      partial_fragment_too_large: state.partialTooLarge
    };
  }

  return {
    ensureFresh,
    isAvailable: () => Boolean(state),
    coverage: () => {
      pruneState();
      return retainedCoverage();
    },
    allUsers: () => {
      pruneState();
      return state ? state.users : new Map();
    },
    publicUsers: () => {
      const nowMs = Date.now();
      pruneState(nowMs);
      const rows = [];
      if (state) {
        for (const [userId, user] of state.users) {
          if (userId === 'anonymous') continue; // auth failures without identity
          rows.push(publicUserRow(userId, user, nowMs));
        }
      }
      rows.sort((a, b) => b.requests_7d_utc - a.requests_7d_utc
        || b.ws_sessions_7d_utc - a.ws_sessions_7d_utc
        || (b.last_seen || '').localeCompare(a.last_seen || ''));
      return rows;
    },
    totals: () => {
      const nowMs = Date.now();
      pruneState(nowMs);
      const totals = createUsageUserState();
      if (state) {
        for (const user of state.users.values()) {
          for (const [day, value] of user.dailyHttp) addDayValue(totals.dailyHttp, day, value);
          for (const [day, value] of user.dailyWsSessions) addDayValue(totals.dailyWsSessions, day, value);
          for (const [day, value] of user.dailyBytesOut) addDayValue(totals.dailyBytesOut, day, value);
          for (const [day, value] of user.dailyErrors) addDayValue(totals.dailyErrors, day, value);
        }
      }
      return publicUserRow('__total__', totals, nowMs);
    },
    userDetail: (userId) => {
      if (!state) return null;
      const nowMs = Date.now();
      pruneState(nowMs);
      const user = state.users.get(userId);
      if (!user) return null;
      const days = [];
      for (let i = 13; i >= 0; i -= 1) {
        const day = usageDayKey(utcDayStartMs(nowMs) - i * 86400000);
        days.push({
          date: day,
          http: user.dailyHttp.get(day) || 0,
          ws_sessions: user.dailyWsSessions.get(day) || 0,
          bytes_out: user.dailyBytesOut.get(day) || 0,
          errors: user.dailyErrors.get(day) || 0
        });
      }
      const routes = [...user.routes.entries()]
        .map(([route, buckets]) => ({ route, count: nestedTotal(buckets) }))
        .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route))
        .slice(0, 12)
        ;
      const recentEvents = state.recentEvents
        .filter(event => event.user_id === userId)
        .sort((a, b) => b.m - a.m)
        .slice(0, 20)
        .map(({ user_id, m, ...event }) => event);
      return {
        user_id: userId,
        roles: activeRoles(user),
        ...windowCounts(user, nowMs),
        daily_14d: days,
        top_routes: routes,
        recent_events: recentEvents
      };
    },
    __resetForTest: () => {
      state = null;
      refreshCompletedAt = 0;
      refreshPromise = null;
      testHooks = null;
    },
    __setTestHooks: (hooks) => { testHooks = hooks || null; }
  };
})();

function readRegistryUsersSafe() {
  try {
    const data = readJSON(PROXY_USERS_FILE, { users: [] });
    return Array.isArray(data.users) ? data.users : [];
  } catch {
    return [];
  }
}

function registryRoleCounts(registryUsers) {
  const counts = {};
  let expired = 0;
  const nowMs = Date.now();
  for (const user of registryUsers) {
    const role = user.role || 'unknown';
    counts[role] = (counts[role] || 0) + 1;
    const expiresMs = user.expires_at ? Date.parse(user.expires_at) : NaN;
    if (Number.isFinite(expiresMs) && expiresMs < nowMs) expired += 1;
  }
  return { counts, expired };
}

app.get('/api/admin/usage/overview', requireAdmin, async (_req, res) => {
  await usageAggregator.ensureFresh();
  const registryUsers = readRegistryUsersSafe();
  const roleInfo = registryRoleCounts(registryUsers);
  const registryById = new Map(registryUsers.map(u => [u.user_id, u]));

  // Recent registrations: approved portal accounts plus pending history.
  const portalUsers = readJSON(USERS_FILE, []);
  const pendingItems = readJSON(PENDING_FILE, []);
  const registrations = [
    ...portalUsers.map(u => ({
      username: u.username,
      account_id: u.account_id || u.username,
      phone: u.phone,
      email: u.email || undefined,
      tier: u.tier || u.role,
      registered_at: u.registered_at,
      status: 'approved',
      source: 'users'
    })),
    ...pendingItems.map(p => ({
      username: p.username,
      account_id: p.account_id || p.username,
      phone: p.phone,
      email: p.email || undefined,
      tier: p.tier,
      registered_at: p.registered_at,
      status: p.status,
      type: p.type || 'registration',
      source: 'pending'
    }))
  ];
  registrations.sort((a, b) => String(b.registered_at || '').localeCompare(String(a.registered_at || '')));
  const recentRegistrations = registrations.slice(0, 12).map(item => {
    const registryEntry = registryById.get(item.account_id);
    return {
      ...item,
      role: registryEntry ? registryEntry.role : undefined,
      expires_at: registryEntry ? registryEntry.expires_at : undefined
    };
  });

  const usageRows = usageAggregator.publicUsers();
  const nowMs = Date.now();
  const activeUsers = { today_utc: 0, last_7_utc_days: 0, last_30_utc_days: 0 };
  for (const row of usageRows) {
    if (row.requests_today_utc > 0 || row.ws_sessions_today_utc > 0) activeUsers.today_utc += 1;
    if (row.requests_7d_utc > 0 || row.ws_sessions_7d_utc > 0) activeUsers.last_7_utc_days += 1;
    if (row.requests_30d_utc > 0 || row.ws_sessions_30d_utc > 0) activeUsers.last_30_utc_days += 1;
  }

  return res.json({
    success: true,
    generated_at: new Date(nowMs).toISOString(),
    log_available: usageAggregator.isAvailable(),
    log_coverage: usageAggregator.coverage(),
    registry: {
      total: registryUsers.length,
      expired: roleInfo.expired,
      roles: roleInfo.counts
    },
    active_users: activeUsers,
    totals: usageAggregator.totals(),
    users: usageRows.slice(0, 200),
    recent_registrations: recentRegistrations
  });
});

app.get('/api/admin/usage/user', requireAdmin, async (req, res) => {
  const userId = String(req.query.id || '').trim();
  if (!userId || userId.length > 128) {
    return res.status(400).json({ success: false, message: 'Missing or invalid id.' });
  }
  await usageAggregator.ensureFresh();
  const detail = usageAggregator.userDetail(userId);
  if (!detail) {
    return res.status(404).json({ success: false, message: 'No usage recorded for this user in the retained window.' });
  }
  const registryEntry = readRegistryUsersSafe().find(u => u.user_id === userId) || null;
  return res.json({
    success: true,
    registry: registryEntry ? {
      role: registryEntry.role,
      expires_at: registryEntry.expires_at || null
    } : null,
    ...detail
  });
});

app.get('/api/admin/users/search', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q || q.length > 128) {
    return res.status(400).json({ success: false, message: 'Missing or invalid query.' });
  }
  await usageAggregator.ensureFresh();
  const matchesQuery = (values) => values.some(v => typeof v === 'string' && v.toLowerCase().includes(q));

  const registryUsers = readRegistryUsersSafe();
  const portalUsers = readJSON(USERS_FILE, []);
  const results = new Map();

  const upsert = (userId, patch) => {
    if (!results.has(userId)) {
      results.set(userId, { user_id: userId, sources: [] });
    }
    const row = results.get(userId);
    Object.assign(row, patch, { sources: [...new Set([...row.sources, ...(patch.sources || [])])] });
    delete row.sources_dup;
  };

  for (const user of registryUsers) {
    if (matchesQuery([user.user_id])) {
      upsert(user.user_id, {
        role: user.role,
        expires_at: user.expires_at || null,
        sources: ['registry']
      });
    }
  }
  for (const user of portalUsers) {
    const accountId = user.account_id || user.username;
    if (matchesQuery([user.username, user.phone, user.email, accountId])) {
      upsert(accountId, {
        username: user.username,
        phone: user.phone,
        email: user.email || undefined,
        tier: user.tier || user.role,
        registered_at: user.registered_at || null,
        sources: ['portal_users']
      });
    }
  }
  for (const item of readJSON(PENDING_FILE, [])) {
    if (matchesQuery([item.username, item.phone, item.email])) {
      upsert(item.account_id || item.username, {
        username: item.username,
        phone: item.phone,
        email: item.email || undefined,
        tier: item.tier,
        registered_at: item.registered_at || null,
        registration_status: item.status,
        sources: ['pending']
      });
    }
  }

  const usageByUser = new Map(usageAggregator.publicUsers().map(row => [row.user_id, row]));
  const items = [...results.values()].slice(0, 20).map(row => {
    const usage = usageByUser.get(row.user_id);
    return {
      ...row,
      usage: usage ? {
        requests_today_utc: usage.requests_today_utc,
        requests_7d_utc: usage.requests_7d_utc,
        last_seen: usage.last_seen
      } : null
    };
  });
  return res.json({ success: true, query: q, count: items.length, items });
});

// ============================================================
// ADMIN: Pseudonymous request attribution
//
// Both files are mounted read-only from leandata-v2. This endpoint deliberately
// returns only the daily HMAC fingerprints emitted by REST and WS; it never
// returns raw source IPs, credentials, Authorization values, or query strings.
// ============================================================

function utcDayString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function boundedAttributionLines(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return ATTRIBUTION_DEFAULT_LINES;
  return Math.min(Math.max(parsed, 100), ATTRIBUTION_MAX_LINES);
}

function cleanAttributionHash(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : '';
}

function cleanCredentialFingerprint(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'none' ? normalized : cleanAttributionHash(normalized);
}

function cleanSourceIp(value) {
  const normalized = String(value || '').trim();
  return normalized.length <= 45 && net.isIP(normalized) ? normalized : '';
}

function isPublicSourceIp(value) {
  if (net.isIP(value) === 4) {
    const octets = value.split('.').map(Number);
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0) return false;
    return true;
  }
  if (net.isIP(value) === 6) {
    const normalized = value.toLowerCase();
    return normalized !== '::1'
      && !normalized.startsWith('fc')
      && !normalized.startsWith('fd')
      && !normalized.startsWith('fe80:')
      && !normalized.startsWith('2001:db8:');
  }
  return false;
}

function cleanLocationPart(value, maxLength) {
  return typeof value === 'string'
    ? value.replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLength)
    : '';
}

async function lookupAttributionLocation(sourceIp) {
  if (!isPublicSourceIp(sourceIp)) {
    return { state: 'not_lookupable', label: '保留或内网地址' };
  }
  const cached = attributionGeoCache.get(sourceIp);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let result = { state: 'unavailable', label: '位置未知' };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ATTRIBUTION_GEO_LOOKUP_TIMEOUT_MS);
    try {
      const response = await fetch(`https://ipwho.is/${encodeURIComponent(sourceIp)}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal
      });
      const body = response.ok ? await response.json() : null;
      if (body && body.success !== false) {
        const country = cleanLocationPart(body.country, 80);
        const region = cleanLocationPart(body.region, 80);
        const city = cleanLocationPart(body.city, 80);
        const parts = [country, region, city].filter((value, index, values) => value && values.indexOf(value) === index);
        if (parts.length) {
          result = {
            state: 'available',
            country: country || null,
            region: region || null,
            city: city || null,
            label: parts.join(' · ')
          };
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Location is best-effort only; access attribution remains available.
  }
  attributionGeoCache.set(sourceIp, {
    value: result,
    expiresAt: Date.now() + (result.state === 'available'
      ? ATTRIBUTION_GEO_CACHE_TTL_MS
      : ATTRIBUTION_GEO_FAILURE_TTL_MS)
  });
  return result;
}

async function attachAttributionLocations(records) {
  const sourceIps = [...new Set(records.map(record => record.source_ip).filter(Boolean))]
    .slice(0, ATTRIBUTION_GEO_MAX_LOOKUPS);
  const locations = new Map(await Promise.all(sourceIps.map(async sourceIp => [
    sourceIp,
    await lookupAttributionLocation(sourceIp)
  ])));
  for (const record of records) {
    record.source_location = locations.get(record.source_ip)
      || { state: 'deferred', label: '本页未查询' };
  }
}

function attributionFilters(req) {
  const candidateDay = String(req.query.day || '').trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(candidateDay) ? candidateDay : utcDayString();
  const statusCandidate = Number.parseInt(String(req.query.status || ''), 10);
  const status = Number.isInteger(statusCandidate) && statusCandidate >= 100 && statusCandidate <= 599
    ? statusCandidate
    : null;
  const pathValue = String(req.query.path || '').trim().slice(0, 160);
  const path = pathValue.startsWith('/') && !pathValue.includes('?') ? pathValue : '';
  return {
    day,
    lines: boundedAttributionLines(req.query.lines),
    status,
    path,
    sourceIp: cleanSourceIp(req.query.source_ip),
    credentialHash: cleanCredentialFingerprint(req.query.credential_hash),
    uaCategory: String(req.query.ua_category || '').trim().toLowerCase().slice(0, 40)
  };
}

async function readAttributionLines(logPath, lines) {
  let handle;
  try {
    handle = await fs.promises.open(logPath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) {
      return { state: 'unavailable', scannedLines: 0, truncated: false, lines: [] };
    }
    const bytes = Math.min(stat.size, ATTRIBUTION_MAX_BYTES_PER_SOURCE);
    const start = stat.size - bytes;
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
    }
    const completeLines = text.split('\n');
    if (completeLines.length && completeLines[completeLines.length - 1] === '') completeLines.pop();
    return {
      state: 'available',
      scannedLines: Math.min(completeLines.length, lines),
      truncated: start > 0,
      lines: completeLines.slice(-lines)
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { state: 'missing', scannedLines: 0, truncated: false, lines: [] };
    }
    return { state: 'unavailable', scannedLines: 0, truncated: false, lines: [] };
  } finally {
    if (handle) await handle.close();
  }
}

function attributionRecord(entry, transport, day) {
  if (!entry || typeof entry !== 'object' || entry.attribution_schema !== ATTRIBUTION_SCHEMA) return null;
  const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : null;
  if (!timestamp || timestamp.slice(0, 10) !== day) return null;
  const sourceIp = cleanSourceIp(entry.source_ip);
  const sourceIpHash = cleanAttributionHash(entry.source_ip_hash);
  const credentialHash = cleanCredentialFingerprint(entry.credential_hash);
  if (!sourceIp || !sourceIpHash || !credentialHash) return null;
  const status = Number(entry.status);
  return {
    timestamp,
    transport,
    event: String(entry.event || 'unknown').slice(0, 64),
    method: transport === 'http' ? String(entry.method || '').slice(0, 16) || null : null,
    path: transport === 'http' ? String(entry.path || '').slice(0, 160) || null : null,
    mode: transport === 'ws' ? String(entry.mode || '').slice(0, 64) || null : null,
    status: Number.isFinite(status) ? status : 0,
    user_id: typeof entry.user_id === 'string' ? entry.user_id.slice(0, 128) : null,
    user_role: typeof entry.user_role === 'string' ? entry.user_role.slice(0, 64) : null,
    source_ip: sourceIp,
    source_ip_hash: sourceIpHash,
    credential_hash: credentialHash,
    ua_category: typeof entry.ua_category === 'string' ? entry.ua_category.slice(0, 40) : 'unknown'
  };
}

function matchesAttributionFilters(record, filters) {
  return (!filters.status || record.status === filters.status)
    && (!filters.path || record.path === filters.path)
    && (!filters.sourceIp || record.source_ip === filters.sourceIp)
    && (!filters.credentialHash || record.credential_hash === filters.credentialHash)
    && (!filters.uaCategory || record.ua_category === filters.uaCategory);
}

function attributionTopRows(records, key) {
  const rows = new Map();
  for (const record of records) {
    const value = record[key];
    if (!value) continue;
    const row = rows.get(value) || { value, count: 0, errors: 0, last_seen: null };
    row.count += 1;
    if (record.status >= 400) row.errors += 1;
    if (!row.last_seen || record.timestamp > row.last_seen) row.last_seen = record.timestamp;
    rows.set(value, row);
  }
  return [...rows.values()]
    .sort((a, b) => b.count - a.count || b.errors - a.errors || a.value.localeCompare(b.value))
    .slice(0, 12);
}

app.get('/api/admin/attribution', requireAdmin, async (req, res) => {
  const filters = attributionFilters(req);
  const accessPath = path.join(ACCESS_LOG_DIR(), `access-${filters.day}.jsonl`);
  const [accessSource, usageSource] = await Promise.all([
    readAttributionLines(accessPath, filters.lines),
    readAttributionLines(USAGE_LOG_PATH(), filters.lines)
  ]);
  const records = [];
  for (const line of accessSource.lines) {
    try {
      const record = attributionRecord(JSON.parse(line), 'http', filters.day);
      if (record && matchesAttributionFilters(record, filters)) records.push(record);
    } catch {
      // A concurrent writer or an older malformed line is ignored.
    }
  }
  for (const line of usageSource.lines) {
    try {
      const record = attributionRecord(JSON.parse(line), 'ws', filters.day);
      if (record && matchesAttributionFilters(record, filters)) records.push(record);
    } catch {
      // A concurrent writer or an older malformed line is ignored.
    }
  }

  records.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  await attachAttributionLocations(records);
  const statusCounts = {};
  let errors = 0;
  for (const record of records) {
    statusCounts[String(record.status)] = (statusCounts[String(record.status)] || 0) + 1;
    if (record.status >= 400) errors += 1;
  }

  return res.json({
    success: true,
    schema_version: 'request_attribution_summary_v2',
    fingerprint_day: filters.day,
    filters,
    summary: {
      total: records.length,
      errors,
      unique_source_ips: new Set(records.map(record => record.source_ip_hash)).size,
      unique_credentials: new Set(records.map(record => record.credential_hash)).size,
      unique_ua_categories: new Set(records.map(record => record.ua_category)).size,
      status_counts: statusCounts
    },
    sources: {
      access: {
        state: accessSource.state,
        scanned_lines: accessSource.scannedLines,
        byte_window_truncated: accessSource.truncated
      },
      usage: {
        state: usageSource.state,
        scanned_lines: usageSource.scannedLines,
        byte_window_truncated: usageSource.truncated
      }
    },
    top_source_ips: attributionTopRows(records, 'source_ip_hash'),
    top_credentials: attributionTopRows(records, 'credential_hash'),
    ua_categories: attributionTopRows(records, 'ua_category').map(row => ({
      category: row.value,
      count: row.count,
      errors: row.errors,
      last_seen: row.last_seen
    })),
    recent_events: records.slice(0, ATTRIBUTION_MAX_RECENT_EVENTS)
  });
});

// ============================================================
// ORIGINAL: Generate token (for approved users)
// ============================================================
app.post('/api/generate-token', async (req, res) => {
  const { username, phone } = req.body;

  if (!username || !phone) {
    return res.status(400).json({ success: false, message: 'Username and phone are required.' });
  }

  const localUsers = readJSON(USERS_FILE);
  const identity = canonicalAccountIdentity({ username, phone });
  const validCustomer = localUsers.find(user => sameAccountIdentity(user, identity));

  if (!validCustomer) {
    return res.status(401).json({ success: false, message: 'User not found or payment pending.' });
  }

  try {
    var proxyData = { users: [] };
    if (fs.existsSync(PROXY_USERS_FILE)) {
      proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    }
    if (!proxyData.users) proxyData.users = [];

    const accountId = accountRegistryId(validCustomer);
    const existing = proxyData.users.find(u => u.user_id === accountId);
    if (existing) {
      const tier = validCustomer.tier || existing.role;
      return res.json({
        success: true,
        message: 'Token 已存在。',
        token: existing.token,
        expiry: existing.expires_at,
        role: existing.role,
        tier,
        current_plan: publicPlan(tier)
      });
    }

    // Look up tier config from the stored tier or fall back to role
    const tierConfig = TIERS[validCustomer.tier] || TIERS[validCustomer.role] || TIERS.premium;
    const perms = resolvePermissions(tierConfig, validCustomer.mode);
    const token = crypto.randomUUID();
    const expiresAt = computeExpiry(tierConfig);

    const newProxyUser = {
      token,
      user_id: accountId,
      role: tierConfig.role,
      expires_at: expiresAt,
      permissions: perms,
      ...(validCustomer.email && { email: validCustomer.email })
    };

    proxyData.users = proxyData.users.filter(u => u.user_id !== accountId);
    proxyData.users.push(newProxyUser);

    const syncResult = await writeProxyUsersAndSyncAsync(proxyData);

    return res.json({
      success: true,
      token,
      expiry: expiresAt,
      role: newProxyUser.role,
      tier: validCustomer.tier || newProxyUser.role,
      current_plan: publicPlan(validCustomer.tier || newProxyUser.role),
      syncOk: syncResult.ok
    });
  } catch (err) {
    console.error('Error updating proxy registry:', err);
    return res.status(500).json({ success: false, message: 'Failed to register token on the data proxy server.' });
  }
});

// ============================================================
// Status API — serves real-time health + historical uptime/latency
// Data file: data/status.json (auto-created, persisted across restarts)
// ============================================================

const STATUS_FILE = path.join(DATA_DIR, 'status.json');
const PROXY_REST_URL = process.env.PROXY_REST_URL
  || (IS_CLOUD_HOST ? 'http://localhost:8766' : 'http://100.82.194.120:8766');
const PROXY_RT_URL   = process.env.PROXY_RT_URL   || 'https://rt-api.leandata.uk';
const PROXY_WS_HOST  = process.env.PROXY_WS_HOST || '127.0.0.1';
const PROXY_WS_PORT  = process.env.PROXY_WS_PORT || 8767;
const STATUS_PROBE_TIMEOUT_MS = Math.max(100, Math.min(Number(process.env.STATUS_PROBE_TIMEOUT_MS) || 3000, 10000));

function readStatusData() {
  try {
    if (fs.existsSync(STATUS_FILE)) return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch (_) {}
  return { uptime: { rest: [], ws: [], rt: [] }, latency: { rest: [], ws: [], rt: [] }, incidents: [] };
}

function writeStatusData(data) {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2)); } catch (_) {}
}

// Probe REST proxy health — returns { ok, latencyMs }
async function probeRest() {
  const start = Date.now();
  let timer;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), STATUS_PROBE_TIMEOUT_MS);
    const resp = await fetch(`${PROXY_REST_URL}/health`, { signal: controller.signal });
    return { ok: resp.ok, latencyMs: Date.now() - start };
  } catch (_) {
    return { ok: false, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

// Probe WS proxy — TCP connect to check port is open
async function probeWs() {
  const net = require('net');
  const start = Date.now();
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(STATUS_PROBE_TIMEOUT_MS);
    sock.once('connect', () => { sock.destroy(); resolve({ ok: true, latencyMs: Date.now() - start }); });
    sock.once('timeout', () => { sock.destroy(); resolve({ ok: false, latencyMs: Date.now() - start }); });
    sock.once('error', () => { sock.destroy(); resolve({ ok: false, latencyMs: Date.now() - start }); });
    sock.connect(PROXY_WS_PORT, PROXY_WS_HOST);
  });
}

// Shared keep-alive agents for the RT probe. Without connection reuse, Node's
// fetch cold-handshakes a full TLS connection to the Cloudflare edge on every
// probe (~265ms), while REST (localhost, no TLS) and WS (bare TCP) don't — so RT
// looked ~6-40x slower purely as a measurement artifact. A warm reused socket
// makes RT measure its real ~30ms (CF edge HIT). The 25s heartbeat below keeps
// this socket alive between sparse /api/status polls.
const _rtHttpsAgent = require('https').Agent ? new (require('https').Agent)({ keepAlive: true, maxSockets: 1, keepAliveMsecs: 30000 }) : undefined;
const _rtHttpAgent  = new (require('http').Agent)({ keepAlive: true, maxSockets: 1 });

// Probe RT API (Aliyun via Cloudflare) — returns { ok, latencyMs }
function probeRt() {
  const start = Date.now();
  const isHttps = PROXY_RT_URL.startsWith('https');
  const lib = isHttps ? require('https') : require('http');
  const agent = isHttps ? _rtHttpsAgent : _rtHttpAgent;
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve({ ok, latencyMs: Date.now() - start }); } };
    try {
      const req = lib.get(`${PROXY_RT_URL}/health`, { agent, timeout: STATUS_PROBE_TIMEOUT_MS }, res => {
        res.on('data', () => {});
        res.on('end', () => finish(res.statusCode >= 200 && res.statusCode < 300));
        res.on('error', () => finish(false));
      });
      req.on('timeout', () => { req.destroy(); finish(false); });
      req.on('error', () => finish(false));
    } catch (_) {
      finish(false);
    }
  });
}

const STATUS_CACHE_TTL_MS = Math.max(1000, Math.min(Number(process.env.STATUS_CACHE_TTL_MS) || 15000, 300000));
let statusSnapshot = null;
let statusProbeInFlight = null;

async function collectStatusSnapshot() {
    const [restProbe, wsProbe, rtProbe] = await Promise.all([probeRest(), probeWs(), probeRt()]);
    const statusData = readStatusData();

    // Ensure rt arrays exist (migration from 2-component to 3-component)
    if (!statusData.latency.rt) statusData.latency.rt = [];
    if (!statusData.uptime.rt) statusData.uptime.rt = [];

    // Append latency sample ONLY on success (avoids timeout spikes: 5000ms WS, 10000ms REST)
    const now = Date.now();
    if (restProbe.ok) statusData.latency.rest.push({ t: now, ms: restProbe.latencyMs });
    if (wsProbe.ok) statusData.latency.ws.push({ t: now, ms: wsProbe.latencyMs });
    if (rtProbe.ok) statusData.latency.rt.push({ t: now, ms: rtProbe.latencyMs });
    if (statusData.latency.rest.length > 1440) statusData.latency.rest = statusData.latency.rest.slice(-1440);
    if (statusData.latency.ws.length > 1440) statusData.latency.ws = statusData.latency.ws.slice(-1440);
    if (statusData.latency.rt.length > 1440) statusData.latency.rt = statusData.latency.rt.slice(-1440);

    // Append uptime sample (1 = up, 0 = down)
    statusData.uptime.rest.push({ t: now, up: restProbe.ok ? 1 : 0 });
    statusData.uptime.ws.push({ t: now, up: wsProbe.ok ? 1 : 0 });
    statusData.uptime.rt.push({ t: now, up: rtProbe.ok ? 1 : 0 });
    // Keep 90 days of minute samples (129600) but cap at 100k to avoid bloat
    const maxUptime = 100000;
    if (statusData.uptime.rest.length > maxUptime) statusData.uptime.rest = statusData.uptime.rest.slice(-maxUptime);
    if (statusData.uptime.ws.length > maxUptime) statusData.uptime.ws = statusData.uptime.ws.slice(-maxUptime);
    if (statusData.uptime.rt.length > maxUptime) statusData.uptime.rt = statusData.uptime.rt.slice(-maxUptime);

    writeStatusData(statusData);

    // Auto-detect outages: log incident on transition from up → down, auto-resolve on recovery
    const prevRest = statusData.uptime.rest.length >= 2 ? statusData.uptime.rest[statusData.uptime.rest.length - 2] : null;
    const prevWs = statusData.uptime.ws.length >= 2 ? statusData.uptime.ws[statusData.uptime.ws.length - 2] : null;

    if (prevRest && prevRest.up === 1 && !restProbe.ok) {
      addIncident('REST API', 'major', 'REST proxy unreachable', `Health probe failed after ${restProbe.latencyMs}ms. Cloudflare → Aliyun path affected.`);
    } else if (prevRest && prevRest.up === 0 && restProbe.ok) {
      addIncident('REST API', 'resolved', 'REST proxy recovered', `Health probe succeeded in ${restProbe.latencyMs}ms.`);
    }
    if (prevWs && prevWs.up === 1 && !wsProbe.ok) {
      addIncident('WebSocket', 'major', 'WebSocket proxy unreachable', `TCP connect to ${PROXY_WS_HOST}:${PROXY_WS_PORT} failed.`);
    } else if (prevWs && prevWs.up === 0 && wsProbe.ok) {
      addIncident('WebSocket', 'resolved', 'WebSocket proxy recovered', `TCP connect to ${PROXY_WS_HOST}:${PROXY_WS_PORT} succeeded in ${wsProbe.latencyMs}ms.`);
    }
    const prevRt = statusData.uptime.rt.length >= 2 ? statusData.uptime.rt[statusData.uptime.rt.length - 2] : null;
    if (prevRt && prevRt.up === 1 && !rtProbe.ok) {
      addIncident('RT API', 'major', 'RT API proxy unreachable', `Health probe to rt-api.leandata.uk failed after ${rtProbe.latencyMs}ms.`);
    } else if (prevRt && prevRt.up === 0 && rtProbe.ok) {
      addIncident('RT API', 'resolved', 'RT API proxy recovered', `Health probe succeeded in ${rtProbe.latencyMs}ms.`);
    }

    const restStatus = restProbe.ok ? 'operational' : 'outage';
    const wsStatus = wsProbe.ok ? 'operational' : 'outage';
    const rtStatus = rtProbe.ok ? 'operational' : 'outage';
    const allOk = restProbe.ok && wsProbe.ok && rtProbe.ok;
    const allDown = !restProbe.ok && !wsProbe.ok && !rtProbe.ok;
    const overall = allOk ? 'operational' : allDown ? 'outage' : 'degraded';

    return {
      overall,
      components: {
        rest: {
          name: 'REST API',
          route: 'api.leandata.uk · Cloudflare → Aliyun',
          status: restStatus,
          latencyMs: restProbe.latencyMs,
        },
        rt: {
          name: 'RT API',
          route: 'rt-api.leandata.uk · Cloudflare → Aliyun',
          status: rtStatus,
          latencyMs: rtProbe.latencyMs,
        },
        ws: {
          name: 'WebSocket stream',
          route: 'wss://leandata.uk/stream · Cloudflare → Aliyun',
          status: wsStatus,
          latencyMs: wsProbe.latencyMs,
        },
      },
      timestamp: new Date().toISOString(),
    };
}

async function getStatusSnapshot() {
  const now = Date.now();
  if (statusSnapshot && fs.existsSync(STATUS_FILE) && now - statusSnapshot.generatedAt < STATUS_CACHE_TTL_MS) {
    return statusSnapshot.payload;
  }
  if (!statusProbeInFlight) {
    statusProbeInFlight = collectStatusSnapshot()
      .then(payload => {
        statusSnapshot = { generatedAt: Date.now(), payload };
        return payload;
      })
      .finally(() => { statusProbeInFlight = null; });
  }
  return statusProbeInFlight;
}

// GET /api/status — shared snapshot avoids repeated probes and synchronous writes per page poll.
app.get('/api/status', async (_req, res) => {
  try {
    res.json(await getStatusSnapshot());
  } catch (err) {
    console.error('Status probe error:', err);
    res.status(500).json({ error: 'Status probe failed' });
  }
});

// GET /api/uptime — 90-day uptime data per component
// Returns arrays of daily aggregated uptime percentages
app.get('/api/uptime', (_req, res) => {
  try {
    const statusData = readStatusData();
    const now = Date.now();
    const ms90d = 90 * 24 * 60 * 60 * 1000;

    function aggregateDaily(samples) {
      const recent = samples.filter(s => s.t > now - ms90d);
      if (recent.length === 0) return Array.from({ length: 90 }, () => 100);

      const days = {};
      for (const s of recent) {
        const day = new Date(s.t).toISOString().slice(0, 10);
        if (!days[day]) days[day] = { up: 0, total: 0 };
        days[day].up += s.up;
        days[day].total += 1;
      }

      // Fill last 90 days, defaulting to 100% for missing days
      const result = [];
      for (let i = 89; i >= 0; i--) {
        const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
        const entry = days[d];
        result.push(entry ? Math.round((entry.up / entry.total) * 10000) / 100 : 100);
      }
      return result;
    }

    res.json({
      rest: aggregateDaily(statusData.uptime.rest),
      rt: aggregateDaily(statusData.uptime.rt || []),
      ws: aggregateDaily(statusData.uptime.ws),
    });
  } catch (err) {
    console.error('Uptime data error:', err);
    res.status(500).json({ error: 'Failed to load uptime data' });
  }
});

// GET /api/latency?range=24h|7d|30d — latency time series per component
app.get('/api/latency', (req, res) => {
  try {
    const range = req.query.range || '24h';
    const statusData = readStatusData();
    const now = Date.now();

    const rangeMs = range === '7d' ? 7 * 86400000 : range === '30d' ? 30 * 86400000 : 86400000;
    const bucketMs = range === '24h' ? 3600000 : range === '7d' ? 3600000 : 3600000; // 1h buckets
    const cutoff = now - rangeMs;

    function bucketize(samples) {
      const recent = samples.filter(s => s.t > cutoff);
      if (recent.length === 0) return [];

      const buckets = {};
      for (const s of recent) {
        const key = Math.floor(s.t / bucketMs);
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(s.ms);
      }

      // Fill gaps and compute p50
      const result = [];
      const startBucket = Math.floor(cutoff / bucketMs);
      const endBucket = Math.floor(now / bucketMs);
      for (let b = startBucket; b <= endBucket; b++) {
        const vals = buckets[b];
        if (vals && vals.length > 0) {
          vals.sort((a, b) => a - b);
          result.push(vals[Math.floor(vals.length * 0.5)]);
        } else {
          result.push(null);
        }
      }
      return result;
    }

    res.json({
      range,
      rest: bucketize(statusData.latency.rest),
      rt: bucketize(statusData.latency.rt || []),
      ws: bucketize(statusData.latency.ws),
    });
  } catch (err) {
    console.error('Latency data error:', err);
    res.status(500).json({ error: 'Failed to load latency data' });
  }
});

// ── Incident system ──

function addIncident(component, severity, title, summary, duration) {
  const data = readStatusData();
  if (!data.incidents) data.incidents = [];
  data.incidents.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: new Date().toISOString(),
    component,
    severity,
    title,
    summary,
    duration: duration || null,
    resolved: severity === 'resolved',
  });
  // Keep last 100 incidents
  if (data.incidents.length > 100) data.incidents = data.incidents.slice(0, 100);
  writeStatusData(data);
  return data.incidents[0];
}

// GET /api/incidents — list all recorded incidents
app.get('/api/incidents', (_req, res) => {
  try {
    const data = readStatusData();
    res.json({ incidents: data.incidents || [] });
  } catch (err) {
    console.error('Incidents read error:', err);
    res.status(500).json({ error: 'Failed to load incidents' });
  }
});

// POST /api/incidents — manually log an incident (admin/internal use)
app.post('/api/incidents', requireAdmin, (req, res) => {
  try {
    const { component, severity, title, summary, duration } = req.body || {};
    if (!component || !title) {
      return res.status(400).json({ error: 'Missing required fields: component, title' });
    }
    const incident = addIncident(
      component,
      severity || 'minor',
      title,
      summary || '',
      duration || null
    );
    res.json({ success: true, incident });
  } catch (err) {
    console.error('Incident write error:', err);
    res.status(500).json({ error: 'Failed to write incident' });
  }
});

// ── Usage proxy — forwards to cloud proxy audit/stats on localhost:8768 ──

const PROXY_LOCAL = process.env.PROXY_REST_URL
  || (IS_CLOUD_HOST ? 'http://localhost:8766' : 'http://100.82.194.120:8766');

async function proxyUsage(req, res, endpoint) {
  try {
    const principal = resolveMcpPrincipal(req);
    if (!principal) return res.status(401).json({ error: 'Missing or invalid Leandata bearer token.' });
    if (principal.expired) return res.status(403).json({ error: 'Leandata token expired.' });

    const params = new URLSearchParams(req.query);
    params.delete('username');
    const qs = params.toString();
    const url = `${PROXY_LOCAL}${endpoint}${qs ? '?' + qs : ''}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: principal.token }),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('Usage audit proxy error:', err);
    res.status(502).json({ error: 'Failed to reach proxy' });
  }
}

// GET/POST usage data — the authenticated token can retrieve only its own records.
app.all('/api/usage/audit', (req, res) => proxyUsage(req, res, '/v1/admin/audit'));

app.all('/api/usage/stats', (req, res) => proxyUsage(req, res, '/v1/admin/stats'));

// POST /api/survey/fmp — record FMP integration survey submission
app.post('/api/survey/fmp', (req, res) => {
  try {
    const { email, interests, tier, comments } = req.body || {};
    const surveyFile = path.join(DATA_DIR, 'survey.json');

    // Ensure DATA_DIR exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const responses = readJSON(surveyFile, []);
    responses.push({
      email: email || '',
      interests: interests || [],
      tier: tier || '',
      comments: comments || '',
      timestamp: new Date().toISOString()
    });
    writeJSON(surveyFile, responses);
    res.json({ success: true, message: 'Survey response saved.' });
  } catch (err) {
    console.error('Survey write error:', err);
    res.status(500).json({ error: 'Failed to write survey response' });
  }
});

// Auto-log startup incident
addIncident('Token Portal', 'resolved', 'Service restart', `token-site server started on port ${PORT}`);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
  // Heartbeat: keep the RT probe's TLS connection to the Cloudflare edge warm so
  // periodic /api/status probes reuse it (~30ms) instead of cold-handshaking
  // (~265ms) on every poll. Interval is below CF's keep-alive idle timeout.
  setInterval(() => { probeRt().catch(() => {}); }, 25000).unref();
}

module.exports = {
  app,
  TIERS,
  syncToEC2,
  computeExpiry,
  readJSON,
  writeJSON,
  safePaperUserId,
  getLastTestVerificationEmail,
  clearTestVerificationEmails,
  PROXY_USERS_FILE,
  EC2_HOST,
  EC2_USERS_PATH,
  EC2_SSH_KEY,
  __resetUsageAggregatorForTest: () => usageAggregator.__resetForTest(),
  __refreshUsageAggregatorForTest: () => usageAggregator.ensureFresh(0),
  __setUsageAggregatorTestHooks: (hooks) => usageAggregator.__setTestHooks(hooks)
};
