package auth

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"strings"
	"time"
)

// Proof that a caller holds a companion, before its pubkey is linked to an
// account. The pubkey is public, so naming it proves nothing: the companion
// has to sign a fresh challenge with its own key. The app asks the radio to do
// that (app/src/companionsign.js), so the private key never leaves it.
//
// The challenge is stateless: exp(8) || nonce(16) || HMAC-SHA256(key, pubkey ||
// exp || nonce), hex. Nothing is stored per challenge, so asking for one costs
// the server nothing. The key lives in memory only; a restart voids the
// challenges in flight, which the app answers by asking for a new one.

// ChallengeTTL bounds how long a challenge can be answered.
const ChallengeTTL = 5 * time.Minute

const proofPrefix = "core-hunter-link:"

// ProofMessage is what the companion signs: a prefix, so the signature cannot
// be lifted into another protocol that signs with the same key, and the
// challenge.
func ProofMessage(challenge string) []byte {
	return []byte(proofPrefix + challenge)
}

type CompanionProver struct {
	key []byte
}

func NewCompanionProver() *CompanionProver {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic(err)
	}
	return &CompanionProver{key: key}
}

func (p *CompanionProver) mac(pubkey string, body []byte) []byte {
	m := hmac.New(sha256.New, p.key)
	m.Write([]byte(pubkey))
	m.Write(body)
	return m.Sum(nil)
}

// Challenge issues a challenge bound to this pubkey.
func (p *CompanionProver) Challenge(pubkeyHex string, now time.Time) string {
	body := make([]byte, 24)
	binary.BigEndian.PutUint64(body, uint64(now.Add(ChallengeTTL).Unix()))
	if _, err := rand.Read(body[8:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(append(body, p.mac(strings.ToLower(pubkeyHex), body)...))
}

// Verify reports whether sigHex is the pubkey's signature over a challenge
// this prover issued for that pubkey and that has not expired.
func (p *CompanionProver) Verify(pubkeyHex, challenge, sigHex string, now time.Time) bool {
	pub, err := hex.DecodeString(pubkeyHex)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return false
	}
	raw, err := hex.DecodeString(challenge)
	if err != nil || len(raw) != 24+sha256.Size {
		return false
	}
	body, tag := raw[:24], raw[24:]
	if !hmac.Equal(tag, p.mac(strings.ToLower(pubkeyHex), body)) {
		return false
	}
	if now.Unix() > int64(binary.BigEndian.Uint64(body)) {
		return false
	}
	sig, err := hex.DecodeString(sigHex)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(pub, ProofMessage(challenge), sig)
}
