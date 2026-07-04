# Forward Proxy with Valkey Domain-Bound Sessions

Dual HTTP forward proxy implementation (**Node.js** and **Go**) with Valkey-backed session-to-domain enforcement, plus a **Chrome extension** that injects `X-Session-ID` and configures the browser proxy.

## Overview

Each session ID maps to exactly one allowed domain in Valkey. Example: `session1234` → `google.com` allows `google.com` and subdomains, but blocks `facebook.com`. Domains listed in `publicDomains` are reachable **without session auth** (IP allowlist only). Domains listed in `defaultAllowedDomains` are permitted for **authenticated** sessions in addition to each session's Valkey domain (same suffix matching rules).

Every proxied request is gated by:

1. **Client IP allowlist** (`allowedClientIps`)
2. **Public domain bypass** (`publicDomains`) — no session required
3. **Session auth** (407 / `Proxy-Authorization` / `X-Session-ID`) for all other hosts
4. **Domain match** between the requested host and the session's Valkey record (or `defaultAllowedDomains` for authenticated traffic)

```mermaid
flowchart LR
  Chrome --> Extension
  Extension -->|"proxy + X-Session-ID"| NodeProxy
  Extension -->|"proxy + X-Session-ID"| GoProxy
  NodeProxy --> Valkey
  GoProxy --> Valkey
  NodeProxy --> ExternalSite
  GoProxy --> ExternalSite
```

## Quick Start

```bash
docker compose up --build
```

| Service | Ports | Role |
|---------|-------|------|
| Valkey | 6379 | Session store |
| node-proxy | 8080, 3001 | Node forward proxy + admin API |
| go-proxy | 8081, 9001 | Go forward proxy + admin API |

Copy and edit config files as needed:

```bash
# Defaults: config/node-proxy.json, config/go-proxy.json
```

## Create a Session

Proxies are **read-only** for sessions. Create and revoke sessions directly in Valkey (not via the proxy admin API):

```bash
./benchmarks/seed-sessions.sh
```

Or manually with `valkey-cli`. The shell removes `"` unless the JSON is quoted safely — use **single quotes around the whole JSON**, or pipe via `-x`:

```bash
# Safe: single quotes around the JSON value
valkey-cli SET 'session:session1234' \
  '{"domain":"google.com","createdAt":"2026-07-01T12:00:00Z","metadata":{}}' \
  EX 3600

# Safest: pipe JSON on stdin (-x) — no shell quote issues
printf '%s' '{"domain":"google.com","createdAt":"2026-07-01T12:00:00Z","metadata":{}}' \
  | valkey-cli -x SET session:session1234 EX 3600

# One session via helper script
./benchmarks/seed-one.sh session1234 google.com config/go-proxy.json
```

**Avoid** passing bare JSON as separate shell words — this strips quotes and stores invalid data:

```bash
# Wrong — shell mangles the JSON
valkey-cli SET session:session1234 {"domain":"google.com","createdAt":"2026-07-01T12:00:00Z","metadata":{}}
```

Session values **must be valid JSON** with quoted keys. Common mistakes that cause `invalid character 'd' looking for beginning of object key string`:

```bash
# Wrong — unquoted keys
{domain:"google.com"}

# Wrong — plain domain string
google.com

# Correct
{"domain":"google.com","createdAt":"2026-07-01T12:00:00Z","metadata":{}}
```

Inspect what is stored:

```bash
valkey-cli GET session:session1234
```

The proxy admin API only supports **read** operations: `GET /health` and `GET /sessions/:id`. `POST`/`DELETE` return `405`.

## Chrome Extension Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select [`chrome-extension/`](chrome-extension/)
4. Open extension **Options** → set scheme (`http` or `https`), host `localhost`, port `8080` (Node) or `8081` (Go). The scheme must match the proxy listener: if `tls.certFile` / `tls.keyFile` are set and readable, use **https**; otherwise use **http**. A mismatch causes `ERR_TUNNEL_CONNECTION_FAILED`.
5. Open extension **Popup** → enter session ID `session1234` → Save
6. Browse to `https://google.com` (allowed) or `https://facebook.com` (blocked with 403)

The extension:

- Sets Chrome's forward proxy via `chrome.proxy.settings`
- Sends the session ID on **plain HTTP proxy requests** as `x-session-id` (declarativeNetRequest)
- Sends the session ID on **HTTPS CONNECT** as `Proxy-Authorization` (username = session ID) via `webRequest.onAuthRequired` when the proxy returns **407** — declarativeNetRequest cannot modify proxy CONNECT headers in Chrome

After saving a session ID in the popup, reload the extension once if CONNECT still logs `missing_session_id`.

**DevTools note:** HTTPS page requests are tunneled after CONNECT. The session is sent on the CONNECT request to the proxy as `Proxy-Authorization`, not on the visible page request. Filter Network by method **CONNECT** to inspect proxy auth headers.

