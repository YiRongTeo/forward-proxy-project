#!/usr/bin/env bash
set -euo pipefail

NODE_PROXY="${NODE_PROXY:-http://127.0.0.1:8080}"
GO_PROXY="${GO_PROXY:-http://127.0.0.1:8081}"
USER_SESSION_ID="${USER_SESSION_ID:-alice}"
PASSWORD="${PASSWORD:-s3cret}"
DENY_USER="${DENY_USER:-bob}"
REQUESTS="${REQUESTS:-5000}"
CONCURRENCY="${CONCURRENCY:-50}"
RESULTS_FILE="${RESULTS_FILE:-benchmarks/results.md}"

if ! command -v hey >/dev/null 2>&1; then
  echo "hey is required: go install github.com/rakyll/hey@latest"
  exit 1
fi

run_case() {
  local name="$1"
  local proxy="$2"
  local target="$3"
  local user="${4:-$USER_SESSION_ID}"
  local pass="${5:-$PASSWORD}"
  echo "=== ${name} => ${target} (via ${proxy}, user=${user}) ==="
  hey -n "$REQUESTS" -c "$CONCURRENCY" \
    -U "${user}:${pass}" \
    -x "$proxy" \
    "$target" 2>&1 | tee "/tmp/${name}.txt" || true
  echo
}

mkdir -p "$(dirname "$RESULTS_FILE")"

{
  echo "# Benchmark Results"
  echo
  echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "| Setting | Value |"
  echo "|---------|-------|"
  echo "| Requests | ${REQUESTS} |"
  echo "| Concurrency | ${CONCURRENCY} |"
  echo "| User session ID | ${USER_SESSION_ID} |"
  echo
  echo "## Node proxy (${NODE_PROXY})"
  echo
} > "$RESULTS_FILE"

run_case "node-example" "$NODE_PROXY" "http://example.com/"
run_case "node-deny" "$NODE_PROXY" "http://google.com/" "$DENY_USER"

{
  echo "## Go proxy (${GO_PROXY})"
  echo
} >> "$RESULTS_FILE"

run_case "go-example" "$GO_PROXY" "http://example.com/"
run_case "go-deny" "$GO_PROXY" "http://google.com/" "$DENY_USER"

{
  echo "## Notes"
  echo
  echo "- Seed keys with ./benchmarks/seed-sessions.sh (sessions:{user}:{domain} = password)."
  echo "- Allowed test uses alice on example.com; denied test uses bob on google.com."
  echo "- Compare RPS and latency sections in /tmp/*.txt output above."
} >> "$RESULTS_FILE"

echo "Results template written to ${RESULTS_FILE}"
