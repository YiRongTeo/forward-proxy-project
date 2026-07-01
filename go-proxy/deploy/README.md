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

## Firewalld (optional)

```bash
sudo firewall-cmd --permanent --add-port=8081/tcp
sudo firewall-cmd --permanent --add-port=9001/tcp
sudo firewall-cmd --reload
```

Port `8081` is the forward proxy; port `9001` is the read-only admin API.

## Troubleshooting `ERR_TUNNEL_CONNECTION_FAILED`

1. **Proxy scheme mismatch** — if `/etc/go-proxy/config.json` has non-empty `tls.certFile` / `tls.keyFile` and the files exist, the proxy listens on HTTPS. Set the Chrome extension proxy scheme to `https`, not `http`.
2. **Missing session** — check `journalctl -u go-proxy` for `missing_session_id` on CONNECT. Reload the extension and save your session ID again.
3. **Domain blocked** — logs show `domain_not_allowed` when the site is outside the session domain and `defaultAllowedDomains`.
4. **Upgrade** — rebuild and reinstall after CONNECT handler fixes: `make build && sudo make install-bin && sudo systemctl restart go-proxy`.

## Upgrade

```bash
cd go-proxy
make build
sudo systemctl stop go-proxy
sudo make install-bin
sudo systemctl start go-proxy
```
