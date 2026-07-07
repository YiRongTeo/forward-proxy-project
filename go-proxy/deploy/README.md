# RHEL systemd deployment

Run the Go forward proxy as a systemd service on RHEL 8/9 (or compatible distros).

## Valkey key schema

Each domain entitlement is one key; the value is the password:

```bash
valkey-cli SET 'sessions:alice:google.com' 's3cret' EX 3600
valkey-cli SET 'sessions:alice:example.com' 's3cret' EX 3600
```

Users authenticate with `Proxy-Authorization: Basic alice:s3cret`. The same credentials work on every proxy server.

Seed from the repo:

```bash
./benchmarks/seed-one.sh alice google.com s3cret /etc/go-proxy/config.json
```

## Build and install

```bash
cd go-proxy
make build
sudo make install
```

Edit `/etc/go-proxy/config.json`:

```json
{
  "valkeySessionsPrefix": "sessions",
  "requireProxyAuth": true
}
```

## Service management

```bash
sudo systemctl enable --now go-proxy.service
sudo journalctl -u go-proxy -f
```

## Logs

| Field | Meaning |
|-------|---------|
| `authMode: "credential"` | Proxy-Authorization validated against domain key |
| `authMode: "public"` | Host in `publicDomains` |
| `matchedDomainKey` | Valkey domain suffix that matched |
| `invalid_credentials` | Key exists but password mismatch |
| `domain_not_allowed` | No matching domain key |

## Verify

```bash
curl -v -x http://127.0.0.1:8081 -U 'alice:s3cret' https://google.com -o /dev/null
curl -s http://127.0.0.1:9001/sessions/alice | jq .
```

## Upgrade

```bash
cd go-proxy && make build
sudo systemctl stop go-proxy
sudo make install-bin
sudo systemctl start go-proxy
```
