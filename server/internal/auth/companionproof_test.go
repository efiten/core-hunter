package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

func newCompanion(t *testing.T) (string, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(pub), priv
}

func signProof(priv ed25519.PrivateKey, challenge string) string {
	return hex.EncodeToString(ed25519.Sign(priv, ProofMessage(challenge)))
}

func TestCompanionProofAcceptsTheCompanionsOwnSignature(t *testing.T) {
	p := NewCompanionProver()
	now := time.Now()
	pk, priv := newCompanion(t)
	ch := p.Challenge(pk, now)
	if !p.Verify(pk, ch, signProof(priv, ch), now) {
		t.Fatal("a signature by the companion's own key must prove possession")
	}
	if !p.Verify(strings.ToUpper(pk), ch, signProof(priv, ch), now) {
		t.Fatal("pubkey case must not matter")
	}
}

func TestCompanionProofRefuses(t *testing.T) {
	p := NewCompanionProver()
	now := time.Now()
	pk, priv := newCompanion(t)
	otherPk, otherPriv := newCompanion(t)
	ch := p.Challenge(pk, now)
	good := signProof(priv, ch)
	flip := map[byte]string{'0': "1"}[ch[len(ch)-1]]
	if flip == "" {
		flip = "0"
	}
	tampered := ch[:len(ch)-1] + flip

	cases := []struct {
		name        string
		pk, ch, sig string
		at          time.Time
		prover      *CompanionProver
	}{
		{"signed by another key", pk, ch, signProof(otherPriv, ch), now, p},
		{"challenge issued for another pubkey", otherPk, ch, signProof(otherPriv, ch), now, p},
		{"expired challenge", pk, ch, good, now.Add(ChallengeTTL + time.Second), p},
		{"challenge from another server", pk, ch, good, now, NewCompanionProver()},
		{"tampered challenge", pk, tampered, signProof(priv, tampered), now, p},
		{"signature over the bare challenge", pk, ch, hex.EncodeToString(ed25519.Sign(priv, []byte(ch))), now, p},
		{"not hex", pk, ch, "zz", now, p},
		{"short pubkey", "aa11", ch, good, now, p},
		{"empty", pk, "", "", now, p},
	}
	for _, c := range cases {
		if c.prover.Verify(c.pk, c.ch, c.sig, c.at) {
			t.Errorf("%s: must not prove possession", c.name)
		}
	}
}
