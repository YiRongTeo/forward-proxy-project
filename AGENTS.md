# AGENTS.md

## Cursor Cloud specific instructions

This repo is a dual HTTP forward proxy (`node-proxy/` Node.js + `go-proxy/` Go) that enforces
per-session domain rules stored in Valkey/Redis, plus a Chrome MV3 extension (`chrome-extension/`,
not runnable headless here). See `README.md` for full behavior and the Chrome extension flow.

### Services and how to run them (local dev mode)

The committed `config/*.json` point Valkey at the Docker hostname `valkey:6379`, which does not
resolve for local (non-Docker) runs. Use the local-dev config files that target `127.0.0.1`:
`config/node-proxy.local.json` and `config/go-proxy.local.json`.

- Session store: `redis-server --port 6379` (Redis is Valkey-wire-compatible; `valkey-cli`/`valkey`
  are not packaged for Ubuntu 24.04, so `redis-server`/`redis-cli` are used). No systemd here — start
  it as a plain background/tmux process, not via `service`/`systemctl`.
- Node proxy (ports 8080 proxy / 3001 admin): `node node-proxy/src/index.js --config config/node-proxy.local.json`
- Go proxy (ports 8081 proxy / 9001 admin): must run from inside `go-proxy/` (there is no root
  `go.mod`): `cd go-proxy && go run ./cmd/proxy -config ../config/go-proxy.local.json`
  (the README's root-level `go run ./go-proxy/cmd/proxy` command fails for this reason).
- Seed sessions after Valkey is up: `CONFIG_FILE=config/node-proxy.local.json bash benchmarks/seed-sessions.sh`
  (seeds `session1234`→google.com and `session5678`→example.com).

### Testing / lint / build

- There are no automated tests and no lint config in this repo. "Testing" means running the proxies
  and exercising them with `curl` (see below).
- Build checks: `go -C go-proxy build ./...` and `npm --prefix node-proxy install`.

### Non-obvious gotchas

- HTTP requests: the session id goes in the `X-Session-ID` request header
  (`curl -x http://127.0.0.1:8080 -H 'X-Session-ID: session5678' http://example.com/`).
- HTTPS/CONNECT: the session id must be on the CONNECT request itself, so with curl use
  `--proxy-header 'X-Session-ID: ...'`, NOT `-H` (a `-H` header is tunneled and never seen by the
  proxy, yielding a 407). The README's `--connect-to ::host:443:...` example is malformed for curl;
  just use `-x <proxy> --proxy-header ...`.
- On a denied CONNECT, curl prints `HTTP 000` / exit 56 ("CONNECT tunnel failed"); the proxy is
  correctly returning `403 Forbidden` (confirm with `curl -v`).
- Expected HTTP status codes: 200 allow, 403 domain/IP denied, 404 unknown session, 407 missing
  session id, 502/504 upstream errors.
- Proxy admin APIs are read-only: `GET /health`, `GET /sessions/:id`; writes return `405`.
