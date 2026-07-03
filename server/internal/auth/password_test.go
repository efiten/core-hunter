package auth

import "testing"

func TestHashAndCheck(t *testing.T) {
	h, err := HashPassword("correcthorse")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if h == "correcthorse" || len(h) < 20 {
		t.Fatalf("hash looks wrong: %q", h)
	}
	if !CheckPassword(h, "correcthorse") {
		t.Fatal("correct password rejected")
	}
	if CheckPassword(h, "wrong") {
		t.Fatal("wrong password accepted")
	}
}

func TestValidPassword(t *testing.T) {
	if ValidPassword("short") {
		t.Fatal("short password should be invalid")
	}
	if !ValidPassword("tenletters!") {
		t.Fatal("10+ char password should be valid")
	}
}
