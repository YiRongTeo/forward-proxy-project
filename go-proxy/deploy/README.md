# RHEL systemd deployment

Run the Go forward proxy as a systemd service on RHEL 8/9 (or compatible distros).

## Prerequisites

- Go 1.22+ (build host) or a pre-built Linux amd64 binary
- Network access to Valkey/Redis
- Root/sudo for install steps

## 1. Build the binary

On a build machine with Go installed:

```bash
cd go-proxy
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o go-proxy ./cmd/proxy
```

## 2. Install files

```bash
sudo useradd --system --home-dir /var/lib/go-proxy --shell /sbin/nologin go-proxy

sudo install -m 0755 go-proxy /usr/local/bin/go-proxy
sudo install -d -m 0750 -o go-proxy -g go-proxy /etc/go-proxy
sudo install -d -m 0750 -o go-proxy -g go-proxy /etc/go-proxy/certs
sudo install -d -m 0750 -o go-proxy -g go-proxy /var/log/go-proxy

sudo install -m 0640 -o root -g go-proxy deploy/config.json.example /etc/go-proxy/config.json
sudo install -m 0640 deploy/go-proxy.env.example /etc/go-proxy/go-proxy.env
sudo install -m 0644 deploy/go-proxy.service /etc/systemd/system/go-proxy.service
sudo install -m 0644 deploy/README.md /usr/share/doc/go-proxy/README.md
```

Edit `/etc/go-proxy/config.json` for your environment (`valkeyUrl`, `allowedClientIps`, ports, TLS paths).

If TLS is enabled, place certificate files in `/etc/go-proxy/certs/` and ensure the `go-proxy` user can read them:

```bash
sudo chown root:go-proxy /etc/go-proxy/certs/tls.crt /etc/go-proxy/certs/tls.key
sudo chmod 0640 /etc/go-proxy/certs/tls.crt /etc/go-proxy/certs/tls.key
```

If TLS is not used, set empty strings in the config:

```json
"tls": {
  "certFile": "",
  "keyFile": ""
}
```

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

## Upgrade

```bash
sudo systemctl stop go-proxy
sudo install -m 0755 go-proxy /usr/local/bin/go-proxy
sudo systemctl start go-proxy
```
