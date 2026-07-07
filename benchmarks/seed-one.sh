#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <user-session-id> <domain> <password> [config-file]" >&2
  echo "Example: $0 alice google.com s3cret config/go-proxy.json" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=seed-lib.sh
source "$SCRIPT_DIR/seed-lib.sh"

export CONFIG_FILE="${4:-config/go-proxy.json}"
seed_load_config
seed_user_domain "$1" "$2" "$3"
