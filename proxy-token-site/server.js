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

// Mobile UA detection — serve mobile.html for phones/tablets
app.use((req, res, next) => {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i.test(ua);
  if (isMobile) {
    if (req.path === '/' || req.path === '/index.html') {
      return res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
    }
    if (req.path === '/docs' || req.path === '/docs/' || req.path === '/docs/index.html') {
      return res.sendFile(path.join(__dirname, 'public', 'docs', 'mobile.html'));
    }
    if (req.path === '/register' || req.path === '/register.html') {
      return res.sendFile(path.join(__dirname, 'public', 'register-mobile.html'));
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Clean URL routes (no .html suffix needed)
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// --- Data paths (overridable for tests via env) ---
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const PROXY_USERS_FILE = process.env.PROXY_USERS_FILE
  || (fs.existsSync('/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json')
    ? '/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json'
    : path.join(__dirname, 'remote_proxy', 'users.json'));

// --- EC2 sync config (token-site on TC → SCP users.json to EC2 for WS auth) ---
const EC2_HOST = process.env.EC2_HOST || 'ec2-user@52.37.182.24';
const EC2_USERS_PATH = process.env.EC2_USERS_PATH || '/home/ec2-user/cloud-proxy/users.json';
const EC2_SSH_KEY = process.env.EC2_SSH_KEY
  || (fs.existsSync('/home/mint/.ssh/ec2_ed25519.pem') ? '/home/mint/.ssh/ec2_ed25519.pem'
  : '/home/kai/.ssh/id_ed25519');

// --- Startup guard: warn if PROXY_USERS_FILE looks like a local dev path on TC ---
(function startupPathGuard() {
  const onTC = fs.existsSync('/home/mint');
  const expectedTC = '/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json';
  if (onTC && PROXY_USERS_FILE !== expectedTC) {
    console.error(`\n⚠️  [GUARD] PROXY_USERS_FILE = "${PROXY_USERS_FILE}"`);
    console.error(`   Expected on TC: "${expectedTC}"`);
    console.error(`   This will cause users to be lost from the proxy registry!`);
    console.error(`   Fix: set PROXY_USERS_FILE env or ensure the TC path exists.\n`);
  }
  if (onTC && !EC2_SSH_KEY.includes('ec2_ed25519')) {
    console.error(`\n⚠️  [GUARD] EC2_SSH_KEY = "${EC2_SSH_KEY}"`);
    console.error(`   Expected on TC: "/home/mint/.ssh/ec2_ed25519.pem"`);
    console.error(`   EC2 sync will fail with wrong key!\n`);
  }
})();

// --- Service tier definitions ---
// Roles map to cloud proxy RateLimiter:
//   basic:    REST 600/min  (10 req/s),  WS 10 symbols
//   value:    REST 1800/min (30 req/s),  WS 30 symbols  (REST-heavy mid-tier)
//   standard: REST 1800/min (30 req/s),  WS 100 symbols  (was "limited_premium")
//   premium:  REST 6000/min (100 req/s), WS 500 symbols
const TIERS = {
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
 * SCP users.json to EC2 so the WS proxy picks up changes.
 * Fire-and-forget: logs errors but does not block the response.
 */
function syncToEC2() {
  if (process.env.BYPASS_SYNC === 'true') {
    console.log('[Sync] Bypass SCP sync (BYPASS_SYNC=true)');
    return;
  }
  execFile('scp', [
    '-i', EC2_SSH_KEY,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=5',
    PROXY_USERS_FILE,
    `${EC2_HOST}:${EC2_USERS_PATH}`
  ], { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[Sync] SCP to EC2 failed:', err.message, stderr);
    } else {
      console.log('[Sync] users.json synced to EC2');
    }
  });
}

/**
 * Promise-based sync to EC2. Returns {ok, message}.
 */
function syncToEC2Async() {
  if (process.env.BYPASS_SYNC === 'true') {
    console.log('[Sync] Bypass SCP sync (BYPASS_SYNC=true)');
    return Promise.resolve({ ok: true, message: 'Bypassed sync (BYPASS_SYNC=true)' });
  }
  return new Promise((resolve) => {
    execFile('scp', [
      '-i', EC2_SSH_KEY,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      PROXY_USERS_FILE,
      `${EC2_HOST}:${EC2_USERS_PATH}`
    ], { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[Sync] SCP to EC2 failed:', err.message, stderr);
        resolve({ ok: false, message: `SCP failed: ${err.message}` });
      } else {
        console.log('[Sync] users.json synced to EC2');
        resolve({ ok: true, message: 'Synced to EC2' });
      }
    });
  });
}

/**
 * Write proxy users file and sync to EC2.
 */
function writeProxyUsersAndSync(data) {
  writeJSON(PROXY_USERS_FILE, data);
  syncToEC2();
}

async function writeProxyUsersAndSyncAsync(data) {
  const beforeCount = data.users ? data.users.length : 0;
  writeJSON(PROXY_USERS_FILE, data);

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
    const approved = users.find(u => u.username === username.trim() && (!u.phone || u.phone === phone.trim()));
    if (approved) {
      // Look up proxy users.json for token + expiry
      let maskedToken = null, expiresAt = null, role = null;
      try {
        const proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
        const proxyUser = (proxyData.users || []).find(u => u.user_id === approved.username);
        if (proxyUser) {
          const t = proxyUser.token;
          maskedToken = t.slice(0, 6) + '····' + t.slice(-4);
          expiresAt = proxyUser.expires_at;
          role = proxyUser.role;
        }
      } catch (_) {}
      return res.json({ success: true, status: 'approved', message: '已通过！', token: maskedToken, expiry: expiresAt, role });
    }
    return res.json({ success: true, status: 'not_found', message: '未找到注册记录。' });
  }

  const result = { success: true, status: entry.status, message: entry.status === 'pending' ? '审核中，请耐心等待。' : entry.status === 'rejected' ? (entry.reject_reason || '审核未通过，请联系卖家。') : '已通过！' };

  // If approved, look up token + expiry from proxy users.json
  if (entry.status === 'approved') {
    try {
      const proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
      const proxyUser = (proxyData.users || []).find(u => u.user_id === entry.username);
      if (proxyUser) {
        const t = proxyUser.token;
        result.token = t.slice(0, 6) + '····' + t.slice(-4);
        result.expiry = proxyUser.expires_at;
        result.role = proxyUser.role;
      }
    } catch (_) {}
  }

  return res.json(result);
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
app.post('/api/admin/approve', requireAdmin, async (req, res) => {
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
      const syncResult = await syncToEC2Async();
      return res.json({ success: true, message: `已批准 ${entry.username}，Token 已存在${syncResult.ok ? '并已同步' : '但同步失败: ' + syncResult.message}。`, token: existing.token, expiry: existing.expires_at });
    }

    const token = crypto.randomUUID();
    const expiresAt = computeExpiry(tierConfig);

    proxyData.users = proxyData.users.filter(u => u.user_id !== entry.username);
    proxyData.users.push({
      token,
      user_id: entry.username,
      role: tierConfig.role,
      expires_at: expiresAt,
      permissions: perms,
      ...(entry.tier === 'test' && { test_user: true })
    });

    const syncResult = await writeProxyUsersAndSyncAsync(proxyData);

    return res.json({
      success: true,
      message: `已批准 ${entry.username}，Token 已注册${syncResult.ok ? '并同步到数据服务' : '但同步失败: ' + syncResult.message}。`,
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
// ADMIN: Delete a user from all registries (local + proxy + EC2)
// ============================================================
app.post('/api/admin/delete-user', requireAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, message: 'Missing username.' });

  const logs = [];

  // 1. Remove from local approved users
  const users = readJSON(USERS_FILE);
  const userIdx = users.findIndex(u => u.username === username);
  if (userIdx >= 0) {
    users.splice(userIdx, 1);
    writeJSON(USERS_FILE, users);
    logs.push(`Removed from local users.json`);
  }

  // 2. Remove from pending
  const pending = readJSON(PENDING_FILE);
  const pendIdx = pending.findIndex(p => p.username === username);
  if (pendIdx >= 0) {
    pending.splice(pendIdx, 1);
    writeJSON(PENDING_FILE, pending);
    logs.push(`Removed from pending.json`);
  }

  // 3. Remove from proxy users file + sync to EC2
  try {
    let proxyData = { users: [] };
    if (fs.existsSync(PROXY_USERS_FILE)) {
      proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    }
    const before = (proxyData.users || []).length;
    proxyData.users = (proxyData.users || []).filter(u => u.user_id !== username);
    const after = proxyData.users.length;

    if (before > after) {
      const syncResult = await writeProxyUsersAndSyncAsync(proxyData);
      logs.push(`Removed from proxy registry (${before}→${after} users)`);
      logs.push(syncResult.ok ? 'EC2 sync OK' : `EC2 sync failed: ${syncResult.message}`);
    } else {
      logs.push('Not found in proxy registry');
    }
  } catch (err) {
    logs.push(`Proxy registry error: ${err.message}`);
  }

  if (logs.length === 0) {
    return res.status(404).json({ success: false, message: `User "${username}" not found in any registry.` });
  }

  return res.json({ success: true, message: `Deleted "${username}".`, logs });
});

// ============================================================
// ADMIN: Verify sync — compare TC proxy ↔ EC2 user lists
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

  // 2. Read EC2 users via SSH
  if (process.env.BYPASS_SYNC === 'true') {
    return res.json({ success: true, ...result, message: 'EC2 check skipped (BYPASS_SYNC=true)' });
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
    return res.json({ success: false, tc: result.tc, message: `EC2 SSH failed: ${err.message}` });
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
// ADMIN: Force reload users.json and sync to ThinkCentre
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

  // 2. Sync to ThinkCentre
  log('Syncing to ThinkCentre...');
  const syncResult = await syncToEC2Async();
  log(syncResult.ok ? '✓ ' + syncResult.message : '✗ ' + syncResult.message);

  return res.json({
    success: syncResult.ok,
    userCount: (proxyData.users || []).length,
    logs
  });
});

// ============================================================
// ORIGINAL: Generate token (for approved users)
// ============================================================
app.post('/api/generate-token', async (req, res) => {
  const { username, phone } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: 'Username is required.' });
  }

  const localUsers = readJSON(USERS_FILE);
  const validCustomer = localUsers.find(u => u.username === username && (!u.phone || u.phone === phone));

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

    const syncResult = await writeProxyUsersAndSyncAsync(proxyData);

    return res.json({ success: true, token, expiry: expiresAt, role: newProxyUser.role, syncOk: syncResult.ok });
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
const PROXY_REST_URL = process.env.PROXY_REST_URL || 'http://100.82.194.120:8766';
const PROXY_RT_URL   = process.env.PROXY_RT_URL   || 'https://rt-api.leandata.uk';
const PROXY_WS_HOST  = process.env.PROXY_WS_HOST  || '100.82.194.120';
const PROXY_WS_PORT  = process.env.PROXY_WS_PORT  || 8765;

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
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${PROXY_REST_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return { ok: resp.ok, latencyMs: Date.now() - start };
  } catch (_) {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

// Probe WS proxy — TCP connect to check port is open
async function probeWs() {
  const net = require('net');
  const start = Date.now();
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(5000);
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

// Probe RT API (EC2 via Cloudflare) — returns { ok, latencyMs }
function probeRt() {
  const start = Date.now();
  const isHttps = PROXY_RT_URL.startsWith('https');
  const lib = isHttps ? require('https') : require('http');
  const agent = isHttps ? _rtHttpsAgent : _rtHttpAgent;
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve({ ok, latencyMs: Date.now() - start }); } };
    try {
      const req = lib.get(`${PROXY_RT_URL}/health`, { agent, timeout: 10000 }, res => {
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

// GET /api/status — overall + per-component live status
app.get('/api/status', async (_req, res) => {
  try {
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
      addIncident('REST API', 'major', 'REST proxy unreachable', `Health probe failed after ${restProbe.latencyMs}ms. Cloudflare → ThinkCentre path affected.`);
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

    res.json({
      overall,
      components: {
        rest: {
          name: 'REST API',
          route: 'api.leandata.uk · Cloudflare → ThinkCentre',
          status: restStatus,
          latencyMs: restProbe.latencyMs,
        },
        rt: {
          name: 'RT API',
          route: 'rt-api.leandata.uk · Cloudflare → EC2',
          status: rtStatus,
          latencyMs: rtProbe.latencyMs,
        },
        ws: {
          name: 'WebSocket stream',
          route: `ws://${PROXY_WS_HOST}:${PROXY_WS_PORT} · EC2 direct`,
          status: wsStatus,
          latencyMs: wsProbe.latencyMs,
        },
      },
      timestamp: new Date().toISOString(),
    });
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
app.post('/api/incidents', (req, res) => {
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

const PROXY_LOCAL = process.env.PROXY_REST_URL || 'http://100.82.194.120:8766';

// Resolve username → token from proxy users.json
function resolveUserToken(username) {
  try {
    const proxyData = JSON.parse(fs.readFileSync(PROXY_USERS_FILE, 'utf8'));
    const user = (proxyData.users || []).find(u => u.user_id === username);
    return user ? user.token : null;
  } catch (_) { return null; }
}

// GET/POST /api/usage/audit — proxy to cloud proxy audit endpoint (auth by username)
app.all('/api/usage/audit', async (req, res) => {
  try {
    const username = req.query.username || req.body?.username || '';
    if (!username) return res.status(400).json({ error: 'username required' });
    const token = resolveUserToken(username);
    if (!token) return res.status(404).json({ error: 'User not found' });

    const params = new URLSearchParams(req.query);
    params.delete('username');
    const qs = params.toString();
    const url = `${PROXY_LOCAL}/v1/admin/audit${qs ? '?' + qs : ''}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('Usage audit proxy error:', err);
    res.status(502).json({ error: 'Failed to reach proxy' });
  }
});

// GET/POST /api/usage/stats — proxy to cloud proxy stats endpoint (auth by username)
app.all('/api/usage/stats', async (req, res) => {
  try {
    const username = req.query.username || req.body?.username || '';
    if (!username) return res.status(400).json({ error: 'username required' });
    const token = resolveUserToken(username);
    if (!token) return res.status(404).json({ error: 'User not found' });

    const params = new URLSearchParams(req.query);
    params.delete('username');
    const qs = params.toString();
    const url = `${PROXY_LOCAL}/v1/admin/stats${qs ? '?' + qs : ''}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('Usage stats proxy error:', err);
    res.status(502).json({ error: 'Failed to reach proxy' });
  }
});

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

module.exports = { app, TIERS, syncToEC2, computeExpiry, readJSON, writeJSON, PROXY_USERS_FILE, EC2_HOST, EC2_USERS_PATH, EC2_SSH_KEY };
