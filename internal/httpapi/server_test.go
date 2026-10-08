package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthRequiresToken(t *testing.T) {
	s := New("secret", nil)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}

	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestListenLoopbackOnly(t *testing.T) {
	ln, err := Listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ln.Close()

	if _, err := Listen("0.0.0.0:0"); err == nil {
		t.Fatal("expected non-loopback address to be refused")
	}
}
