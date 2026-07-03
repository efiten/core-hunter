package auth

import "golang.org/x/crypto/bcrypt"

const MinPasswordLen = 10

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func ValidPassword(pw string) bool { return len(pw) >= MinPasswordLen }
