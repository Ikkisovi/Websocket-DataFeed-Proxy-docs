#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(mktemp -d)"
trap 'find "$tmp_dir" -depth -mindepth 1 -delete 2>/dev/null || true; rmdir "$tmp_dir" 2>/dev/null || true' EXIT

source_repo="$tmp_dir/source"
bare_repo="$tmp_dir/source.git"
site_dir="$tmp_dir/proxy-token-site"
mkdir -p "$source_repo/proxy-token-site/public" "$site_dir/public" "$tmp_dir/bin"

printf '<script type="text/babel" src="docs-site.jsx"></script>\n' \
  >"$source_repo/proxy-token-site/public/index.html"
printf 'function DocsSite() { return null; }\n' \
  >"$source_repo/proxy-token-site/public/docs-site.jsx"
printf 'function TokenPage() { return null; }\n' \
  >"$source_repo/proxy-token-site/public/token-page.jsx"
printf 'old\n' >"$site_dir/public/old.txt"

git -C "$source_repo" init -q
git -C "$source_repo" config user.name "CI Contract"
git -C "$source_repo" config user.email "ci@example.invalid"
git -C "$source_repo" add .
git -C "$source_repo" commit -qm "test: seed site"
git -C "$source_repo" branch -M main
git clone -q --bare "$source_repo" "$bare_repo"
commit_sha="$(git -C "$source_repo" rev-parse HEAD)"

cat >"$tmp_dir/site-deploy.env" <<EOF
LEANDATA_SITE_REPO_URL=$bare_repo
LEANDATA_SITE_REPOSITORY_MIRROR=$tmp_dir/mirror.git
LEANDATA_SITE_RELEASE_ROOT=$tmp_dir/releases
LEANDATA_SITE_DIR=$site_dir
LEANDATA_SITE_DEPLOY_LOCK_FILE=$tmp_dir/run/site-deploy.lock
LEANDATA_SITE_DEPLOY_LOG_DIR=$tmp_dir/deployments
LEANDATA_SITE_LOCAL_HEALTH_URL=http://local.test/
LEANDATA_SITE_PUBLIC_HEALTH_URL=https://public.test/
EOF

cat >"$tmp_dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf 'function DocsSite() { return null; }\n'
EOF
chmod +x "$tmp_dir/bin/curl"

PATH="$tmp_dir/bin:$PATH" \
LEANDATA_SITE_DEPLOY_CONFIG="$tmp_dir/site-deploy.env" \
  bash "$script_dir/deploy_site_commit_pinned.sh" "$commit_sha"

test -f "$site_dir/public/docs-site.jsx"
test ! -e "$site_dir/public/old.txt"
test -f "$tmp_dir/deployments/$commit_sha.json"
grep -q '"docs_sha256":' "$tmp_dir/deployments/$commit_sha.json"

if PATH="$tmp_dir/bin:$PATH" \
  LEANDATA_SITE_DEPLOY_CONFIG="$tmp_dir/site-deploy.env" \
  bash "$script_dir/deploy_site_commit_pinned.sh" \
  0000000000000000000000000000000000000000 >/dev/null 2>&1; then
  printf 'stale SHA contract unexpectedly passed\n' >&2
  exit 1
fi

cat >"$tmp_dir/fake-deploy" <<'EOF'
#!/usr/bin/env bash
test "$1" = "1111111111111111111111111111111111111111"
EOF
chmod +x "$tmp_dir/fake-deploy"

SSH_ORIGINAL_COMMAND="deploy-site 1111111111111111111111111111111111111111" \
LEANDATA_SITE_DEPLOY_COMMAND="$tmp_dir/fake-deploy" \
  bash "$script_dir/leandata_site_forced_deploy.sh"

if SSH_ORIGINAL_COMMAND="bash -lc id" \
  LEANDATA_SITE_DEPLOY_COMMAND="$tmp_dir/fake-deploy" \
  bash "$script_dir/leandata_site_forced_deploy.sh" >/dev/null 2>&1; then
  printf 'forced-command rejection contract unexpectedly passed\n' >&2
  exit 1
fi

printf 'site deployment contract passed\n'
