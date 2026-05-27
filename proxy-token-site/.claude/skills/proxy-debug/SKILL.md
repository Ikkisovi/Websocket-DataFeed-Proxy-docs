---
name: proxy-debug
description: "Step-by-step diagnostic and troubleshooting workflows for the Alpaca Data Proxy — covers verifying registry integrity (users.json), smoke testing WebSocket and REST endpoints, tracing gRPC/session errors in logs, and deploying hotfixes."
argument-hint: "[subcommand: check-registry|smoke-test|trace-error|deploy-fix]"
---

# Alpaca Data Proxy — Debugging & Diagnostics Skill

Use this skill to diagnose, trace, and repair issues across the hybrid proxy stack, specifically focusing on WebSocket connection failures, registry wipes, and 500 errors.

---

## 1. Step 1: Check User Registry Integrity (`users.json`)

One of the most common causes of authentication failures (e.g., WS handshake succeeding but connection closing ~4 seconds later) is **registry destruction** or **sync mismatch**. Developer environments or legacy scripts can accidentally overwrite the active registry with an empty or outdated `users.json` template via SCP.

### 1.1 Symptoms of Registry Issues
* Clients connect to the WebSocket, complete the handshake (101 Switching Protocols), and then get forcibly closed ~4.3 seconds later with close code `1008` (Policy Violation) and no reason.
* The remote logs on EC2 show: `[Cloud] AUTH FAILED: invalid token from <IP> (token=..., mode=...)`.

### 1.2 Diagnostic Commands
Check if the user token exists on the local ThinkCentre registry, the remote EC2 server registry, and the active Docker container volume.

```bash
# A. Check registry on ThinkCentre (Local Token Site Host)
cat /home/mint/proxy-token-site/remote_proxy/users.json | grep -B 2 -A 10 "username_or_token"

# B. Check registry on remote EC2 host
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "cat /home/ec2-user/cloud-proxy/users.json" | grep -B 2 -A 10 "username_or_token"

# C. Check registry inside the running EC2 Docker container
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "sudo docker exec cloud-proxy-alpaca-cloud-proxy-1 cat /app/users.json"
```

### 1.3 Resolution & Restoration
If the registry has been wiped or is missing key active users:
1. Locate historical backup files on the EC2 host:
   ```bash
   ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "ls -l /home/ec2-user/cloud-proxy/users.json*"
   ```
2. Restore or merge missing active users from backups (e.g., `users.json.bak.1779357553`).
3. Make sure the local ThinkCentre token server is also restored to prevent future regression. The local Node server will automatically auto-sync changes to EC2 upon updates when using the corrected paths:
   * Local registry path: `/home/kai/product-apim/proxy-token-site/remote_proxy/users.json`
   * Local SSH Key: `/home/kai/.ssh/id_ed25519`
4. Confirm hot-reloading inside the container logs:
   `[Auth] users.json modified externally, reloading registry (mtime=...)`

---

## 2. Step 2: Smoke Testing Endpoints

Execute smoke tests directly against the proxy hosts to ensure real-time and historical channels are operating correctly.

### 2.1 WebSocket Connection Smoke Tests (EC2 WS Proxy)
Connect to the WS port (default `8767`) and send an authentication payload.

```bash
# Use a WebSocket tool or test script to connect:
# Target: ws://52.37.182.24:8767/stream/news (or /stream/options)

# Send JSON Auth Frame:
{"action":"auth","token":"USER_TOKEN_HERE"}

# Expected Successful Auth Response:
# Connection stays open, and streaming begins on subscription.
```

### 2.2 REST Endpoints Smoke Tests (ThinkCentre or EC2 REST)
Test EOD, option history, and contracts lookups using standard `curl` commands with bearer tokens.

```bash
# Smoke Test options EOD history (POST)
curl -s -X POST -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbol": "AAPL", "start": "2024-01-02", "end": "2024-01-05", "expiration": "2024-01-19", "strike": "180", "right": "C"}' \
  http://52.37.182.24:8768/v1/history/options/eod

# Smoke Test options contracts discovery (POST)
curl -s -X POST -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"underlying_symbols": "AAPL", "status": "active", "limit": 1}' \
  http://52.37.182.24:8768/v1/options/contracts
```

---

## 3. Step 3: Tracing Errors (`audit.jsonl` & Docker Logs)

When an endpoint returns a `500 Internal Server Error` or fails unexpectedly, trace the error using logs on the remote EC2 server.

### 3.1 Tracing the Audit Log (`audit.jsonl`)
The audit log records every inbound HTTP/WS request, including user ID, response status code, and execution time.

```bash
# Search remote audit logs for 500 Internal Server Errors
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "tail -n 1000 /home/ec2-user/cloud-proxy/audit.jsonl | grep '\"status\": 500'"

# Sample Output:
# {"event": "http_request", "endpoint": "/v1/history/options/eod", "user_id": "Xiaosu", "status": 500, "elapsed_ms": 372}
```

### 3.2 Tracing Docker Container Logs
Locate the container logs to find traceback exceptions.

```bash
# Fetch container logs tail
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "sudo docker logs --tail 200 cloud-proxy-alpaca-cloud-proxy-1"

# Search for options-related errors (ThetaData / gRPC session conflicts)
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "sudo docker logs cloud-proxy-alpaca-cloud-proxy-1 2>&1 | grep -A 5 -i 'EOD error'"
```

#### Diagnostic: ThetaData Session Collisions
If the logs contain:
`details = "Invalid session ID. This can occur if more than one terminal is running..."`
* **Root Cause**: ThetaData strictly enforces **one active session per subscription key**. If the same credentials are used concurrently by another terminal/script (e.g. a developer running direct local scripts instead of routing through the proxy), the remote container's session gets invalidated immediately.
* **Remediation**: Wrap the endpoint's lookups in the proxy's dual-retry automatic recovery block.

---

## 4. Step 4: Deploying Fixes and Verifying

When a bug is diagnosed and patched locally, deploy the hotfix to the remote EC2 server.

### 4.1 Sync Code File (`alpaca_cloud_proxy.py`)
Deploy the modified proxy Python code to the EC2 server:

```bash
scp -o StrictHostKeyChecking=no -i ~/.ssh/id_ed25519 \
  remote_proxy/alpaca_cloud_proxy.py \
  ec2-user@52.37.182.24:/home/ec2-user/cloud-proxy/alpaca_cloud_proxy.py
```

### 4.2 Restart Remote Container
The python script is cached in-memory inside the container, so you **must restart the container** to pick up code changes:

```bash
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "sudo docker restart cloud-proxy-alpaca-cloud-proxy-1"
```

### 4.3 Post-Deployment Verification
Verify the fix using `curl` while bypassing any persistent L1/L2 caches to force a live upstream test:
1. **Trigger cache miss**: Execute a query with a slightly different parameter (e.g., a different strike price or start date) that was not queried previously.
2. **Verify live response**: Check the `elapsed_ms` (which should be >50ms for a real lookup) and ensure the status is `200` with correct data rows.
3. **Verify log recovery**: Verify that no new `EOD error 500` logs are generated, and check that a new client session logs `[ThetaData] Client initialized successfully` on session resets.