## Manual curl Tests

Allowed (session bound to `example.com`):

```bash
curl -x http://127.0.0.1:8080 \
  -H 'X-Session-ID: session5678' \
  http://example.com/ -I
```

Denied (domain mismatch):

```bash
curl -x http://127.0.0.1:8080 \
  -H 'X-Session-ID: session1234' \
  http://facebook.com/ -I
# HTTP/1.1 403 Forbidden
```

HTTPS CONNECT tunnel (proxy auth username = session ID):

```bash
curl -x http://127.0.0.1:8080 \
  -U 'session1234:session' \
  https://google.com/ -I
```

## Domain Matching Rules

### Public domains (`publicDomains`)

Hosts in `publicDomains` are allowed **without session credentials**. Only the client IP allowlist applies. CONNECT logs include `"authMode":"public"`.

```bash
# No -U required when example.com is in publicDomains
curl -v -x http://127.0.0.1:8081 https://www.example.com -o /dev/null
```

### Authenticated domains

For hosts **not** in `publicDomains`, a valid session is required. Access is allowed when the host matches the session's Valkey domain **or** any entry in `defaultAllowedDomains`. Subdomains match (suffix-safe).

| Requested host | `publicDomains` | Session domain | `defaultAllowedDomains` | Result |
|----------------|-----------------|----------------|-------------------------|--------|
| `www.example.com` | `["example.com"]` | — | — | Allow (no auth) |
| `google.com` | `[]` | `google.com` | `[]` | Allow (with session) |
| `facebook.com` | `[]` | `google.com` | `[]` | Deny |
| `example.com` | `[]` | `google.com` | `["example.com"]` | Allow (with session) |

Matching is suffix-safe: host must equal the domain or end with `.` + domain.

## TLS (when available)

Both proxies read TLS paths from the config file. When `tls.certFile` and `tls.keyFile` point to readable files, proxy and admin listeners use HTTPS; otherwise they use HTTP.

```json
"tls": {
  "certFile": "/certs/tls.crt",
  "keyFile": "/certs/tls.key"
}
```

Place certificates in [`certs/`](certs/) and update the config paths. Use `https` proxy scheme in the Chrome extension when TLS is enabled.

## Admin API (read-only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (includes `tls: true/false`) |
| `GET` | `/sessions/:id` | Read session from Valkey |
| `POST`/`DELETE`/etc. | `/sessions` | **405** — sessions cannot be modified via proxy |

## Configuration

Both proxies load settings from a **JSON config file** (not environment variables).

| File | Used by | Default ports |
|------|---------|---------------|
| [`config/node-proxy.json`](config/node-proxy.json) | Node proxy | 8080 / 3001 |
| [`config/go-proxy.json`](config/go-proxy.json) | Go proxy | 8081 / 9001 |

Docker Compose mounts each file to `/config/config.json` inside the container.

**Example** (`config/node-proxy.json`):

```json
{
  "valkeyUrl": "rediss://valkey:6379",
  "valkeyTls": {
    "enabled": false,
    "caFile": "",
    "certFile": "",
    "keyFile": "",
    "serverName": "",
    "insecureSkipVerify": false
  },
  "proxyPort": 8080,
  "adminPort": 3001,
  "proxyTimeoutMs": 30000,
  "allowedClientIps": ["127.0.0.1", "::1", "172.16.0.0/12"],
  "trustProxyHeaders": false,
  "sessionHeader": "X-Session-ID",
  "defaultAllowedDomains": ["example.com", "localhost"],
  "publicDomains": ["intranet.corp"],
  "tls": {
    "certFile": "/certs/tls.crt",
    "keyFile": "/certs/tls.key"
  }
}
```

