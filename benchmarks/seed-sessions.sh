#!/usr/bin/env bash
set -euo pipefail

VALKEY_HOST="${VALKEY_HOST:-localhost}"
VALKEY_PORT="${VALKEY_PORT:-6379}"
TTL="${SESSION_TTL_SECONDS:-3600}"

seed_session() {
  local id="$1"
  local domain="$2"
  local created_at
  created_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local payload
  payload=$(printf '{"domain":"%s","createdAt":"%s","metadata":{}}' "$domain" "$created_at")

  if command -v valkey-cli >/dev/null 2>&1; then
    valkey-cli -h "$VALKEY_HOST" -p "$VALKEY_PORT" SET "session:${id}" "$payload" EX "$TTL"
  elif command -v redis-cli >/dev/null 2>&1; then
    redis-cli -h "$VALKEY_HOST" -p "$VALKEY_PORT" SET "session:${id}" "$payload" EX "$TTL"
  else
    echo "valkey-cli or redis-cli is required to seed sessions" >&2
    exit 1
  fi

  echo "Seeded session:${id} -> ${domain} (TTL ${TTL}s)"
}

echo "Seeding sessions directly in Valkey (proxies are read-only)..."
seed_session "session1234" "google.com"
seed_session "session5678" "example.com"
echo "Done."
