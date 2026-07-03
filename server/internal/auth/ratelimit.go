package auth

import (
	"sync"
	"time"
)

type bucket struct {
	windowStart time.Time
	count       int
}

type RateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	m      map[string]*bucket
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{limit: limit, window: window, m: map[string]*bucket{}}
}

func (rl *RateLimiter) Allow(key string, now time.Time) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	b := rl.m[key]
	if b == nil || now.Sub(b.windowStart) >= rl.window {
		rl.m[key] = &bucket{windowStart: now, count: 1}
		return true
	}
	if b.count >= rl.limit {
		return false
	}
	b.count++
	return true
}
