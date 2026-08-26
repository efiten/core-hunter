package mail

import (
	"fmt"
	"net/smtp"
	"strconv"
)

type Message struct {
	To      string
	Subject string
	Body    string
}

func link(baseURL, token string) string {
	return baseURL + "/reset.html?token=" + token
}

func BuildSetPassword(baseURL, token string) Message {
	return Message{
		Subject: "Set your Mesh-Hunter password",
		Body: "An account was created for you on Mesh-Hunter.\n\n" +
			"Set your password here (link expires):\n" + link(baseURL, token) + "\n",
	}
}

func BuildReset(baseURL, token string) Message {
	return Message{
		Subject: "Reset your Mesh-Hunter password",
		Body: "A password reset was requested for your Mesh-Hunter account.\n\n" +
			"Reset it here (link expires):\n" + link(baseURL, token) +
			"\n\nIf you did not request this, ignore this email.\n",
	}
}

// BuildMemberVerified closes the loop both surfaces promise: "an admin verifies
// you as a member afterwards" (#530). No link and no token -- there is nothing
// to click, the access simply exists now -- so it names what opened up instead.
func BuildMemberVerified(baseURL string) Message {
	return Message{
		Subject: "You are verified as a Mesh-Hunter member",
		Body: "An admin has verified your Mesh-Hunter account as a member.\n\n" +
			"You now see the full history, hunters by name, and Locate:\n" + baseURL + "\n",
	}
}

type Sender struct {
	Host   string
	Port   int
	User   string
	ApiKey string
	From   string
}

func (s *Sender) Send(to string, m Message) error {
	addr := s.Host + ":" + strconv.Itoa(s.Port)
	auth := smtp.PlainAuth("", s.User, s.ApiKey, s.Host)
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s",
		s.From, to, m.Subject, m.Body)
	return smtp.SendMail(addr, auth, s.From, []string{to}, []byte(msg))
}
