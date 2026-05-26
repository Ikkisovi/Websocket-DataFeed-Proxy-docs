#!/usr/bin/env bash
# add_free_key.sh — Add a free Alpaca API key to the ThinkCentre cloud proxy.
#
# Usage:
#   ./add_free_key.sh <API_KEY> <API_SECRET> [--slot N]
#
# Steps:
#   1. Append ALPACA_FREE_KEY_N / ALPACA_FREE_SECRET_N to ThinkCentre .env
#   2. Ensure docker-compose.cloud-proxy.yml has the matching env entries
#   3. SCP updated compose file + alpaca_key_pool.py to ThinkCentre
#   4. Recreate the container (--force-recreate picks up new env vars)
#   5. Verify /health shows the new key in the pool
#
# --slot N: force a specific slot (1-10). Omit to auto-detect next free slot.

set -euo pipefail

THINKCENTRE_HOST="root@100.70.107.106"
THINKCENTRE_DIR="/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

KEY="${1:?Usage: add_free_key.sh <API_KEY> <API_SECRET> [--slot N]}"
SECRET="${2:?Usage: add_free_key.sh <API_KEY> <API_SECRET> [--slot N]}"
SLOT=""

# Parse --slot
shift 2
while [[ $# -gt 0 ]]; do
    case "$1" in
        --slot) SLOT="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# Auto-detect next free slot if not specified
if [[ -z "$SLOT" ]]; then
    EXISTING=$(ssh "$THINKCENTRE_HOST" "grep -oP 'ALPACA_FREE_KEY_\K[0-9]+' '$THINKCENTRE_DIR/.env' | sort -n | tail -1" 2>/dev/null || echo "0")
    SLOT=$((EXISTING + 1))
fi

if [[ "$SLOT" -lt 1 || "$SLOT" -gt 10 ]]; then
    echo "Error: slot must be 1-10, got $SLOT"
    exit 1
fi

KEYVAR="ALPACA_FREE_KEY_${SLOT}"
SECRETVAR="ALPACA_FREE_SECRET_${SLOT}"
LIMITVAR="ALPACA_FREE_KEY_${SLOT}_LIMIT"

# Check if slot already exists
EXIST=$(ssh "$THINKCENTRE_HOST" "grep -c '^${KEYVAR}=' '$THINKCENTRE_DIR/.env'" 2>/dev/null || echo "0")
if [[ "$EXIST" -gt 0 ]]; then
    echo "Warning: slot $SLOT already exists in .env. Overwriting."
    ssh "$THINKCENTRE_HOST" "sed -i 's|^${KEYVAR}=.*|${KEYVAR}=${KEY}|; s|^${SECRETVAR}=.*|${SECRETVAR}=${SECRET}|' '$THINKCENTRE_DIR/.env'"
else
    ssh "$THINKCENTRE_HOST" "echo -e '\n${KEYVAR}=${KEY}\n${SECRETVAR}=${SECRET}' >> '$THINKCENTRE_DIR/.env'"
fi

echo "✓ Added slot $SLOT to ThinkCentre .env"

# Ensure docker-compose.cloud-proxy.yml has this slot
COMPOSE="${LOCAL_DIR}/docker-compose.cloud-proxy.yml"
if ! grep -q "${KEYVAR}" "$COMPOSE"; then
    echo "Adding $KEYVAR to docker-compose.cloud-proxy.yml..."
    # Insert after the last existing free key block
    python3 -c "
import re
with open('$COMPOSE') as f:
    content = f.read()
# Find last ALPACA_FREE_KEY_N_LIMIT line and insert after it
pattern = r'(- ALPACA_FREE_KEY_[0-9]+_LIMIT=[0-9]+)'
matches = list(re.finditer(pattern, content))
if matches:
    last = matches[-1]
    insert_after = last.end()
    new_block = '''
      - ${KEYVAR}=\${${KEYVAR}}
      - ${SECRETVAR}=\${${SECRETVAR}}
      - ${LIMITVAR}=200'''
    content = content[:insert_after] + new_block + content[insert_after:]
    with open('$COMPOSE', 'w') as f:
        f.write(content)
    print(f'  Added ${KEYVAR} block to compose file')
else:
    print('  ERROR: No existing free key block found in compose file')
    exit(1)
"
fi

# SCP updated files to ThinkCentre
echo "Deploying to ThinkCentre..."
scp -q "$COMPOSE" "$LOCAL_DIR/alpaca_key_pool.py" "${THINKCENTRE_HOST}:${THINKCENTRE_DIR}/"

# Recreate container to pick up new env vars
echo "Recreating container..."
ssh "$THINKCENTRE_HOST" "cd '$THINKCENTRE_DIR' && docker compose -f docker-compose.cloud-proxy.yml up -d --force-recreate 2>&1 | tail -3"

# Wait for container to be ready
sleep 10

# Verify
echo ""
echo "=== Pool after adding key $SLOT ==="
ssh "$THINKCENTRE_HOST" "curl -s http://localhost:8768/health" | python3 -m json.tool 2>/dev/null || echo "(health check failed — container may still be starting)"

echo ""
echo "Done. Free key $SLOT added. Current .env free keys:"
ssh "$THINKCENTRE_HOST" "grep 'ALPACA_FREE_KEY_[0-9]=' '$THINKCENTRE_DIR/.env' | sed 's/=.*/  (slot present)/'"
