#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=seed-lib.sh
source "$SCRIPT_DIR/seed-lib.sh"

seed_load_config

echo "Seeding sessions directly in Valkey (proxies are read-only)..."
echo "Using Valkey at ${VALKEY_HOST}:${VALKEY_PORT} from ${CONFIG_FILE} (tls=${VALKEY_TLS_ENABLED})"
seed_session "session1234" "google.com"
seed_session "session5678" "example.com"
echo "Done."
