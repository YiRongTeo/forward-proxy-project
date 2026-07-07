#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=seed-lib.sh
source "$SCRIPT_DIR/seed-lib.sh"

seed_load_config

PASSWORD="${SEED_PASSWORD:-s3cret}"

echo "Seeding domain keys directly in Valkey (proxies are read-only)..."
echo "Using Valkey at ${VALKEY_HOST}:${VALKEY_PORT} from ${CONFIG_FILE} (prefix=${SESSIONS_PREFIX}, tls=${VALKEY_TLS_ENABLED})"
seed_user_domain "alice" "google.com" "$PASSWORD"
seed_user_domain "alice" "example.com" "$PASSWORD"
seed_user_domain "bob" "example.com" "$PASSWORD"
echo "Done."
