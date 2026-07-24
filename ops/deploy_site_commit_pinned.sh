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

runtime_config="${LEANDATA_RUNTIME_DEPLOY_CONFIG:-/etc/leandata/deploy.env}"
if [[ ! -r "$runtime_config" ]]; then
  printf 'runtime deployment config is not readable: %s\n' "$runtime_config" >&2
  exit 2
fi

site_dir_from_site_config="$LEANDATA_SITE_DIR"
set -a
# shellcheck source=/dev/null
source "$runtime_config"
set +a

: "${LEANDATA_ENV_FILE:?set LEANDATA_ENV_FILE in the runtime deployment config}"
: "${LEANDATA_ARCHIVE_ENV_FILE:?set LEANDATA_ARCHIVE_ENV_FILE in the runtime deployment config}"
: "${LEANDATA_DATA_ROOT:?set LEANDATA_DATA_ROOT in the runtime deployment config}"

if [[ "$LEANDATA_SITE_DIR" != "$site_dir_from_site_config" ]]; then
  printf 'site directory mismatch between site and runtime configs\n' >&2
  exit 2
fi

current_link="${LEANDATA_CURRENT_LINK:-/srv/leandata/current}"
compose_project="${LEANDATA_COMPOSE_PROJECT:-leandata-v2}"
compose_files_value="${LEANDATA_COMPOSE_FILES:-docker-compose.aliyun.yml:docker-compose.aliyun.archive.yml:docker-compose.aliyun.logging.yml}"

for command in awk cp curl date docker find flock git grep mkdir mv readlink seq sha256sum sleep tar; do
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

remove_file() {
  local path="$1"
  case "$path" in
    "$site_parent"/.leandata-server-next-*|"$site_parent"/.leandata-server-rollback-*)
      ;;
    *)
      printf 'refusing to remove unscoped file: %s\n' "$path" >&2
      return 2
      ;;
  esac
  if [[ -f "$path" ]]; then
    find "$path" -maxdepth 0 -delete
  fi
}

if [[ ! -L "$current_link" ]]; then
  printf 'runtime current link is unavailable: %s\n' "$current_link" >&2
  exit 2
fi
runtime_release="$(readlink -f "$current_link")"
runtime_service_dir="$runtime_release/services/leandata-v2"
if [[ ! -d "$runtime_service_dir" ]]; then
  printf 'runtime Compose directory is unavailable: %s\n' "$runtime_service_dir" >&2
  exit 2
fi

compose_args=(
  docker compose
  --env-file "$LEANDATA_ENV_FILE"
  --env-file "$LEANDATA_ARCHIVE_ENV_FILE"
  -p "$compose_project"
)
IFS=':' read -r -a compose_files <<<"$compose_files_value"
for compose_file in "${compose_files[@]}"; do
  compose_path="$runtime_service_dir/$compose_file"
  if [[ ! -f "$compose_path" ]]; then
    printf 'runtime Compose file is unavailable: %s\n' "$compose_path" >&2
    exit 2
  fi
  compose_args+=(-f "$compose_path")
done

export LEANDATA_ENV_FILE
export LEANDATA_ARCHIVE_ENV_FILE
export LEANDATA_SITE_DIR
export LEANDATA_DATA_ROOT
"${compose_args[@]}" config --quiet

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
if [[ ! -d "$release_dir/proxy-token-site/public" || ! -f "$release_dir/proxy-token-site/server.js" ]]; then
  remove_tree "$release_dir"
  mkdir -p "$release_dir"
  git --git-dir="$LEANDATA_SITE_REPOSITORY_MIRROR" archive \
    "$commit_sha" \
    proxy-token-site/server.js \
    proxy-token-site/public \
    | tar -x -C "$release_dir"
fi

source_public="$release_dir/proxy-token-site/public"
source_server="$release_dir/proxy-token-site/server.js"
for required in index.html docs-site.jsx token-page.jsx; do
  if [[ ! -f "$source_public/$required" ]]; then
    printf 'site release is missing required file: %s\n' "$required" >&2
    exit 4
  fi
done
if [[ ! -f "$source_public/account.html" || ! -f "$source_public/account-page.jsx" || ! -f "$source_server" ]]; then
  printf 'site release is missing the account portal server or public assets\n' >&2
  exit 4
fi

next_public="$site_parent/.leandata-public-next-$commit_sha"
rollback_public="$site_parent/.leandata-public-rollback-$commit_sha"
next_server="$site_parent/.leandata-server-next-$commit_sha"
rollback_server="$site_parent/.leandata-server-rollback-$commit_sha"
remove_tree "$next_public"
remove_tree "$rollback_public"
remove_file "$next_server"
remove_file "$rollback_server"
mkdir -p "$next_public"
cp -a "$source_public/." "$next_public/"
cp -a "$source_server" "$next_server"

