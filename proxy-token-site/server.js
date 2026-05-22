const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
// const { v4: uuidv4 } = require('uuid'); // removed
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Data paths ---
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const PROXY_USERS_FILE = '/home/ec2-user/cloud-proxy/users.json';

// --- Service tier definitions ---
const TIERS = {
  premium: {
    role: 'premium',
    permissions: {
      ws: { stocks: true, options: true, overnight: true, crypto: true, news: true, boats: true, test: true },
      rest: { stocks_history: true, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: true, admin_token_lookup: false, news_history: true }
    }
  },
  limited_premium: {
    role: 'limited_premium',
    permissions: {
      ws: { stocks: true, options: true, overnight: false, crypto: false, news: false, boats: false, test: false },
      rest: { stocks_history: true, options_history: true, options_contracts: true, options_snapshots: true, options_snapshots_expiry: true, crypto_orderbooks: false, admin_token_lookup: false, news_history: false }
    }
  },
  basic: {
    role: 'basic',
    permissions: {
      ws: { stocks: true, options: false, overnight: false, crypto: false, news: true, boats: false, test: false },
      rest: { stocks_history: true, options_history: false, options_contracts: false, options_snapshots: false, options_snapshots_expiry: false, crypto_orderbooks: false, admin_token_lookup: false, news_history: true }
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

// ============================================================
// PUBLIC: Buyer Registration
// ============================================================
app.post('/api/register', (req, res) => {
  const { username, phone, tier } = req.body;

  if (!username || !phone) {
    return res.status(400).json({ success: false, message: '用户名和手机号都是必填的。' });
  }

  const selectedTier = tier || 'premium';
  if (!TIERS[selectedTier]) {
    return res.status(400).json({ success: false, message: '无效的服务等级。' });
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
    registered_at: new Date().toISOString(),
    status: 'pending'
  };

  pending.push(entry);
  writeJSON(PENDING_FILE, pending);

  return res.json({ success: true, message: '注册成功！请等待卖家确认订单后即可生成 Token。', id: entry.id });
});

// ============================================================
// PUBLIC: Buyer check status (by order_id + username)
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

  // 1. Add to users.json
  const users = readJSON(USERS_FILE);
  // Remove existing if any
  const filtered = users.filter(u => u.username !== entry.username);
  filtered.push({
    username: entry.username,
    phone: entry.phone,
    role: tierConfig.role,
    permissions: tierConfig.permissions
  });
  writeJSON(USERS_FILE, filtered);

  // 2. Update pending status
  entry.status = 'approved';
  entry.approved_at = new Date().toISOString();
  writeJSON(PENDING_FILE, pending);

  // 3. Generate token and register on EC2 proxy
  try {
    var ec2Data = { users: [] };
    if (fs.existsSync(PROXY_USERS_FILE)) {
      ec2Data = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    }
    if (!ec2Data.users) ec2Data.users = [];

    const existing = ec2Data.users.find(u => u.user_id === entry.username);
    if (existing) {
      return res.json({ success: true, message: `已批准 ${entry.username}，Token 已存在。`, token: existing.token, expiry: existing.expires_at });
    }

    const token = crypto.randomUUID();
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 1);

    ec2Data.users = ec2Data.users.filter(u => u.user_id !== entry.username);

    ec2Data.users.push({
      token,
      user_id: entry.username,
      role: tierConfig.role,
      expires_at: expiry.toISOString(),
      permissions: tierConfig.permissions
    });

    writeJSON(PROXY_USERS_FILE, ec2Data);

    return res.json({
      success: true,
      message: `已批准 ${entry.username}，Token 已自动注册到 proxy。`,
      token,
      expiry: expiry.toISOString()
    });
  } catch (err) {
    // Still approved even if proxy sync fails
    return res.json({
      success: true,
      message: `已批准 ${entry.username}，但 proxy 同步失败: ${err.message}。用户仍可在首页生成 Token。`
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
    var ec2Data = { users: [] };
    if (fs.existsSync(PROXY_USERS_FILE)) {
      ec2Data = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    }
    if (!ec2Data.users) ec2Data.users = [];

    const existing = ec2Data.users.find(u => u.user_id === validCustomer.username);
    if (existing) {
      return res.json({ success: true, message: 'Token 已存在。', token: existing.token, expiry: existing.expires_at });
    }

    const token = crypto.randomUUID();
    const now = new Date();
    const expiry = new Date(now.setMonth(now.getMonth() + 1));
    const expiresAtIso = expiry.toISOString();

    // Check if user already has a token - return existing one
    const existingGen = ec2Data.users.find(u => u.user_id === validCustomer.username);
    if (existingGen) {
      return res.json({ success: true, token: existingGen.token, expiry: existingGen.expires_at, role: existingGen.role || validCustomer.role || 'default' });
    }

    const newProxyUser = {
      token,
      user_id: validCustomer.username,
      role: validCustomer.role || 'default',
      expires_at: expiresAtIso
    };
    if (validCustomer.permissions) newProxyUser.permissions = validCustomer.permissions;

    ec2Data.users = ec2Data.users.filter(u => u.user_id !== validCustomer.username);
    ec2Data.users.push(newProxyUser);
    writeJSON(PROXY_USERS_FILE, ec2Data);

    return res.json({ success: true, token, expiry: expiresAtIso, role: newProxyUser.role });
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

module.exports = app;
