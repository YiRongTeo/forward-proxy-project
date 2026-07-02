#!/usr/bin/env bash
set -euo pipefail

NODE_PROXY="${NODE_PROXY:-http://127.0.0.1:8080}"
GO_PROXY="${GO_PROXY:-http://127.0.0.1:8081}"
SESSION_ID="${SESSION_ID:-session5678}"
DENY_SESSION_ID="${DENY_SESSION_ID:-session1234}"
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
  local expect_ok="$4"
  local session="${5:-$SESSION_ID}"
  echo "=== ${name} => ${target} (via ${proxy}, session=${session}) ==="
  hey -n "$REQUESTS" -c "$CONCURRENCY" \
    -H "X-Session-ID: ${session}" \
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
  echo "| Session ID | ${SESSION_ID} |"
  echo
  echo "## Node proxy (${NODE_PROXY})"
  echo
} > "$RESULTS_FILE"

run_case "node-google" "$NODE_PROXY" "http://example.com/" "ok"
run_case "node-deny" "$NODE_PROXY" "http://facebook.com/" "deny" "$DENY_SESSION_ID"

{
  echo "## Go proxy (${GO_PROXY})"
  echo
} >> "$RESULTS_FILE"

run_case "go-google" "$GO_PROXY" "http://example.com/" "ok"
run_case "go-deny" "$GO_PROXY" "http://facebook.com/" "deny" "$DENY_SESSION_ID"

{
  echo "## Notes"
  echo
  echo "- Allowed test uses session bound to example.com (seed with seed-sessions.sh)."
  echo "- Denied test expects elevated 403 rates for facebook.com."
  echo "- Compare RPS and latency sections in /tmp/*.txt output above."
} >> "$RESULTS_FILE"

echo "Results template written to ${RESULTS_FILE}"
