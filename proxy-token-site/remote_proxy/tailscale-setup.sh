#!/bin/bash
# ============================================================
# Tailscale Serve + HTTPS 部署脚本 (ThinkCentre)
#
# 前提条件（需在 Tailscale Admin Console 手动开启）:
#   1. 启用 MagicDNS: https://login.tailscale.com/admin/dns
#   2. 启用 HTTPS Certificates: https://login.tailscale.com/admin/settings/features
#   3. 启用 Serve: https://login.tailscale.com/f/serve?node=n9h4qQuh9T11CNTRL
#
# 运行方式:
#   chmod +x tailscale-setup.sh
#   ./tailscale-setup.sh
# ============================================================

set -e

THINKCENTRE_NAME="mint-thinkcentre-m900"
PROXY_HTTP_PORT="8768"
WS_PORT="8767"

echo "========================================"
echo "Tailscale Serve + HTTPS Setup"
echo "========================================"

# 1. 检查 tailscale 版本
echo ""
echo "[1/6] Checking Tailscale version..."
tailscale version | head -1

# 2. 检查 serve 是否已启用
echo ""
echo "[2/6] Checking if serve is enabled on tailnet..."
if tailscale serve status 2>&1 | grep -q "Serve is not enabled"; then
    echo "  ❌ Serve is NOT enabled on your tailnet."
    echo ""
    echo "  请先在浏览器中访问以下链接启用 Serve:"
    echo "  https://login.tailscale.com/f/serve?node=n9h4qQuh9T11CNTRL"
    echo ""
    echo "  同时确保在 Admin Console 中启用了:"
    echo "  - MagicDNS: https://login.tailscale.com/admin/dns"
    echo "  - HTTPS Certificates: https://login.tailscale.com/admin/settings/features"
    exit 1
fi

echo "  ✅ Serve is enabled"

# 3. 配置 serve: HTTPS → HTTP 8768 (REST)
echo ""
echo "[3/6] Configuring tailscale serve for REST API (:8768)..."
tailscale serve --reset 2>/dev/null || true
tailscale serve --bg "http://localhost:${PROXY_HTTP_PORT}"
echo "  ✅ REST API served on https://${THINKCENTRE_NAME}.<tailnet>.ts.net"

# 4. 配置 funnel（需要 Plus 计划，免费版跳过）
echo ""
echo "[4/6] Checking funnel availability..."
if tailscale funnel status 2>&1 | grep -q "not enabled\|requires\|upgrade"; then
    echo "  ⚠️  Funnel requires Tailscale Plus plan ($6/month)"
    echo "     Current: Free plan — funnel not available"
    echo "     Serve (internal Tailnet only) is working."
else
    echo "  ✅ Funnel is available"
    # tailscale funnel --bg "http://localhost:${PROXY_HTTP_PORT}"
fi

# 5. 获取 HTTPS 证书
echo ""
echo "[5/6] Fetching HTTPS certificate..."
TAILNET=$(tailscale status --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('CurrentTailnet',{}).get('Name',''))" 2>/dev/null || echo "")

if [ -n "$TAILNET" ]; then
    DOMAIN="${THINKCENTRE_NAME}.${TAILNET}.ts.net"
    CERT_DIR="/home/mint/.tailscale-certs"
    mkdir -p "$CERT_DIR"

    echo "  Domain: $DOMAIN"
    echo "  Cert dir: $CERT_DIR"

    if tailscale cert "$CERT_DIR/$DOMAIN" 2>/dev/null; then
        echo "  ✅ Certificate fetched successfully"
        ls -la "$CERT_DIR/"
    else
        echo "  ⚠️  Certificate fetch failed (MagicDNS HTTPS may not be enabled yet)"
        echo "     Visit: https://login.tailscale.com/admin/settings/features"
    fi
else
    echo "  ⚠️  Could not determine tailnet name"
fi

# 6. 验证
echo ""
echo "[6/6] Verification..."
echo ""
echo "  Tailscale serve status:"
tailscale serve status 2>/dev/null || echo "    (not available)"

echo ""
echo "========================================"
echo "Setup Complete"
echo "========================================"
echo ""
echo "Internal Tailnet access (free):"
echo "  https://${THINKCENTRE_NAME}.<tailnet>.ts.net/v1/history/bars"
echo ""
echo "Public access (requires Plus + Funnel):"
echo "  https://${THINKCENTRE_NAME}.<tailnet>.ts.net (after 'tailscale funnel on')"
echo ""
echo "Current public access (unchanged):"
echo "  http://52.37.182.24:8768/v1/history/bars"
echo ""
echo "========================================"
