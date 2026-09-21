package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/security"
)

// -----------------------------------------------------------------------------
// Built-in Tool: web_search
// -----------------------------------------------------------------------------

type WebSearchTool struct {
	client     *http.Client
	searchBase string // customizable for tests, defaults to DuckDuckGo HTML
}

func NewWebSearchTool() *WebSearchTool {
	return &WebSearchTool{
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		searchBase: "https://html.duckduckgo.com/html/?q=",
	}
}

type WebSearchParams struct {
	Query      string `json:"query"`
	MaxResults int    `json:"max_results,omitempty"`
}

func (t *WebSearchTool) Name() string { return "web_search" }
func (t *WebSearchTool) Description() string {
	return "Searches the web for technical documentation, libraries, APIs, or solutions using DuckDuckGo without external API keys."
}

func (t *WebSearchTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"query":       map[string]interface{}{"type": "string", "description": "The search query string."},
			"max_results": map[string]interface{}{"type": "integer", "description": "Maximum number of results to return (default: 5, max: 10)."},
		},
		"required": []string{"query"},
	}
}

func (t *WebSearchTool) RequiresApproval(params json.RawMessage) bool {
	// Web search is read-only and safe
	return false
}

type SearchResultItem struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

func (t *WebSearchTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	var p WebSearchParams
	if err := json.Unmarshal(params, &p); err != nil {
		return &ToolResult{Success: false, Error: "invalid parameters: " + err.Error()}, nil
	}

	query := strings.TrimSpace(p.Query)
	if query == "" {
		return &ToolResult{Success: false, Error: "query cannot be empty"}, nil
	}

	maxResults := p.MaxResults
	if maxResults <= 0 {
		maxResults = 5
	} else if maxResults > 10 {
		maxResults = 10
	}

	searchURL := t.searchBase + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, searchURL, nil)
	if err != nil {
		return &ToolResult{Success: false, Error: err.Error()}, nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := t.client.Do(req)
	if err != nil {
		return &ToolResult{Success: false, Error: "web search request failed: " + err.Error()}, nil
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return &ToolResult{Success: false, Error: "failed reading search results: " + err.Error()}, nil
	}

	results := parseDuckDuckGoHTML(string(bodyBytes), maxResults)
	if len(results) == 0 {
		out := fmt.Sprintf("No results found for query %q.", query)
		if onChunk != nil {
			onChunk([]byte(out))
		}
		return &ToolResult{Success: true, Output: out}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Web search results for %q:\n\n", query))
	for i, res := range results {
		sb.WriteString(fmt.Sprintf("%d. [%s](%s)\n   %s\n\n", i+1, res.Title, res.URL, res.Snippet))
	}

	out := strings.TrimSpace(sb.String())
	if onChunk != nil {
		onChunk([]byte(out))
	}

	return &ToolResult{Success: true, Output: out}, nil
}

var (
	resultBlockRegex = regexp.MustCompile(`(?s)<div[^>]*class="[^"]*result__body[^"]*"[^>]*>(.*?)</div>\s*</div>`)
	linkRegex        = regexp.MustCompile(`(?s)<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>|<a[^>]*class="[^"]*result__url[^"]*"[^>]*href="([^"]+)"`)
	titleRegex       = regexp.MustCompile(`(?s)<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>`)
	snippetRegex     = regexp.MustCompile(`(?s)<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>`)
)

func parseDuckDuckGoHTML(htmlContent string, max int) []SearchResultItem {
	var items []SearchResultItem

	blocks := resultBlockRegex.FindAllStringSubmatch(htmlContent, max*2)
	for _, block := range blocks {
		if len(items) >= max {
			break
		}
		content := block[1]

		titleMatch := titleRegex.FindStringSubmatch(content)
		if len(titleMatch) < 3 {
			continue
		}

		rawURL := titleMatch[1]
		title := stripHTML(titleMatch[2])

		// DuckDuckGo redirects links via /l/?kh=-1&uddg=...
		actualURL := extractActualURL(rawURL)

		snippet := ""
		snippetMatch := snippetRegex.FindStringSubmatch(content)
		if len(snippetMatch) >= 2 {
			snippet = stripHTML(snippetMatch[1])
		}

		if actualURL != "" && title != "" {
			items = append(items, SearchResultItem{
				Title:   title,
				URL:     actualURL,
				Snippet: snippet,
			})
		}
	}

	// Fallback heuristic if DuckDuckGo altered CSS classes
	if len(items) == 0 {
		anchors := titleRegex.FindAllStringSubmatch(htmlContent, max)
		for _, a := range anchors {
			if len(items) >= max {
				break
			}
			t := stripHTML(a[2])
			u := extractActualURL(a[1])
			if t != "" && u != "" {
				items = append(items, SearchResultItem{
					Title: t,
					URL:   u,
				})
			}
		}
	}

	return items
}

func extractActualURL(raw string) string {
	if strings.Contains(raw, "uddg=") {
		u, err := url.Parse(raw)
		if err == nil {
			if actual := u.Query().Get("uddg"); actual != "" {
				return actual
			}
		}
	}
	return raw
}

// -----------------------------------------------------------------------------
// Built-in Tool: fetch_web_page
// -----------------------------------------------------------------------------

type FetchWebPageTool struct {
	client               *http.Client
	allowLocalForTesting bool
}

func NewFetchWebPageTool() *FetchWebPageTool {
	return &FetchWebPageTool{
		client: security.NewSSRFProtectedClient(20 * time.Second),
	}
}

// SetClientForTesting allows tests with local mock servers to bypass SSRF checks safely.
func (t *FetchWebPageTool) SetClientForTesting(client *http.Client, allowLocal bool) {
	t.client = client
	t.allowLocalForTesting = allowLocal
}

type FetchWebPageParams struct {
	URL       string `json:"url"`
	MaxLength int    `json:"max_length,omitempty"`
}

func (t *FetchWebPageTool) Name() string { return "fetch_web_page" }
func (t *FetchWebPageTool) Description() string {
	return "Fetches content from a web URL, converts HTML to readable markdown/text, and returns the sanitized text."
}

func (t *FetchWebPageTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"url":        map[string]interface{}{"type": "string", "description": "The URL to fetch (HTTP or HTTPS)."},
			"max_length": map[string]interface{}{"type": "integer", "description": "Maximum character length of returned text (default: 12000)."},
		},
		"required": []string{"url"},
	}
}

