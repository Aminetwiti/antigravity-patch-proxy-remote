package redaction

import (
	"regexp"
)

var (
	// Private keys
	rePrivateKey = regexp.MustCompile(`-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----`)

	// Bearer tokens
	reBearer = regexp.MustCompile(`(?i)(Bearer\s+)[A-Za-z0-9_\-\.]{8,}`)

	// API Keys (OpenAI, Anthropic, GitHub, AWS, Slack)
	reAPIKeys = regexp.MustCompile(`\b(sk-[a-zA-Z0-9_\-]{20,}|sk-ant-[a-zA-Z0-9_\-]{20,}|ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[a-zA-Z0-9]{10,})\b`)

	// Connection URIs with passwords (postgres, redis, http, https, etc.)
	reConnURI = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://[^:\s/@]+:)([^@\s/]+)(@)`)

	// JSON fields containing secrets
	reJSONSecret = regexp.MustCompile(`(?i)("(?:password|passwd|secret|api_?key|auth_?token|token|access_?token|private_?key)"\s*:\s*")([^"]+)(")`)

	// CLI flags containing secrets
	reFlagSecret = regexp.MustCompile(`(?i)(--(?:password|passwd|secret|token|api-key|auth-token)[=\s])([^\s"']+)`)

	// Key=Value environment variables containing secrets
	reEnvSecret = regexp.MustCompile(`(?i)((?:PASSWORD|SECRET|API_KEY|AUTH_TOKEN|PRIVATE_KEY|ACCESS_KEY)\s*=\s*)([^\s\r\n"']+)`)
)

// Redact sanitizes sensitive secrets, API keys, passwords, and private keys from input text.
func Redact(text string) string {
	if text == "" {
		return ""
	}

	res := rePrivateKey.ReplaceAllString(text, "[REDACTED PRIVATE KEY]")
	res = reBearer.ReplaceAllString(res, "${1}[REDACTED]")
	res = reAPIKeys.ReplaceAllString(res, "[REDACTED_API_KEY]")
	res = reConnURI.ReplaceAllString(res, "${1}[REDACTED]${3}")
	res = reJSONSecret.ReplaceAllString(res, "${1}[REDACTED]${3}")
	res = reFlagSecret.ReplaceAllString(res, "${1}[REDACTED]")
	res = reEnvSecret.ReplaceAllString(res, "${1}[REDACTED]")

	return res
}
