#!/usr/bin/env bash
set -euo pipefail

commit_sha="${1:-}"
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'expected a full lowercase 40-character commit SHA\n' >&2
  exit 2
fi

: "${LEANDATA_SITE_AWS_SSH_HOST:?set LEANDATA_SITE_AWS_SSH_HOST}"
: "${LEANDATA_SITE_AWS_SSH_USER:?set LEANDATA_SITE_AWS_SSH_USER}"
: "${LEANDATA_SITE_AWS_SSH_KEY_FILE:?set LEANDATA_SITE_AWS_SSH_KEY_FILE to a GitLab file variable}"
: "${LEANDATA_SITE_AWS_KNOWN_HOSTS_FILE:?set LEANDATA_SITE_AWS_KNOWN_HOSTS_FILE to a GitLab file variable}"

for file in "$LEANDATA_SITE_AWS_SSH_KEY_FILE" "$LEANDATA_SITE_AWS_KNOWN_HOSTS_FILE"; do
  if [[ ! -f "$file" ]]; then
    printf 'required SSH file does not exist: %s\n' "$file" >&2
    exit 2
  fi
done

chmod 600 "$LEANDATA_SITE_AWS_SSH_KEY_FILE"
target="$LEANDATA_SITE_AWS_SSH_USER@$LEANDATA_SITE_AWS_SSH_HOST"
port="${LEANDATA_SITE_AWS_SSH_PORT:-22}"

printf 'Requesting commit-pinned AWS site deployment for %s\n' "$commit_sha"
ssh \
  -F /dev/null \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$LEANDATA_SITE_AWS_KNOWN_HOSTS_FILE" \
  -o ConnectTimeout=15 \
  -p "$port" \
  -i "$LEANDATA_SITE_AWS_SSH_KEY_FILE" \
  "$target" \
  "deploy-site $commit_sha"