if [[ ! -d "$LEANDATA_SITE_DIR/public" || ! -f "$LEANDATA_SITE_DIR/server.js" ]]; then
  printf 'live site public directory or server.js is unavailable under %s\n' "$LEANDATA_SITE_DIR" >&2
  exit 4
fi

mkdir -p "$rollback_public"
cp -a "$LEANDATA_SITE_DIR/public/." "$rollback_public/"
cp -a "$LEANDATA_SITE_DIR/server.js" "$rollback_server"

replace_public_tree() {
  local source="$1"
  find "$LEANDATA_SITE_DIR/public" -depth -mindepth 1 -delete
  cp -a "$source/." "$LEANDATA_SITE_DIR/public/"
}

replace_server_file() {
  local source="$1"
  cp "$source" "$LEANDATA_SITE_DIR/server.js"
}

wait_for_health() {
  local url="$1"
  local attempt
  for attempt in $(seq 1 45); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  printf 'site health check failed: %s\n' "$url" >&2
  return 1
}

recreate_ui() {
  "${compose_args[@]}" up -d --no-deps --no-build --force-recreate leandata-ui
  wait_for_health "$LEANDATA_SITE_LOCAL_HEALTH_URL"
}

replace_public_tree "$next_public"
replace_server_file "$next_server"
remove_tree "$next_public"
remove_file "$next_server"

rollback() {
  printf 'site smoke failed; restoring previous server and public directory\n' >&2
  replace_server_file "$rollback_server"
  replace_public_tree "$rollback_public"
  recreate_ui || true
  remove_tree "$rollback_public"
  remove_file "$rollback_server"
}

expected_docs_sha="$(sha256sum "$source_public/docs-site.jsx" | awk '{print $1}')"
expected_server_sha="$(sha256sum "$source_server" | awk '{print $1}')"
expected_account_sha="$(sha256sum "$source_public/account.html" | awk '{print $1}')"
local_docs_url="${LEANDATA_SITE_LOCAL_DOCS_URL:-${LEANDATA_SITE_LOCAL_HEALTH_URL%/}/docs-site.jsx}"
public_docs_url="${LEANDATA_SITE_PUBLIC_DOCS_URL:-${LEANDATA_SITE_PUBLIC_HEALTH_URL%/}/docs-site.jsx}"
local_account_url="${LEANDATA_SITE_LOCAL_ACCOUNT_URL:-${LEANDATA_SITE_LOCAL_HEALTH_URL%/}/account}"
public_account_url="${LEANDATA_SITE_PUBLIC_ACCOUNT_URL:-${LEANDATA_SITE_PUBLIC_HEALTH_URL%/}/account}"

if ! recreate_ui; then
  rollback
  exit 5
fi

host_server_sha="$(sha256sum "$LEANDATA_SITE_DIR/server.js" | awk '{print $1}')"
container_server_sha="$("${compose_args[@]}" exec -T leandata-ui sha256sum /app/server.js | awk '{print $1}')" || {
  rollback
  exit 5
}
if [[ "$host_server_sha" != "$expected_server_sha" || "$container_server_sha" != "$expected_server_sha" ]]; then
  printf 'server hash mismatch after UI recreation\n' >&2
  rollback
  exit 5
fi

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

local_account_sha="$(curl -fsS --max-time 15 "$local_account_url" | sha256sum | awk '{print $1}')" || {
  rollback
  exit 5
}
if [[ "$local_account_sha" != "$expected_account_sha" ]]; then
  printf 'local account page hash mismatch: expected %s, received %s\n' \
    "$expected_account_sha" "$local_account_sha" >&2
  rollback
  exit 5
fi

public_account_sha="$(curl -fsS --max-time 20 "$public_account_url" | sha256sum | awk '{print $1}')" || {
  rollback
  exit 5
}
if [[ "$public_account_sha" != "$expected_account_sha" ]]; then
  printf 'public account page hash mismatch: expected %s, received %s\n' \
    "$expected_account_sha" "$public_account_sha" >&2
  rollback
  exit 5
fi

remove_tree "$rollback_public"
remove_file "$rollback_server"

deployed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
manifest="$LEANDATA_SITE_DEPLOY_LOG_DIR/$commit_sha.json"
printf '{"commit_sha":"%s","deployed_at":"%s","status":"success","surface":"server_and_public","server_sha256":"%s","docs_sha256":"%s","account_sha256":"%s"}\n' \
  "$commit_sha" \
  "$deployed_at" \
  "$expected_server_sha" \
  "$expected_docs_sha" \
  "$expected_account_sha" \
  >"$manifest"

printf 'Deployed leandata account server and public site commit %s\n' "$commit_sha"
