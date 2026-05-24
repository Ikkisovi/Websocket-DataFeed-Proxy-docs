const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Data paths (overridable for tests via env) ---
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const PROXY_USERS_FILE = process.env.PROXY_USERS_FILE || '/home/ec2-user/cloud-proxy/users.json';

// --- ThinkCentre sync config ---
const THINKCENTRE_HOST = process.env.THINKCENTRE_HOST || 'mint@100.70.107.106';
const THINKCENTRE_USERS_PATH = process.env.THINKCENTRE_USERS_PATH || '/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json';

// --- Service tier definitions ---
// Roles map to cloud proxy RateLimiter:
//   basic:    REST 10/min, WS 10 symbols
//   standard: REST 60/min, WS 100 symbols  (was "limited_premium")
//   premium:  REST 300/min, WS 500 symbols
const TIERS = {
  trial: {
    role: 'standard',
    expiryDays: 3,
    permissions: {
      ws: { stocks: true, options: true, overnight: false, crypto: false, news: false, boats: false, test: true },
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
        ws: { stocks: true, options: true, overnight: false, crypto: false, news: false, boats: false, test: true },
        rest: { stocks_history: true, options_history: false, options_contracts: false, options_snapshots: false, options_snapshots_expiry: false, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
      },
      options: {
        ws: { stocks: true, options: true, overnight: false, crypto: false, news: false, boats: false, test: true },
        rest: { stocks_history: false, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
      }
    },
    // Default permissions (used when mode not specified — shouldn't happen but safe fallback)
    permissions: {
      ws: { stocks: true, options: true, overnight: false, crypto: false, news: false, boats: false, test: true },
      rest: { stocks_history: true, options_history: false, options_contracts: false, options_snapshots: false, options_snapshots_expiry: false, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
    }
  },
  standard: {
    role: 'standard',
    expiryDays: 30,
    permissions: {
      ws: { stocks: true, options: true, overnight: false, crypto: false, news: false, boats: false, test: true },
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
  }
};

// --- In-memory admin sessions ---
const adminSessions = new Set();

// --- Helpers ---
function readJSON(filepath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch { return fallback; }
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ success: false, message: 'Admin auth required.' });
  }
  next();
}

/**
 * SCP users.json to ThinkCentre so the cloud proxy picks up changes.
 * Fire-and-forget: logs errors but does not block the response.
 */
function syncToThinkCentre() {
  execFile('scp', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=5',
    PROXY_USERS_FILE,
    `${THINKCENTRE_HOST}:${THINKCENTRE_USERS_PATH}`
  ], { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[Sync] SCP to ThinkCentre failed:', err.message, stderr);
    } else {
      console.log('[Sync] users.json synced to ThinkCentre');
    }
  });
}

/**
 * Write proxy users file and sync to ThinkCentre.
 */
function writeProxyUsersAndSync(data) {
  writeJSON(PROXY_USERS_FILE, data);
  syncToThinkCentre();
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

// ============================================================
// PUBLIC: Buyer Registration
// ============================================================
app.post('/api/register', (req, res) => {
  const { username, phone, tier, mode } = req.body;

  if (!username || !phone) {
    return res.status(400).json({ success: false, message: '用户名和手机号都是必填的。' });
  }

  const selectedTier = tier || 'standard';
  if (!TIERS[selectedTier]) {
    return res.status(400).json({ success: false, message: '无效的服务等级。' });
  }

  // Value tier requires a mode selection
  if (selectedTier === 'value') {
    if (!mode || !TIERS.value.modes[mode]) {
      return res.status(400).json({ success: false, message: '请选择数据方向：stocks 或 options。' });
    }
  }

  // Check if username already taken in approved users
  const users = readJSON(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ success: false, message: '该用户名已被使用，请换一个。' });
  }

  // Check if already pending
  const pending = readJSON(PENDING_FILE);
  if (pending.find(p => p.username === username && p.status === 'pending')) {
    return res.status(409).json({ success: false, message: '该用户名正在审核中，请等待。' });
  }

  const entry = {
    id: crypto.randomUUID(),
    username: username.trim(),
    phone: phone.trim(),
    tier: selectedTier,
    ...(mode && { mode }),
    registered_at: new Date().toISOString(),
    status: 'pending'
  };

  pending.push(entry);
  writeJSON(PENDING_FILE, pending);

  return res.json({ success: true, message: '注册成功！请等待卖家确认订单后即可生成 Token。', id: entry.id });
});

