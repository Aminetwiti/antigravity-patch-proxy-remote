package redaction

import (
	"strings"
	"testing"
)

func TestRedact(t *testing.T) {
	input := `
Connection: postgres://admin:super_secret_password_123@db.prod.internal:5432/main
OpenAI Key: sk-proj-abcdefghijklmnopqrstuvwxyz123456
Anthropic Key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456
GitHub PAT: ghp_1234567890abcdefghijklmnopqrstuvwxyz
AWS Key: AKIAIOSFODNN7EXAMPLE
Bearer: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0
Env Var: DATABASE_SECRET=my_ultra_secret_value
JSON: {"api_key": "secret_key_inside_json", "status": "ok"}
CLI: curl --token=secret_cli_token https://api.com
Private Key:
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1234567890abcdefghijklmnopqrstuvwxyz
-----END RSA PRIVATE KEY-----
`

	redacted := Redact(input)

	forbiddenStrings := []string{
		"super_secret_password_123",
		"sk-proj-abcdefghijklmnopqrstuvwxyz123456",
		"sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456",
		"ghp_1234567890abcdefghijklmnopqrstuvwxyz",
		"AKIAIOSFODNN7EXAMPLE",
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
		"my_ultra_secret_value",
		"secret_key_inside_json",
		"secret_cli_token",
		"MIIEowIBAAKCAQEA0Y1234567890",
	}

	for _, s := range forbiddenStrings {
		if strings.Contains(redacted, s) {
			t.Errorf("expected %q to be redacted from output, but it was found in:\n%s", s, redacted)
		}
	}

	if !strings.Contains(redacted, "[REDACTED") {
		t.Errorf("expected redacted markers in output")
	}
}
