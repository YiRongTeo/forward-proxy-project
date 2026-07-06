# RHEL systemd deployment

Run the Go forward proxy as a systemd service on RHEL 8/9 (or compatible distros).

## Prerequisites

- Go 1.22+ (build host) or a pre-built Linux amd64 binary
- Network access to Valkey/Redis
- Root/sudo for install steps

## 1. Build the binary

```bash
cd go-proxy
make build
```

Cross-compile on a non-Linux host:

```bash
make build-linux
```

Binary output: `bin/go-proxy`

## 2. Install files

```bash
cd go-proxy
sudo make install
```

Or step by step:

```bash
sudo make install-user install-bin install-config install-service
```

Edit `/etc/go-proxy/config.json` for your environment (`valkeyUrl`, `valkeyTls`, `allowedClientIps`, `publicDomains`, ports).

**Proxy listener TLS** (`tls.certFile` / `tls.keyFile`): optional HTTPS for the forward proxy. When files are missing or empty, the proxy listens on HTTP. Set the Chrome extension scheme to **https** when TLS is enabled.

**Valkey / Sentinel TLS** (`valkeyTls`): set `enabled: true` and point `caFile` (and optional client cert/key) at files readable by the `go-proxy` user.

Recommended session settings for Chrome:

```json
{
  "requireSessionFromHeader": true,
  "acceptSessionFromProxyAuth": true
}
```

The proxy never returns `407` — missing credentials yield `403`.

## 3. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now go-proxy.service
```

## Service management

```bash
sudo systemctl status go-proxy
sudo journalctl -u go-proxy -f
sudo systemctl restart go-proxy
```

## Logs

JSON lines on stderr → journald:

```bash
sudo journalctl -u go-proxy -f
sudo journalctl -u go-proxy | grep session_lookup_failed
```

| Log field | Meaning |
|-----------|---------|
| `authMode: "public"` | `publicDomains` bypass — no session |
| `authMode: "open"` | `requireSessionFromHeader: false` |
| `authMode: "header"` | Session credential used |
| `session_lookup_failed` | Valkey error during auth |

`/var/log/go-proxy` is created at install for optional file logging; the app writes to journald by default.

## Seed sessions

```bash
./benchmarks/seed-one.sh session1234 google.com /etc/go-proxy/config.json
```

Uses `valkey-cli -x` so shell quoting cannot strip JSON keys.

## Firewalld (optional)

```bash
sudo firewall-cmd --permanent --add-port=8081/tcp
sudo firewall-cmd --permanent --add-port=9001/tcp
sudo firewall-cmd --reload
```

Port **8081** = forward proxy; **9001** = read-only admin API.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `ERR_PROXY_CONNECTION_FAILED` | TCP unreachable | Check `systemctl status`, firewall, extension host/port |
| Extension blocks port 9001 | Admin API selected | Use **8081** (Go forward proxy) |
| `403 missing_session_id` | No session credential | Save session in extension; enable `acceptSessionFromProxyAuth` for CONNECT |
| `404 session_not_found` | Session missing in Valkey | Run `seed-one.sh` |
| `domain_not_allowed` | Host outside session/default domains | Update Valkey session or `defaultAllowedDomains` |
| `authMode: public` in logs | Host in `publicDomains` | Expected — no session required |

Use extension **Options → Test proxy port** after setting host/port/scheme.

## Upgrade

```bash
cd go-proxy
make build
sudo systemctl stop go-proxy
sudo make install-bin
sudo systemctl start go-proxy
```
