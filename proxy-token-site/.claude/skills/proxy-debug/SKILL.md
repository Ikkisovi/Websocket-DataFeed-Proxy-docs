---
name: proxy-debug
description: "Step-by-step diagnostic and troubleshooting workflows for the Alpaca Data Proxy — covers verifying registry integrity (users.json), smoke testing WebSocket and REST endpoints, tracing gRPC/session errors in logs, and deploying hotfixes."
argument-hint: "[subcommand: check-registry|smoke-test|trace-error|deploy-fix]"
---

# Alpaca Data Proxy — Debugging & Diagnostics Skill

Diagnose, trace, and repair issues across the hybrid proxy stack — WS connection failures, registry mismatches, auth errors, and 500s.

## Architecture quick refresher

```
Token Site (ThinkCentre, port 3000)
  → writes users.json to proxy container's volume mount path
  → SCPs users.json to EC2 for WS proxy

REST proxy (ThinkCentre, port 8768 via Cloudflare → api.leandata.uk)
  → reads users.json from docker volume mount
  → TC host path: /home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json
  → container path: /app/users.json

WS proxy (EC2, port 8767 direct to 52.37.182.24)
  → correct path: ws://52.37.182.24:8767/stream (NOT /stocks)
  → EC2 users.json: /home/ec2-user/cloud-proxy/users.json
  → responds in msgpack for stocks/options channels
  → responds in JSON for crypto/news channels

Port mapping (docker):
  8765 (container) → 8767 (host) = WS
  8766 (container) → 8768 (host) = REST
```

---

## 1. Check User Registry Integrity (`users.json`)

**The #1 cause of "Invalid token"**: token-site writes to wrong file path.

### 1.1 Three places to check

```bash
# A. Token site's data/users.json (local approved users)
ssh mint@100.70.107.106 "cat /home/mint/proxy-token-site/data/users.json | python3 -c \"import sys,json; [print(u['username']) for u in json.load(sys.stdin)]\""

# B. What token-site writes (PROXY_USERS_FILE) — MUST match docker volume mount
ssh mint@100.70.107.106 "cat /home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json | python3 -c \"import sys,json; d=json.load(sys.stdin); print([u['user_id'] for u in d.get('users',[])])\""

# C. What the TC proxy container actually reads
ssh mint@100.70.107.106 "docker exec ec2-primary-backup-alpaca-cloud-proxy-1 cat /app/users.json | python3 -c \"import sys,json; d=json.load(sys.stdin); print([u['user_id'] for u in d.get('users',[])])\""

# D. EC2 WS proxy
ssh mint@100.70.107.106 "ssh -i /home/mint/.ssh/ec2_ed25519.pem ec2-user@52.37.182.24 'cat /home/ec2-user/cloud-proxy/users.json | python3 -c \"import sys,json; d=json.load(sys.stdin); print([u[\\\"user_id\\\"] for u in d.get(\\\"users\\\",[])])\"'"
```

**If B ≠ C**: PROXY_USERS_FILE in server.js points to wrong path. The docker container mounts from `/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json`, NOT `remote_proxy/users.json`.

### 1.2 Hot-reload verification

The TC proxy container has a background watcher. After users.json changes:
```
[Auth] users.json modified externally, reloading registry (mtime=...)
```
If this doesn't appear within 30s, restart the container:
```bash
ssh mint@100.70.107.106 "docker restart ec2-primary-backup-alpaca-cloud-proxy-1"
```

---

## 2. Smoke Test — Full End-to-End

### 2.1 Register → Approve → Verify sync

```bash
# Register
curl -s -X POST http://localhost:3000/api/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"debugtest","phone":"13800000000","tier":"standard"}'
# → {"success":true, "id":"<ID>"}

# Admin login + approve
ADMIN=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s -X POST http://localhost:3000/api/admin/approve \
  -H 'Content-Type: application/json' \
  -H "X-Admin-Token: $ADMIN" \
  -d '{"id":"<ID>"}'
# → "已批准...并同步到数据服务" = success
# → "同步失败" = SCP failure, check SSH key
```