// ============================================================
// PUBLIC: Buyer check status (by username + phone)
// ============================================================
app.post('/api/check-status', (req, res) => {
  const { username, phone } = req.body;
  if (!username || !phone) {
    return res.status(400).json({ success: false, message: '请提供用户名和手机号。' });
  }

  const pending = readJSON(PENDING_FILE);
  const entry = pending.find(p => p.username === username.trim() && p.phone === phone.trim());

  if (!entry) {
    const users = readJSON(USERS_FILE);
    const approved = users.find(u => u.username === username.trim() && u.phone === phone.trim());
    if (approved) {
      return res.json({ success: true, status: 'approved', message: '已通过审核！请到首页生成 Token。' });
    }
    return res.json({ success: true, status: 'not_found', message: '未找到注册记录。' });
  }

  return res.json({ success: true, status: entry.status, message: entry.status === 'pending' ? '审核中，请耐心等待。' : entry.status === 'rejected' ? (entry.reject_reason || '审核未通过，请联系卖家。') : '已通过！' });
});

// ============================================================
// ADMIN: Login
// ============================================================
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '密码错误。' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.add(token);
  return res.json({ success: true, token });
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
app.post('/api/admin/approve', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, message: 'Missing id.' });

  const pending = readJSON(PENDING_FILE);
  const entry = pending.find(p => p.id === id && p.status === 'pending');
  if (!entry) return res.status(404).json({ success: false, message: '未找到该待审核记录。' });

  const tierConfig = TIERS[entry.tier] || TIERS.premium;
  const perms = resolvePermissions(tierConfig, entry.mode);

  // 1. Add to users.json
  const users = readJSON(USERS_FILE);
  const filtered = users.filter(u => u.username !== entry.username);
  filtered.push({
    username: entry.username,
    phone: entry.phone,
    role: tierConfig.role,
    tier: entry.tier,
    ...(entry.mode && { mode: entry.mode }),
    permissions: perms
  });
  writeJSON(USERS_FILE, filtered);

  // 2. Update pending status
  entry.status = 'approved';
  entry.approved_at = new Date().toISOString();
  writeJSON(PENDING_FILE, pending);

  // 3. Generate token and register on proxy + sync to ThinkCentre
  try {
    var proxyData = { users: [] };
    if (fs.existsSync(PROXY_USERS_FILE)) {
      proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    }
    if (!proxyData.users) proxyData.users = [];

    const existing = proxyData.users.find(u => u.user_id === entry.username);
    if (existing) {
      syncToThinkCentre();
      return res.json({ success: true, message: `已批准 ${entry.username}，Token 已存在。`, token: existing.token, expiry: existing.expires_at });
    }

    const token = crypto.randomUUID();
    const expiresAt = computeExpiry(tierConfig);

    proxyData.users = proxyData.users.filter(u => u.user_id !== entry.username);
    proxyData.users.push({
      token,
      user_id: entry.username,
      role: tierConfig.role,
      expires_at: expiresAt,
      permissions: perms
    });

    writeProxyUsersAndSync(proxyData);

    return res.json({
      success: true,
      message: `已批准 ${entry.username}，Token 已注册并同步到数据服务。`,
      token,
      expiry: expiresAt
    });
  } catch (err) {
    return res.json({
      success: true,
      message: `已批准 ${entry.username}，但 proxy 同步失败: ${err.message}。`
    });
  }
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
// ORIGINAL: Generate token (for approved users)
// ============================================================
app.post('/api/generate-token', async (req, res) => {
  const { username, phone } = req.body;

  if (!username || !phone) {
    return res.status(400).json({ success: false, message: 'Username and phone are required.' });
  }

  const localUsers = readJSON(USERS_FILE);
  const validCustomer = localUsers.find(u => u.username === username && u.phone === phone);

  if (!validCustomer) {
    return res.status(401).json({ success: false, message: 'User not found or payment pending.' });
  }

  try {
    var proxyData = { users: [] };
    if (fs.existsSync(PROXY_USERS_FILE)) {
      proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    }
    if (!proxyData.users) proxyData.users = [];

    const existing = proxyData.users.find(u => u.user_id === validCustomer.username);
    if (existing) {
      return res.json({ success: true, message: 'Token 已存在。', token: existing.token, expiry: existing.expires_at, role: existing.role });
    }

    // Look up tier config from the stored tier or fall back to role
    const tierConfig = TIERS[validCustomer.tier] || TIERS[validCustomer.role] || TIERS.premium;
    const perms = resolvePermissions(tierConfig, validCustomer.mode);
    const token = crypto.randomUUID();
    const expiresAt = computeExpiry(tierConfig);

    const newProxyUser = {
      token,
      user_id: validCustomer.username,
      role: tierConfig.role,
      expires_at: expiresAt,
      permissions: perms
    };

    proxyData.users = proxyData.users.filter(u => u.user_id !== validCustomer.username);
    proxyData.users.push(newProxyUser);

    writeProxyUsersAndSync(proxyData);

    return res.json({ success: true, token, expiry: expiresAt, role: newProxyUser.role });
  } catch (err) {
    console.error('Error updating proxy registry:', err);
    return res.status(500).json({ success: false, message: 'Failed to register token on the data proxy server.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

module.exports = { app, TIERS, syncToThinkCentre, computeExpiry, readJSON, writeJSON };
