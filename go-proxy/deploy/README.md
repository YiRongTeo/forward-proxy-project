# RHEL systemd deployment

Run the Go forward proxy as a systemd service on RHEL 8/9 (or compatible distros).

## Prerequisites

- Go 1.22+ (build host) or a pre-built Linux amd64 binary
- Network access to Valkey/Redis
- Root/sudo for install steps

## 1. Build the binary

From the `go-proxy` directory:

```bash
cd go-proxy
make build
```

For cross-compiling on a non-Linux build host:

```bash
make build-linux
```

The binary is written to `bin/go-proxy` (the path used by `make install` and the systemd unit).

## 2. Install files

```bash
cd go-proxy
sudo make install
```

Or step by step:

```bash
sudo make install-user install-bin install-config install-service
```

`make install-bin` copies `bin/go-proxy` to `/usr/local/bin/go-proxy` (the path referenced by the systemd unit).

Edit `/etc/go-proxy/config.json` for your environment (`valkeyUrl`, `valkeyTls`, `allowedClientIps`, ports).

**Proxy listener TLS** (`tls.certFile` / `tls.keyFile`): optional HTTPS for the forward proxy itself. If these files are missing or empty, the proxy listens on plain HTTP. When enabled, set the Chrome extension proxy scheme to **https** (not http) or Chrome will show `ERR_TUNNEL_CONNECTION_FAILED`.

Place files in `/etc/go-proxy/certs/` and ensure the `go-proxy` user can read them:

```bash
sudo chown root:go-proxy /etc/go-proxy/certs/tls.crt /etc/go-proxy/certs/tls.key
sudo chmod 0640 /etc/go-proxy/certs/tls.crt /etc/go-proxy/certs/tls.key
```

If proxy listener TLS is not used, set empty strings:

```json
"tls": {
  "certFile": "",
  "keyFile": ""
}
```

**Valkey / Sentinel TLS** (`valkeyTls`): set `enabled: true` and point `caFile` (and optional client cert/key) at files readable by the `go-proxy` user. The same settings secure both Sentinel and Valkey master connections.

## 3. SELinux (if enforcing)

Allow the service to bind proxy/admin ports and connect to Valkey:

```bash
sudo semanage port -a -t http_port_t -p tcp 8081 2>/dev/null || \
  sudo semanage port -m -t http_port_t -p tcp 8081
sudo semanage port -a -t http_port_t -p tcp 9001 2>/dev/null || \
  sudo semanage port -m -t http_port_t -p tcp 9001
```

Adjust ports if your config uses different values. If Valkey runs on a non-standard port, allow that separately.

## 4. Enable and start

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

The Go binary logs to **stderr** (JSON lines). Under systemd, everything goes to **journald**:

```bash
# Follow live logs (proxy CONNECT events + admin errors)
sudo journalctl -u go-proxy -f

# Recent errors only
sudo journalctl -u go-proxy -p err --since "1 hour ago"

# Filter session lookup failures
sudo journalctl -u go-proxy | grep session_lookup_failed
sudo journalctl -u go-proxy | grep admin_get_session_failed
```

Log line types:

| `event` / `msg` | Source | Meaning |
|-----------------|--------|---------|
| `go forward proxy listening` | startup | Proxy port ready |
| `go admin API listening` | startup | Admin port ready |
| `valkey connected` | startup | Valkey/Sentinel client created |
| *(no event field)* | proxy | CONNECT/HTTP access log (`method`, `allowed`, `authMode`, `error`) |
| `session_lookup_failed` | proxy | Valkey error during CONNECT/HTTP auth |
| `admin_get_session_failed` | admin API | Valkey error on `GET /sessions/:id` |

The directory `/var/log/go-proxy` is reserved for future file logging; **nothing is written there today**.

When `GET /sessions/:id` returns `{"error":"internal_error"}`, the response now includes a `message` field with the underlying error. Check journald for the matching `admin_get_session_failed` line.

Quick Valkey connectivity check:

