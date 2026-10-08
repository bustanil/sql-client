package main

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"

	"github.com/bustanil/sql-client/internal/httpapi"
)

func main() {
	token := os.Getenv("SQLC_TOKEN")
	if token == "" {
		log.Fatal("SQLC_TOKEN is required")
	}
	addr := os.Getenv("SQLC_ADDR")
	if addr == "" {
		addr = "127.0.0.1:0"
	}
	ln, err := httpapi.Listen(addr)
	if err != nil {
		log.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(map[string]any{"ready": true, "port": port}); err != nil {
		log.Fatal(err)
	}
	_ = os.Stdout.Sync()

	srv := &http.Server{Handler: httpapi.New(token).Handler()}
	log.Printf("listening on 127.0.0.1:%d", port)
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