| Field | Description |
|-------|-------------|
| `publicDomains` | Domains allowed **without session auth** (IP allowlist only). Uses suffix matching. Default: `[]`. |
| `defaultAllowedDomains` | Optional list of domains allowed for every **authenticated** session (in addition to the session's Valkey domain). Uses the same suffix matching rules. Default: `[]`. |
| `valkeyTls.enabled` | Enable TLS for Valkey and Sentinel connections. Default: `false`. |
| `valkeyTls.caFile` | CA bundle to verify the Valkey/Sentinel server certificate. |
| `valkeyTls.certFile` / `valkeyTls.keyFile` | Optional client certificate for mutual TLS. Both must be set together. |
| `valkeyTls.serverName` | TLS SNI / certificate hostname when it differs from the connection host. |
| `valkeyTls.insecureSkipVerify` | Skip server certificate verification (development only). Default: `false`. |

**Local run:**

```bash
node node-proxy/src/index.js --config config/node-proxy.json

cd go-proxy && make build
./bin/go-proxy -config ../config/go-proxy.json
```

Or without Make for Go:

```bash
go run ./go-proxy/cmd/proxy -config config/go-proxy.json
```

### RHEL systemd service (Go proxy)

To run the Go proxy as a systemd unit on RHEL 8/9, see [`go-proxy/deploy/README.md`](go-proxy/deploy/README.md). The unit file is [`go-proxy/deploy/go-proxy.service`](go-proxy/deploy/go-proxy.service).

Config lookup order when `--config` / `-config` is omitted:

1. `/config/config.json` (Docker default)
2. `./config.json`
3. `./config/node-proxy.json` or `./config/go-proxy.json`

### Valkey Sentinel

When `valkeySentinel` is set with `masterName` and `sentinels`, both proxies connect via **Sentinel failover** instead of a direct `valkeyUrl`. The URL is still used as a fallback label and for tooling (e.g. session seeding).

When Valkey and Sentinel require TLS, set `valkeyTls.enabled` to `true`. The same TLS settings apply to **both** Sentinel discovery connections and the Valkey master connection. Use `rediss://` in `valkeyUrl` or leave `redis://` — the proxies upgrade to TLS when `valkeyTls.enabled` is true.

```json
{
  "valkeyUrl": "rediss://valkey-master:6379",
  "valkeyTls": {
    "enabled": true,
    "caFile": "/certs/valkey-ca.crt",
    "certFile": "/certs/valkey-client.crt",
    "keyFile": "/certs/valkey-client.key",
    "serverName": "valkey-master",
    "insecureSkipVerify": false
  },
  "valkeySentinel": {
    "masterName": "valkey-master",
    "sentinels": [
      "sentinel-1:26379",
      "sentinel-2:26379",
      "sentinel-3:26379"
    ],
    "password": "",
    "sentinelPassword": "",
    "db": 0
  }
}
```

| Field | Description |
|-------|-------------|
| `masterName` | Sentinel-monitored master name |
| `sentinels` | Sentinel addresses (`host:port`, default port 26379) |
| `password` | Valkey master password (optional) |
| `sentinelPassword` | Sentinel auth password (optional) |
| `db` | Database index (default `0`) |

Full examples: [`config/node-proxy.sentinel.example.json`](config/node-proxy.sentinel.example.json), [`config/go-proxy.sentinel.example.json`](config/go-proxy.sentinel.example.json).

On startup, logs include the active mode, e.g. `{"msg":"valkey configured","mode":"sentinel:valkey-master"}`.

## Benchmarks

```bash
chmod +x benchmarks/*.sh
./benchmarks/seed-sessions.sh
./benchmarks/run.sh
```

Requires [hey](https://github.com/rakyll/hey). Results template: [`benchmarks/results.md`](benchmarks/results.md).

Compare Node (`8080`) vs Go (`8081`) using RPS, p99 latency, and 403 rates on denied domains.

## Error Codes

| Code | Meaning |
|------|---------|
| `400` | Invalid request URL |
| `407` | Missing session ID (extension should respond with proxy credentials) |
| `403` | IP not allowlisted or domain not allowed |
| `404` | Session not found in Valkey |
| `502` | Upstream unreachable |
| `504` | Upstream timeout |
| `502` with `internal_error` | Valkey/Sentinel unreachable or session data invalid — check admin `message` field and service logs |

## Logs

Both proxies write JSON lines to **stdout/stderr**.

| Deployment | View logs |
|------------|-----------|
| RHEL systemd | `sudo journalctl -u go-proxy -f` |
| Docker Compose | `docker compose logs -f go-proxy` |
| Local run | Terminal output |

Admin session lookup errors log as `admin_get_session_failed` (Go/Node). Proxy auth lookups log as `session_lookup_failed` (Go).

```bash
curl -s http://127.0.0.1:9001/health
curl -s http://127.0.0.1:9001/sessions/session1234
```

## Project Layout

```
├── config/
│   ├── node-proxy.json                  # Node proxy config (direct Valkey)
│   ├── go-proxy.json                    # Go proxy config (direct Valkey)
│   ├── node-proxy.sentinel.example.json # Sentinel example (Node)
│   └── go-proxy.sentinel.example.json   # Sentinel example (Go)
├── docker-compose.yml
├── chrome-extension/     # Chrome MV3 extension
├── node-proxy/           # Node.js forward proxy
├── go-proxy/             # Go forward proxy
│   └── deploy/           # RHEL systemd unit + install notes
└── benchmarks/           # Load test scripts
```

## Node vs Go Comparison

Run both proxies under the same Valkey instance and use identical session IDs. The benchmark script exercises the same allowed/denied hosts against both implementations. Compare:

- Requests per second
- p50 / p95 / p99 latency
- Memory (`docker stats`)
- 403 rate on domain violations

Both implementations share the same authorization order, domain matching logic, Valkey schema, and error response format for a fair comparison.
