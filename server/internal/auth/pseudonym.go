package auth

import (
	"regexp"
	"strconv"
)

// Pseudonyms maps a real hunter pubkey -> ordinal N (1-based, by first appearance).
type Pseudonyms map[string]int

func (p Pseudonyms) ordinal(pubkey string) int { return p[pubkey] }
func (p Pseudonyms) Token(pubkey string) string {
	return "h" + strconv.Itoa(p.ordinal(pubkey))
}
func (p Pseudonyms) Name(pubkey string) string {
	return "Hunter " + strconv.Itoa(p.ordinal(pubkey))
}

var pseudoRe = regexp.MustCompile(`^h(\d+)$`)

func ParsePseudonym(token string) (int, bool) {
	m := pseudoRe.FindStringSubmatch(token)
	if m == nil {
		return 0, false
	}
	n, _ := strconv.Atoi(m[1])
	return n, true
}
