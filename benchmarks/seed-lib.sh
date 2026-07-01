#!/usr/bin/env bash

seed_load_config() {
  CONFIG_FILE="${CONFIG_FILE:-config/go-proxy.json}"
  TTL="${SESSION_TTL_SECONDS:-3600}"

  VALKEY_TLS_ENABLED=false
  VALKEY_TLS_CA=""
  VALKEY_TLS_CERT=""
  VALKEY_TLS_KEY=""

  if [[ -f "$CONFIG_FILE" ]] && command -v jq >/dev/null 2>&1; then
    VALKEY_URL="$(jq -r '.valkeyUrl' "$CONFIG_FILE")"
    VALKEY_TLS_ENABLED="$(jq -r '.valkeyTls.enabled // false' "$CONFIG_FILE")"
    VALKEY_TLS_CA="$(jq -r '.valkeyTls.caFile // ""' "$CONFIG_FILE")"
    VALKEY_TLS_CERT="$(jq -r '.valkeyTls.certFile // ""' "$CONFIG_FILE")"
    VALKEY_TLS_KEY="$(jq -r '.valkeyTls.keyFile // ""' "$CONFIG_FILE")"
  else
    VALKEY_URL="${VALKEY_URL:-redis://localhost:6379}"
  fi

  VALKEY_HOST="${VALKEY_HOST:-localhost}"
  VALKEY_PORT="${VALKEY_PORT:-6379}"
  if [[ "$VALKEY_URL" =~ redis[s]?://([^:/]+):?([0-9]*) ]]; then
    VALKEY_HOST="${BASH_REMATCH[1]}"
    if [[ -n "${BASH_REMATCH[2]}" ]]; then
      VALKEY_PORT="${BASH_REMATCH[2]}"
    fi
  fi

  CLI_COMMON_ARGS=(-h "$VALKEY_HOST" -p "$VALKEY_PORT")
  if [[ "$VALKEY_TLS_ENABLED" == "true" ]]; then
    CLI_COMMON_ARGS+=(--tls)
    if [[ -n "$VALKEY_TLS_CA" ]]; then
      CLI_COMMON_ARGS+=(--cacert "$VALKEY_TLS_CA")
    fi
    if [[ -n "$VALKEY_TLS_CERT" && -n "$VALKEY_TLS_KEY" ]]; then
      CLI_COMMON_ARGS+=(--cert "$VALKEY_TLS_CERT" --key "$VALKEY_TLS_KEY")
    fi
  fi
}

seed_run_cli() {
  if command -v valkey-cli >/dev/null 2>&1; then
    valkey-cli "${CLI_COMMON_ARGS[@]}" "$@"
  elif command -v redis-cli >/dev/null 2>&1; then
    redis-cli "${CLI_COMMON_ARGS[@]}" "$@"
  else
    echo "valkey-cli or redis-cli is required to seed sessions" >&2
    exit 1
  fi
}

seed_session() {
  local id="$1"
  local domain="$2"
  local created_at
  created_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local payload
  payload=$(printf '{"domain":"%s","createdAt":"%s","metadata":{}}' "$domain" "$created_at")

  # -x reads the value from stdin so the shell cannot strip JSON quotes.
  printf '%s' "$payload" | seed_run_cli -x SET "session:${id}" EX "$TTL"

  echo "Seeded session:${id} -> ${domain} (TTL ${TTL}s)"
  echo "Stored value: $payload"
}
