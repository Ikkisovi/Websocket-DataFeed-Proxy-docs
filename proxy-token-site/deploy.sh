#!/bin/bash
# Deploy proxy-token-site to EC2
# Usage: bash deploy.sh

set -e

EC2="ec2-user@52.37.182.24"
KEY="$HOME/.ssh/id_ed25519"
REMOTE_DIR="/home/ec2-user/proxy-token-site"

echo "=== 1/3 Packing local files ==="
cd /home/kai/product-apim/proxy-token-site
tar czf /tmp/proxy-token-site.tar.gz --exclude=node_modules --exclude=.git .
echo "Packed OK"

echo "=== 2/3 Uploading to EC2 ==="
scp -i "$KEY" /tmp/proxy-token-site.tar.gz "$EC2:/tmp/"
echo "Uploaded OK"

echo "=== 3/3 Deploying on EC2 ==="
ssh -i "$KEY" "$EC2" "bash -lc '
  cd $REMOTE_DIR
  cp server.js server.js.bak.\$(date +%s) 2>/dev/null || true
  tar xzf /tmp/proxy-token-site.tar.gz
  echo \"[]\" > data/pending.json
  echo Extract OK
'"

# Restart via PM2 (actual process manager; systemd unit is broken on this host)
ssh -i "$KEY" "$EC2" "bash -lc '
  pm2 reload proxy-token-site 2>/dev/null || pm2 start /home/ec2-user/proxy-token-site/server.js --name proxy-token-site
  sleep 1
  pm2 status proxy-token-site
'"

echo "=== Health check ==="
ssh -i "$KEY" "$EC2" "
  curl -s -o /dev/null -w 'index:    %{http_code}\n' http://localhost:3000/
  curl -s -o /dev/null -w 'register: %{http_code}\n' http://localhost:3000/register.html
  curl -s -o /dev/null -w 'admin:    %{http_code}\n' http://localhost:3000/admin.html
"

echo "=== Done ==="
echo "Register: http://52.37.182.24:3000/register.html"
echo "Token:    http://52.37.182.24:3000/"
echo "Admin:    http://52.37.182.24:3000/admin.html"
echo "Password: admin123 (change via ADMIN_PASSWORD env)"
