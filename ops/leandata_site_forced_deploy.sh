#!/usr/bin/env bash
set -euo pipefail

deploy_command="${LEANDATA_SITE_DEPLOY_COMMAND:-/srv/leandata/bin/deploy_site_commit_pinned.sh}"
original_command="${SSH_ORIGINAL_COMMAND:-}"

if [[ ! "$original_command" =~ ^deploy-site[[:space:]]([0-9a-f]{40})$ ]]; then
  printf 'Only deploy-site followed by one full commit SHA is permitted.\n' >&2
  exit 126
fi

commit_sha="${BASH_REMATCH[1]}"
exec "$deploy_command" "$commit_sha"
