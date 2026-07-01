#!/usr/bin/env bash
set -euo pipefail

NODE_ADMIN="${NODE_ADMIN:-http://localhost:3001}"
GO_ADMIN="${GO_ADMIN:-http://localhost:9001}"

create_session() {
  local admin_url="$1"
  local id="$2"
  local domain="$3"
  curl -sf -X POST "${admin_url}/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"id\":\"${id}\",\"domain\":\"${domain}\"}" | tee /dev/stderr
  echo
}

echo "Seeding Node proxy sessions..."
create_session "$NODE_ADMIN" "session1234" "google.com"
create_session "$NODE_ADMIN" "session5678" "example.com"

echo "Seeding Go proxy sessions..."
create_session "$GO_ADMIN" "session1234" "google.com"
create_session "$GO_ADMIN" "session5678" "example.com"

echo "Done."
