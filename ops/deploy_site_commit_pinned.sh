#!/usr/bin/env bash
set -euo pipefail

commit_sha="${1:-}"
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'expected a full lowercase 40-character commit SHA\n' >&2
  exit 2
fi

config_file="${LEANDATA_SITE_DEPLOY_CONFIG:-/etc/leandata/site-deploy.env}"
if [[ ! -r "$config_file" ]]; then
  printf 'site deployment config is not readable: %s\n' "$config_file" >&2
  exit 2
fi

set -a
# shellcheck source=/dev/null
source "$config_file"
set +a

: "${LEANDATA_SITE_REPO_URL:?set LEANDATA_SITE_REPO_URL}"
: "${LEANDATA_SITE_REPOSITORY_MIRROR:?set LEANDATA_SITE_REPOSITORY_MIRROR}"
: "${LEANDATA_SITE_RELEASE_ROOT:?set LEANDATA_SITE_RELEASE_ROOT}"
: "${LEANDATA_SITE_DIR:?set LEANDATA_SITE_DIR}"
: "${LEANDATA_SITE_DEPLOY_LOCK_FILE:?set LEANDATA_SITE_DEPLOY_LOCK_FILE}"
: "${LEANDATA_SITE_DEPLOY_LOG_DIR:?set LEANDATA_SITE_DEPLOY_LOG_DIR}"
: "${LEANDATA_SITE_LOCAL_HEALTH_URL:?set LEANDATA_SITE_LOCAL_HEALTH_URL}"
: "${LEANDATA_SITE_PUBLIC_HEALTH_URL:?set LEANDATA_SITE_PUBLIC_HEALTH_URL}"

for command in cp curl date find flock git grep mkdir mv sha256sum tar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'required command is unavailable: %s\n' "$command" >&2
    exit 2
  fi
done

site_parent="$(dirname "$LEANDATA_SITE_DIR")"

remove_tree() {
  local path="$1"
  case "$path" in
    "$LEANDATA_SITE_RELEASE_ROOT"/*|"$site_parent"/.leandata-public-*|"$LEANDATA_SITE_DIR"/public)
      ;;
    *)
      printf 'refusing to remove unscoped path: %s\n' "$path" >&2
      return 2
      ;;
  esac
  if [[ -d "$path" ]]; then
    find "$path" -depth -mindepth 1 -delete
    rmdir "$path"
  fi
}

mkdir -p \
  "$(dirname "$LEANDATA_SITE_REPOSITORY_MIRROR")" \
  "$LEANDATA_SITE_RELEASE_ROOT" \
  "$LEANDATA_SITE_DEPLOY_LOG_DIR" \
  "$(dirname "$LEANDATA_SITE_DEPLOY_LOCK_FILE")"

exec 9>"$LEANDATA_SITE_DEPLOY_LOCK_FILE"
flock -n 9 || {
  printf 'another site deployment is active\n' >&2
  exit 75
}

if [[ ! -d "$LEANDATA_SITE_REPOSITORY_MIRROR" ]]; then
  git clone --mirror "$LEANDATA_SITE_REPO_URL" "$LEANDATA_SITE_REPOSITORY_MIRROR"
fi

git --git-dir="$LEANDATA_SITE_REPOSITORY_MIRROR" remote set-url origin "$LEANDATA_SITE_REPO_URL"
git --git-dir="$LEANDATA_SITE_REPOSITORY_MIRROR" fetch \
  --prune origin \
  +refs/heads/main:refs/remotes/origin/main

main_sha="$(git --git-dir="$LEANDATA_SITE_REPOSITORY_MIRROR" rev-parse refs/remotes/origin/main)"
if [[ "$main_sha" != "$commit_sha" ]]; then
  printf 'refusing stale site SHA: main is %s, requested %s\n' "$main_sha" "$commit_sha" >&2
  exit 3
fi

release_dir="$LEANDATA_SITE_RELEASE_ROOT/$commit_sha"
if [[ ! -d "$release_dir/proxy-token-site/public" ]]; then
  remove_tree "$release_dir"
  mkdir -p "$release_dir"
  git --git-dir="$LEANDATA_SITE_REPOSITORY_MIRROR" archive \
    "$commit_sha" \
    proxy-token-site/public \
    | tar -x -C "$release_dir"
fi

source_public="$release_dir/proxy-token-site/public"
for required in index.html docs-site.jsx token-page.jsx; do
  if [[ ! -f "$source_public/$required" ]]; then
    printf 'site release is missing required file: %s\n' "$required" >&2
    exit 4
  fi
done

next_public="$site_parent/.leandata-public-next-$commit_sha"
rollback_public="$site_parent/.leandata-public-rollback-$commit_sha"
remove_tree "$next_public"
remove_tree "$rollback_public"
mkdir -p "$next_public"
cp -a "$source_public/." "$next_public/"

if [[ ! -d "$LEANDATA_SITE_DIR/public" ]]; then
  printf 'live site public directory is unavailable: %s/public\n' "$LEANDATA_SITE_DIR" >&2
  exit 4
fi

mkdir -p "$rollback_public"
cp -a "$LEANDATA_SITE_DIR/public/." "$rollback_public/"

replace_public_tree() {
  local source="$1"
  find "$LEANDATA_SITE_DIR/public" -depth -mindepth 1 -delete
  cp -a "$source/." "$LEANDATA_SITE_DIR/public/"
}

replace_public_tree "$next_public"
remove_tree "$next_public"

rollback() {
  printf 'site smoke failed; restoring previous public directory\n' >&2
  replace_public_tree "$rollback_public"
  remove_tree "$rollback_public"
}

expected_docs_sha="$(sha256sum "$source_public/docs-site.jsx" | awk '{print $1}')"
local_docs_url="${LEANDATA_SITE_LOCAL_DOCS_URL:-${LEANDATA_SITE_LOCAL_HEALTH_URL%/}/docs-site.jsx}"
public_docs_url="${LEANDATA_SITE_PUBLIC_DOCS_URL:-${LEANDATA_SITE_PUBLIC_HEALTH_URL%/}/docs-site.jsx}"

local_docs_sha="$(curl -fsS --max-time 15 "$local_docs_url" | sha256sum | awk '{print $1}')" || {
  rollback
  exit 5
}
if [[ "$local_docs_sha" != "$expected_docs_sha" ]]; then
  printf 'local docs hash mismatch: expected %s, received %s\n' \
    "$expected_docs_sha" "$local_docs_sha" >&2
  rollback
  exit 5
fi

public_docs_sha="$(curl -fsS --max-time 20 "$public_docs_url" | sha256sum | awk '{print $1}')" || {
  rollback
  exit 5
}
if [[ "$public_docs_sha" != "$expected_docs_sha" ]]; then
  printf 'public docs hash mismatch: expected %s, received %s\n' \
    "$expected_docs_sha" "$public_docs_sha" >&2
  rollback
  exit 5
fi

remove_tree "$rollback_public"

deployed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
manifest="$LEANDATA_SITE_DEPLOY_LOG_DIR/$commit_sha.json"
printf '{"commit_sha":"%s","deployed_at":"%s","status":"success","surface":"public","docs_sha256":"%s"}\n' \
  "$commit_sha" \
  "$deployed_at" \
  "$expected_docs_sha" \
  >"$manifest"

printf 'Deployed leandata public site commit %s\n' "$commit_sha"
