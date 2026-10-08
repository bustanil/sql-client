package main

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"

	"github.com/bustanil/sql-client/internal/httpapi"
	"github.com/bustanil/sql-client/internal/store"
)

type readyLine struct {
	Ready bool `json:"ready"`
	Port  int  `json:"port"`
}

func main() {
	token := os.Getenv("SQLC_TOKEN")
	if token == "" {
		log.Fatal("SQLC_TOKEN is required")
	}
	dir := os.Getenv("SQLC_DATA_DIR")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatal(err)
		}
		dir = filepath.Join(home, "Library", "Application Support", "SQL Client")
	}
	st, err := store.Open(dir)
	if err != nil {
		log.Fatal(err)
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
	if err := enc.Encode(readyLine{Ready: true, Port: port}); err != nil {
		log.Fatal(err)
	}
	_ = os.Stdout.Sync()

	srv := &http.Server{Handler: httpapi.New(token, st).Handler()}
	log.Printf("listening on 127.0.0.1:%d", port)
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