```bash
curl -s http://127.0.0.1:9001/health | jq .
curl -s http://127.0.0.1:9001/sessions/session1234 | jq .
```

Seed a session without shell quote problems:

```bash
./benchmarks/seed-one.sh session1234 google.com /etc/go-proxy/config.json

# Or pipe JSON with -x (never pass bare JSON as separate shell words)
printf '%s' '{"domain":"google.com","createdAt":"2026-07-01T12:00:00Z","metadata":{}}' \
  | valkey-cli --tls --cacert /etc/go-proxy/certs/valkey-ca.crt \
      -h valkey-host -p 6379 -x SET session:session1234 EX 3600
```

## Firewalld (optional)

```bash
sudo firewall-cmd --permanent --add-port=8081/tcp
sudo firewall-cmd --permanent --add-port=9001/tcp
sudo firewall-cmd --reload
```

Port `8081` is the forward proxy; port `9001` is the read-only admin API.

## Troubleshooting `ERR_PROXY_CONNECTION_FAILED`

Chrome cannot open a TCP connection to the proxy at all (before CONNECT/auth). Check in order:

1. **Service running and listening**
   ```bash
   sudo systemctl status go-proxy
   sudo ss -tlnp | grep 8081
   sudo journalctl -u go-proxy --since "15 min ago"
   ```

2. **Correct host in extension Options**
   - Chrome on the **same** RHEL host → `localhost` or `127.0.0.1`
   - Chrome on your **laptop/another PC** → the RHEL server IP/hostname (**not** `localhost`)

3. **Correct port and scheme**
   - Go proxy default: port **8081**
   - Extension scheme must match listener:
     - Empty `tls.certFile` / `tls.keyFile` in config → extension **http**
     - TLS cert files present and readable → extension **https**

4. **Firewalld**
   ```bash
   sudo firewall-cmd --permanent --add-port=8081/tcp
   sudo firewall-cmd --reload
   ```

5. **Quick test from the Chrome machine**
   ```bash
   nc -zv PROXY_HOST 8081
   curl -v -x http://PROXY_HOST:8081 -U 'session1234:session' https://google.com -I
   ```

Use extension **Options → Test proxy port** after setting host/port/scheme.

| Response on CONNECT | Meaning | Fix |
|---------------------|---------|-----|
| **405** + `CONNECT must use upgrade` | Node proxy received CONNECT on wrong code path (fixed in latest) or old build | Update Node proxy; use port **8080** for Node |
| **405** + `"error":"connect_to_proxy_port"` | Extension pointed at **admin port 9001** | Set extension port to **8081** (Go proxy) |
| **405** + `"error":"method_not_allowed"` | POST/DELETE to admin API | Use GET only; seed sessions via valkey-cli |
| **404** + `session_not_found` | Proxy port correct; session missing in Valkey | Re-seed session |
| **407** | No session credentials yet | Save session ID in extension popup |

The **Go forward proxy (8081) never returns 405** for CONNECT. A 405 means the request hit the **admin API**, **Node proxy edge case**, or another service on that port.

1. **Proxy scheme mismatch** — if `/etc/go-proxy/config.json` has non-empty `tls.certFile` / `tls.keyFile` and the files exist, the proxy listens on HTTPS. Set the Chrome extension proxy scheme to `https`, not `http`.
2. **Missing session** — check `journalctl -u go-proxy` for `missing_session_id` on CONNECT. Reload the extension and save your session ID again.
3. **Domain blocked** — logs show `domain_not_allowed` when the site is outside the session domain and `defaultAllowedDomains` (authenticated traffic only).
4. **Public domain** — logs show `"authMode":"public"` with empty `sessionId`; no 407 for hosts in `publicDomains`.
4. **Upgrade** — rebuild and reinstall after CONNECT handler fixes: `make build && sudo make install-bin && sudo systemctl restart go-proxy`.

## Upgrade

```bash
cd go-proxy
make build
sudo systemctl stop go-proxy
sudo make install-bin
sudo systemctl start go-proxy
```
