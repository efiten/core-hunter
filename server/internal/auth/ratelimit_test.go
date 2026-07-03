package auth

import (
	"testing"
	"time"
)

func TestRateLimiter(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)
	base := time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		if !rl.Allow("1.2.3.4", base) {
			t.Fatalf("request %d should be allowed", i)
		}
	}
	if rl.Allow("1.2.3.4", base) {
		t.Fatal("6th request in the window should be blocked")
	}
	if !rl.Allow("9.9.9.9", base) {
		t.Fatal("different IP must have its own bucket")
	}
	if !rl.Allow("1.2.3.4", base.Add(61*time.Second)) {
		t.Fatal("next window should reset the bucket")
	}
}