func (t *FetchWebPageTool) RequiresApproval(params json.RawMessage) bool {
	// Read-only HTTP GET is safe
	return false
}

func (t *FetchWebPageTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	var p FetchWebPageParams
	if err := json.Unmarshal(params, &p); err != nil {
		return &ToolResult{Success: false, Error: "invalid parameters: " + err.Error()}, nil
	}

	targetURL := strings.TrimSpace(p.URL)
	if targetURL == "" {
		return &ToolResult{Success: false, Error: "url cannot be empty"}, nil
	}

	if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
		targetURL = "https://" + targetURL
	}

	if !t.allowLocalForTesting {
		if err := security.ValidateURL(targetURL); err != nil {
			return &ToolResult{Success: false, Error: "SSRF security check failed: " + err.Error()}, nil
		}
	}

	maxLen := p.MaxLength
	if maxLen <= 0 {
		maxLen = 12000
	} else if maxLen > 50000 {
		maxLen = 50000
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return &ToolResult{Success: false, Error: err.Error()}, nil
	}
	req.Header.Set("User-Agent", "ag-agentd-crawler/1.0")

	resp, err := t.client.Do(req)
	if err != nil {
		return &ToolResult{Success: false, Error: "HTTP request failed: " + err.Error()}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return &ToolResult{
			Success: false,
			Error:   fmt.Sprintf("HTTP %d: %s", resp.StatusCode, resp.Status),
		}, nil
	}

	// Read maximum 2MB
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return &ToolResult{Success: false, Error: "failed reading body: " + err.Error()}, nil
	}

	cleanText := convertHTMLToReadableText(string(bodyBytes))
	if len(cleanText) > maxLen {
		cleanText = cleanText[:maxLen] + "\n\n...[content truncated by max_length limit]..."
	}

	if onChunk != nil {
		onChunk([]byte(cleanText))
	}

	return &ToolResult{
		Success: true,
		Output:  cleanText,
	}, nil
}

// -----------------------------------------------------------------------------
// Sanitization Helpers
// -----------------------------------------------------------------------------

var (
	scriptRegex = regexp.MustCompile(`(?is)<script.*?>.*?</script>`)
	styleRegex  = regexp.MustCompile(`(?is)<style.*?>.*?</style>`)
	headRegex   = regexp.MustCompile(`(?is)<head.*?>.*?</head>`)
	tagRegex    = regexp.MustCompile(`(?is)<[^>]+>`)
	multiWsRegex = regexp.MustCompile(`[ \t]+`)
	multiNlRegex = regexp.MustCompile(`\n{3,}`)
)

func stripHTML(s string) string {
	s = scriptRegex.ReplaceAllString(s, "")
	s = styleRegex.ReplaceAllString(s, "")
	s = tagRegex.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	s = multiWsRegex.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func convertHTMLToReadableText(rawHTML string) string {
	s := scriptRegex.ReplaceAllString(rawHTML, "")
	s = styleRegex.ReplaceAllString(s, "")
	s = headRegex.ReplaceAllString(s, "")

	// Convert breaks and headers into newlines
	s = regexp.MustCompile(`(?i)<br\s*/?>`).ReplaceAllString(s, "\n")
	s = regexp.MustCompile(`(?i)</p>`).ReplaceAllString(s, "\n\n")
	s = regexp.MustCompile(`(?i)</h[1-6]>`).ReplaceAllString(s, "\n\n")
	s = regexp.MustCompile(`(?i)</li>`).ReplaceAllString(s, "\n")

	// Strip remaining tags
	s = tagRegex.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)

	// Clean excess whitespace
	lines := strings.Split(s, "\n")
	var cleaned []string
	for _, l := range lines {
		trimmed := strings.TrimSpace(multiWsRegex.ReplaceAllString(l, " "))
		if trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}

	res := strings.Join(cleaned, "\n")
	res = multiNlRegex.ReplaceAllString(res, "\n\n")
	return res
}
