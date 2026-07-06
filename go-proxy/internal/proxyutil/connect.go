package proxyutil

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
)

func WriteRawResponse(conn net.Conn, statusCode int, statusText string, headers map[string]string, body []byte) error {
	if statusText == "" {
		statusText = "Error"
	}

	msg := fmt.Sprintf("HTTP/1.1 %d %s\r\n", statusCode, statusText)
	for key, value := range headers {
		msg += key + ": " + value + "\r\n"
	}
	if body != nil {
		if _, ok := headers["Content-Length"]; !ok {
			msg += fmt.Sprintf("Content-Length: %d\r\n", len(body))
		}
	}
	msg += "\r\n"

	if _, err := conn.Write([]byte(msg)); err != nil {
		return err
	}
	if len(body) == 0 {
		return nil
	}
	_, err := conn.Write(body)
	return err
}

func WriteConnectJSON(conn net.Conn, statusCode int, statusText string, body interface{}) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return WriteRawResponse(conn, statusCode, statusText, map[string]string{
		"Content-Type": "application/json",
	}, payload)
}

func WriteConnectEstablished(conn net.Conn) error {
	_, err := conn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
	return err
}

func ForwardBuffered(r io.Reader, dst net.Conn) error {
	if br, ok := r.(interface{ Buffered() int }); ok && br.Buffered() > 0 {
		_, err := io.CopyN(dst, r, int64(br.Buffered()))
		return err
	}
	return nil
}
