.PHONY: all build build-linux clean test install install-bin install-config install-service install-user

BINARY := go-proxy
BIN_DIR := bin
CMD := ./cmd/proxy

GO := go
GOFLAGS := -trimpath
LDFLAGS := -s -w

INSTALL_BIN := /usr/local/bin/go-proxy
INSTALL_CONFIG_DIR := /etc/go-proxy
INSTALL_LOG_DIR := /var/log/go-proxy
SYSTEMD_UNIT := /etc/systemd/system/go-proxy.service
SERVICE_USER := go-proxy

all: build

$(BIN_DIR):
	mkdir -p $(BIN_DIR)

build: $(BIN_DIR)
	CGO_ENABLED=0 $(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY) $(CMD)

build-linux: $(BIN_DIR)
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 $(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY) $(CMD)

clean:
	rm -rf $(BIN_DIR)

test:
	$(GO) test ./...

install: install-user install-bin install-config install-service

install-bin: build
	install -m 0755 $(BIN_DIR)/$(BINARY) $(INSTALL_BIN)

install-config:
	install -d -m 0750 -o root -g $(SERVICE_USER) $(INSTALL_CONFIG_DIR)
	install -d -m 0750 -o root -g $(SERVICE_USER) $(INSTALL_CONFIG_DIR)/certs
	install -d -m 0750 -o $(SERVICE_USER) -g $(SERVICE_USER) $(INSTALL_LOG_DIR)
	install -m 0640 -o root -g $(SERVICE_USER) deploy/config.json.example $(INSTALL_CONFIG_DIR)/config.json
	install -m 0640 deploy/go-proxy.env.example $(INSTALL_CONFIG_DIR)/go-proxy.env

install-service:
	install -m 0644 deploy/go-proxy.service $(SYSTEMD_UNIT)
	install -d -m 0755 /usr/share/doc/go-proxy
	install -m 0644 deploy/README.md /usr/share/doc/go-proxy/README.md
	systemctl daemon-reload

install-user:
	id $(SERVICE_USER) >/dev/null 2>&1 || \
		useradd --system --home-dir /var/lib/$(SERVICE_USER) --shell /sbin/nologin $(SERVICE_USER)