### 2.2 REST auth test

```bash
TOKEN="<from-approve-step>"

# Health check (always works)
curl -s http://localhost:8768/health

# Auth test — "Missing required fields" = token passed ✅
#            "Invalid token" = users.json mismatch ❌
curl -s -X POST http://localhost:8768/v1/history/bars \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"symbol\":\"AAPL\",\"start\":\"2026-05-26\",\"end\":\"2026-05-27\"}"
```

### 2.3 WS auth test

```bash
# MUST use /stream path, NOT /stocks
python3 -c "
import asyncio, json, websockets, msgpack
async def test():
    async with websockets.connect('ws://52.37.182.24:8767/stream') as ws:
        await ws.send(json.dumps({'action':'auth','token':'$TOKEN'}))
        raw = await asyncio.wait_for(ws.recv(), 5)
        print('AUTH:', msgpack.unpackb(raw, raw=False))
        await ws.send(json.dumps({'action':'subscribe','trades':['AAPL']}))
        raw = await asyncio.wait_for(ws.recv(), 5)
        print('DATA:', msgpack.unpackb(raw, raw=False))
asyncio.run(test())
"
# Expected: AUTH: [{'T': 'success', 'msg': 'authenticated'}]
```

---

## 3. Known Gotchas (learned the hard way)

### 3.1 WS path is `/stream` not `/stocks`
The EC2 WS proxy endpoints:
- `ws://52.37.182.24:8767/stream` (stocks)
- `ws://52.37.182.24:8767/stream/options`
- `ws://52.37.182.24:8767/stream/crypto`
- `ws://52.37.182.24:8767/stream/news`
- `ws://52.37.182.24:8767/stream/overnight`
- `ws://52.37.182.24:8767/stream/test`

### 3.2 WS returns msgpack (not JSON)
Stocks/options channels use msgpack. Decode with `msgpack.unpackb(raw, raw=False)`.
Crypto/news channels return JSON.

### 3.3 SSH key on TC is `ec2_ed25519.pem`
NOT `/home/kai/.ssh/id_ed25519`. TC path: `/home/mint/.ssh/ec2_ed25519.pem`

### 3.4 PROXY_USERS_FILE must match docker volume mount
Token site writes to `PROXY_USERS_FILE`. Docker container reads from its volume mount:
- Container: `/app/users.json`
- TC host mount source: `/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json`
- Common mistake: writing to `remote_proxy/users.json` (different file!)

> **⚠️ INCIDENT (2026-05-27):** Commit `62537c230` accidentally changed `PROXY_USERS_FILE` to `remote_proxy/users.json` and `EC2_SSH_KEY` to `/home/kai/.ssh/id_ed25519` — local dev paths that leaked to production. Result: 30 users lost from proxy registry, all got 401 errors, EC2 sync broken. See gotcha 3.7 for the pre-deploy guard that prevents this.

### 3.5 Rsync puts files at destination root
`rsync file.jsx mint@tc:/home/mint/proxy-token-site/` puts it at project root.
Need: `rsync file.jsx mint@tc:/home/mint/proxy-token-site/public/`

### 3.6 WS connection closes immediately (1000 OK)
Checklist:
1. Wrong path? Must be `/stream` not `/stocks`
2. Token not on EC2? Check EC2 users.json
3. EC2 proxy needs restart? `docker restart cloud-proxy-alpaca-cloud-proxy-1`

### 3.7 Pre-deploy guard: check hardcoded paths in server.js
**Before deploying server.js to ThinkCentre**, grep for these lines and verify they use TC paths, NOT local dev paths:

```bash
# Run this BEFORE every rsync of server.js to TC:
ssh mint@100.70.107.106 "grep -n 'PROXY_USERS_FILE\|EC2_SSH_KEY' /home/mint/proxy-token-site/server.js"
```

