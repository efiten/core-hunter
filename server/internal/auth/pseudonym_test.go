package auth

import "testing"

func TestPseudonyms(t *testing.T) {
	p := Pseudonyms{"aaaa": 1, "bbbb": 2}
	if p.Token("bbbb") != "h2" || p.Name("bbbb") != "Hunter 2" {
		t.Fatalf("token/name wrong: %s %s", p.Token("bbbb"), p.Name("bbbb"))
	}
	if p.Token("zzzz") != "h0" {
		t.Fatalf("unknown pubkey should map to h0, got %s", p.Token("zzzz"))
	}
}

func TestParsePseudonym(t *testing.T) {
	if n, ok := ParsePseudonym("h3"); !ok || n != 3 {
		t.Fatalf("h3 -> %d,%v", n, ok)
	}
	if _, ok := ParsePseudonym("abc123"); ok {
		t.Fatal("non-token must not parse")
	}
	if _, ok := ParsePseudonym("h"); ok {
		t.Fatal("bare h must not parse")
	}
	// a real 64-hex pubkey must not parse as a pseudonym
	if _, ok := ParsePseudonym("aa11bb22aa11bb22aa11bb22aa11bb22aa11bb22aa11bb22aa11bb22aa11bb22"); ok {
		t.Fatal("real pubkey must not parse as pseudonym")
	}
}
