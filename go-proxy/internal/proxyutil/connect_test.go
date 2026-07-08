package proxyutil

import (
	"net"
	"testing"
)

func TestWriteConnectEstablished(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	done := make(chan string, 1)
	go func() {
		buf := make([]byte, 128)
		n, _ := server.Read(buf)
		done <- string(buf[:n])
	}()

	if err := WriteConnectEstablished(client); err != nil {
		t.Fatalf("write 200: %v", err)
	}

	resp := <-done
	want := "HTTP/1.1 200 Connection Established\r\n\r\n"
	if resp != want {
		t.Fatalf("got %q want %q", resp, want)
	}
}

func TestWriteConnectProxyAuthRequiredRaw(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	done := make(chan string, 1)
	go func() {
		buf := make([]byte, 256)
		n, _ := server.Read(buf)
		done <- string(buf[:n])
	}()

	if err := WriteConnectProxyAuthRequiredRaw(client); err != nil {
		t.Fatalf("write 407: %v", err)
	}

	resp := <-done
	want := "HTTP/1.1 407 Proxy Authentication Required\r\n" +
		"Proxy-Authenticate: Basic realm=\"forward-proxy\"\r\n" +
		"Content-Length: 0\r\n\r\n"
	if resp != want {
		t.Fatalf("got %q want %q", resp, want)
	}
}