**Expected (correct for TC):**
```
const PROXY_USERS_FILE = ... || '/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json'
const EC2_SSH_KEY = ... || '/home/mint/.ssh/ec2_ed25519.pem'
```

**WRONG (local dev paths — will break auth + sync):**
```
const PROXY_USERS_FILE = ... || path.join(__dirname, 'remote_proxy', 'users.json')
const EC2_SSH_KEY = ... || '/home/kai/.ssh/id_ed25519'
```

The `path.join(__dirname, 'remote_proxy', 'users.json')` fallback is for LOCAL testing only. On TC, `__dirname` resolves to `/home/mint/proxy-token-site/` and `remote_proxy/users.json` is a stale test file, NOT the docker volume mount.

### 3.8 Built-in prevention guards (added 2026-05-27)

**Startup guard:** server.js now detects if it's running on TC (`/home/mint` exists) and warns loudly if `PROXY_USERS_FILE` or `EC2_SSH_KEY` point to wrong paths. Check server logs after restart.

**Post-write verification:** After every write to `PROXY_USERS_FILE`, reads back and verifies user count matches. Returns `ok: false` if mismatch detected.

**Sync-verify endpoint:**
```bash
# Check TC ↔ EC2 user list diff (requires admin token)
curl -s -H "X-Admin-Token: $ADMIN" http://localhost:3000/api/admin/sync-verify | python3 -m json.tool
# → { match: true/false, tcCount, ec2Count, missingOnEC2: [...], extraOnEC2: [...] }
```

**Delete user endpoint:**
```bash
# Remove a user from all registries (local + proxy + EC2)
curl -s -X POST http://localhost:3000/api/admin/delete-user \
  -H 'Content-Type: application/json' -H "X-Admin-Token: $ADMIN" \
  -d '{"username":"someuser"}'
```

**E2E test:** `node test_e2e.js` runs full sync check → token health → register all tiers → permission matrix → cleanup.

---

## 4. Tracing Errors

### 4.1 EC2 container logs
```bash
ssh mint@100.70.107.106 "ssh -i /home/mint/.ssh/ec2_ed25519.pem ec2-user@52.37.182.24 'docker logs --tail 50 cloud-proxy-alpaca-cloud-proxy-1 2>&1'"
```

### 4.2 TC proxy container logs
```bash
ssh mint@100.70.107.106 "docker logs --tail 50 ec2-primary-backup-alpaca-cloud-proxy-1 2>&1"
```

### 4.3 Token site logs
```bash
ssh mint@100.70.107.106 "tail -20 /tmp/token-site.log"
```

### 4.4 Audit log
```bash
ssh mint@100.70.107.106 "ssh -i /home/mint/.ssh/ec2_ed25519.pem ec2-user@52.37.182.24 'tail -20 /home/ec2-user/cloud-proxy/audit.jsonl'"
```

---

## 5. Deploy Fixes

### 5.1 Token site (JSX + server.js)
JSX files are compiled client-side by Babel — no server restart needed, just rsync + refresh.
server.js changes need restart:
```bash
rsync -avz server.js mint@100.70.107.106:/home/mint/proxy-token-site/server.js
ssh mint@100.70.107.106 'kill $(pgrep -f "node.*server.js"); PATH=/home/mint/.nvm/versions/node/v20.20.2/bin:$PATH nohup node /home/mint/proxy-token-site/server.js > /tmp/token-site.log 2>&1 &'
```

### 5.2 EC2 WS proxy code
```bash
scp -i /home/mint/.ssh/ec2_ed25519.pem remote_proxy/alpaca_cloud_proxy.py ec2-user@52.37.182.24:/home/ec2-user/cloud-proxy/alpaca_cloud_proxy.py
ssh mint@100.70.107.106 "ssh -i /home/mint/.ssh/ec2_ed25519.pem ec2-user@52.37.182.24 'docker restart cloud-proxy-alpaca-cloud-proxy-1'"
```
