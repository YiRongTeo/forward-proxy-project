#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <session-id> <domain> [config-file]" >&2
  echo "Example: $0 session1234 google.com config/go-proxy.json" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=seed-lib.sh
source "$SCRIPT_DIR/seed-lib.sh"

export CONFIG_FILE="${3:-config/go-proxy.json}"
seed_load_config
seed_session "$1" "$2"
