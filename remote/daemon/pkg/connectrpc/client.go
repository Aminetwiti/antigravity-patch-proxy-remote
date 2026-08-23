package connectrpc

import (
	"bytes"
	"crypto/tls"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Client parle le protocole gRPC-Web validé (voir remote/PROTOCOL.md) :
//
//	POST /exa.language_server_pb.LanguageServerService/<Method>
//	Content-Type: application/grpc-web+proto
//	x-codeium-csrf-token: <token>   (et non X-CSRF-Token)
//	Framing: 1 octet flags + 4 octets BE longueur + payload protobuf
type Client struct {
	mu        sync.RWMutex
	port      int
	csrfToken string
	Host      string
	UseTLS    bool
	HTTP      *http.Client
	// APIKey est la clé d'API envoyée au Language Server (champ metadata 3).
	// Sans elle le LS répond « untrusted workspace ».
	APIKey string
	// SessionID stable sur la session — le LS associe l'état du panneau à
	// cette valeur (voir buildMetadata champ 10).
	SessionID string
	// ModelUID / ModelEnum : modèle demandé pour les messages cascade
	// (cascade_config requested_model_uid/id). Renseigné au démarrage.
	ModelUID  string
	ModelEnum uint64
}

func NewClient(port int, csrfToken string) *Client {
	transport := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
		DisableKeepAlives:   false,
		ForceAttemptHTTP2:   true,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true}, // #nosec G402 — certificat auto-signé LS
	}
	return &Client{
		port:      port,
		csrfToken: csrfToken,
		Host:      "127.0.0.1",
		HTTP: &http.Client{
			Timeout:   60 * time.Second,
			Transport: transport,
		},
	}
}

// Scheme retourne "https" ou "http" selon la configuration TLS.
func (c *Client) Scheme() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.UseTLS {
		return "https"
	}
	return "http"
}

// SetUseTLS active ou désactive l'utilisation de HTTPS/TLS.
func (c *Client) SetUseTLS(useTLS bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.UseTLS = useTLS
}

// Endpoint retourne le port et le jeton CSRF de maniÃ¨re thread-safe.
func (c *Client) Endpoint() (int, string) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.port, c.csrfToken
}

// UpdateEndpoint met Ã  jour le port et le jeton CSRF suite Ã  un dÃ©marrage du hub.
func (c *Client) UpdateEndpoint(port int, csrfToken string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.port = port
	c.csrfToken = csrfToken
}

// Frame encadre un message protobuf pour gRPC-Web.
func Frame(payload []byte) []byte {
	buf := make([]byte, 5+len(payload))
	buf[0] = 0 // flags: pas de compression
	binary.BigEndian.PutUint32(buf[1:5], uint32(len(payload)))
	copy(buf[5:], payload)
	return buf
}

// Call exécute une méthode RPC et retourne les messages protobuf bruts.
func (c *Client) Call(method string, payload []byte) ([]byte, error) {
	port, csrfToken := c.Endpoint()
	scheme := c.Scheme()
	url := fmt.Sprintf("%s://%s:%d/exa.language_server_pb.LanguageServerService/%s", scheme, c.Host, port, method)
	body := Frame(payload)

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/grpc-web+proto")
	req.Header.Set("Accept", "application/grpc-web+proto,application/grpc-web-text")
	req.Header.Set("x-codeium-csrf-token", csrfToken)
	req.Header.Set("Connect-Protocol-Version", "1")
	req.Header.Set("X-Grpc-Web", "1")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		rawStr := string(raw)
		if scheme == "http" && strings.Contains(rawStr, "HTTPS server") {
			c.SetUseTLS(true)
			return c.Call(method, payload)
		}
		return raw, fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(rawStr, 200))
	}

	if st := resp.Header.Get("grpc-status"); st != "" && st != "0" {
		msg := resp.Header.Get("grpc-message")
		return raw, fmt.Errorf("gRPC status %s: %s", st, msg)
	}

	// Découper les frames gRPC-Web : flags(1) + longueur BE(4) + message
	var frames [][]byte
	var trailerErr error
	offset := 0
	for offset+5 <= len(raw) {
		flags := raw[offset]
		length := int(binary.BigEndian.Uint32(raw[offset+1 : offset+5]))
		offset += 5
		if offset+length > len(raw) {
			break // trailer tronqué
		}
		if flags&0x80 != 0 {
			trailerText := string(raw[offset : offset+length])
			if strings.Contains(trailerText, "grpc-status:") {
				for _, line := range strings.Split(trailerText, "\r\n") {
					line = strings.TrimSpace(line)
					if strings.HasPrefix(line, "grpc-status:") {
						st := strings.TrimSpace(strings.TrimPrefix(line, "grpc-status:"))
						if st != "" && st != "0" {
							trailerErr = fmt.Errorf("gRPC trailer error: %s", trailerText)
						}
					}
				}
			}
		} else if length > 0 {
			frames = append(frames, raw[offset:offset+length])
		}
		offset += length
	}
	if len(frames) == 0 {
		if trailerErr != nil {
			return nil, trailerErr
		}
		return []byte{}, nil
	}
	return frames[0], nil
}

// CallJSON exécute une méthode RPC en ConnectRPC JSON direct (Content-Type: application/json).
func (c *Client) CallJSON(method string, payload []byte) ([]byte, error) {
	port, csrfToken := c.Endpoint()
	scheme := c.Scheme()
	url := fmt.Sprintf("%s://%s:%d/exa.language_server_pb.LanguageServerService/%s", scheme, c.Host, port, method)
	if len(payload) == 0 {
		payload = []byte("{}")
	}
	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	req.Header.Set("x-codeium-csrf-token", csrfToken)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		rawStr := string(raw)
		if scheme == "http" && strings.Contains(rawStr, "HTTPS server") {
			c.SetUseTLS(true)
			return c.CallJSON(method, payload)
		}
		return raw, fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(rawStr, 200))
	}
	return raw, nil
}

// CallStream exécute une méthode RPC en streaming gRPC-Web et invoque onFrame pour chaque frame protobuf reçue.
func (c *Client) CallStream(method string, payload []byte, timeout time.Duration, onFrame func([]byte) error) error {
	port, csrfToken := c.Endpoint()
	scheme := c.Scheme()
	url := fmt.Sprintf("%s://%s:%d/exa.language_server_pb.LanguageServerService/%s", scheme, c.Host, port, method)
	body := Frame(payload)

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/grpc-web+proto")
	req.Header.Set("Accept", "application/grpc-web+proto,application/grpc-web-text")
	req.Header.Set("x-codeium-csrf-token", csrfToken)
	req.Header.Set("Connect-Protocol-Version", "1")
	req.Header.Set("X-Grpc-Web", "1")

	client := &http.Client{Timeout: timeout, Transport: c.HTTP.Transport}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		rawStr := string(raw)
		if scheme == "http" && strings.Contains(rawStr, "HTTPS server") {
			c.SetUseTLS(true)
			return c.CallStream(method, payload, timeout, onFrame)
		}
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(rawStr, 200))
	}

	buf := make([]byte, 32768)
	var accumulated []byte

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			accumulated = append(accumulated, buf[:n]...)
			frames, rest := splitFrames(accumulated)
			accumulated = rest
			for _, frameData := range frames {
				if err := onFrame(frameData); err != nil {
					return err
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return readErr
		}
	}
	return nil
}

// splitFrames extrait les frames gRPC-Web complètes d'un buffer.
// Retourne les frames de données (les trailers flag 0x80 sont ignorés) et
// le reste fragmentaire non consommé (frame partielle en attente de données).
func splitFrames(buf []byte) ([][]byte, []byte) {
	var frames [][]byte
	for len(buf) >= 5 {
		flags := buf[0]
		length := int(binary.BigEndian.Uint32(buf[1:5]))
		if len(buf) < 5+length {
			break
		}
		if flags&0x80 == 0 {
			frames = append(frames, buf[5:5+length])
		}
		buf = buf[5+length:]
	}
	return frames, buf
}

// CallStreamJSON exécute une méthode RPC en server-streaming Connect JSON
// (Content-Type: application/connect+json, requête et frames en JSON brut,
// pas de protobuf). Utilisé par les flux Jetbox (JetboxSubscribeToSummaries,
// ProjectUpdatesStream) — même framing gRPC-Web (1 octet flags + 4 octets BE
// longueur + payload JSON), cf. jetbox.js du projet Deck.
//
// Le body de la requête est déjà une frame encodée (encodeEnvelope côté
// vendor) : {flags=0}{len BE}{json}. timeout = durée maximale de la requête
// HTTP ; un flux long doit passer par une valeur généreuse (le LS pousse des
// frames au fil de l'eau, la connexion reste ouverte).
func (c *Client) CallStreamJSON(method string, body []byte, timeout time.Duration, onFrame func([]byte) error) error {
	port, csrfToken := c.Endpoint()
	scheme := c.Scheme()
	url := fmt.Sprintf("%s://%s:%d/exa.language_server_pb.LanguageServerService/%s", scheme, c.Host, port, method)

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/connect+json")
	req.Header.Set("Connect-Protocol-Version", "1")
	req.Header.Set("x-codeium-csrf-token", csrfToken)

	client := &http.Client{Timeout: timeout, Transport: c.HTTP.Transport}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		rawStr := string(raw)
		if scheme == "http" && strings.Contains(rawStr, "HTTPS server") {
			c.SetUseTLS(true)
			return c.CallStreamJSON(method, body, timeout, onFrame)
		}
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(rawStr, 200))
	}

	buf := make([]byte, 32768)
	var accumulated []byte
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			accumulated = append(accumulated, buf[:n]...)
			frames, rest := splitFrames(accumulated)
			accumulated = rest
			for _, frameData := range frames {
				if err := onFrame(frameData); err != nil {
					return err
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return readErr
		}
	}
	return nil
}

// JetboxEnvelope encadre un body JSON pour les flux Connect JSON (même
// format que encodeEnvelope de jetbox.js : flags 0 + longueur BE + payload).
func JetboxEnvelope(jsonBody []byte) []byte {
	buf := make([]byte, 5+len(jsonBody))
	buf[0] = 0
	binary.BigEndian.PutUint32(buf[1:5], uint32(len(jsonBody)))
	copy(buf[5:], jsonBody)
	return buf
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// GetRevertPreview demande la prévisualisation du rollback d'une cascade.
func (c *Client) GetRevertPreview(cascadeID string, stepIndex int64) ([]byte, error) {
	c.mu.RLock()
	apiKey := c.APIKey
	sessionID := c.SessionID
	modelUID := c.ModelUID
	modelEnum := c.ModelEnum
	c.mu.RUnlock()
	payload := BuildGetRevertPreview(cascadeID, stepIndex, apiKey, sessionID, modelUID, modelEnum)
	return c.Call("GetRevertPreview", payload)
}

// RevertToCascadeStep applique le rollback de la cascade à une étape donnée.
func (c *Client) RevertToCascadeStep(cascadeID string, stepIndex int64) error {
	c.mu.RLock()
	apiKey := c.APIKey
	sessionID := c.SessionID
	modelUID := c.ModelUID
	modelEnum := c.ModelEnum
	c.mu.RUnlock()
	payload := BuildRevertToCascadeStep(cascadeID, stepIndex, apiKey, sessionID, modelUID, modelEnum)
	_, err := c.Call("RevertToCascadeStep", payload)
	return err
}

// SendStepsToBackground bascule des étapes en tâche d'arrière-plan.
func (c *Client) SendStepsToBackground(conversationID string, stepIndices []int64) error {
	payload := BuildSendStepsToBackground(conversationID, stepIndices)
	_, err := c.Call("SendStepsToBackground", payload)
	return err
}

// SkipBrowserSubagent saute une étape de sous-agent de navigation.
func (c *Client) SkipBrowserSubagent(cascadeID string, stepIndex int64) error {
	payload := BuildSkipBrowserSubagent(cascadeID, stepIndex)
	_, err := c.Call("SkipBrowserSubagent", payload)
	return err
}

// RetrieveUserQuotaSummary récupère le résumé des quotas utilisateur du Language Server.
func (c *Client) RetrieveUserQuotaSummary() ([]byte, error) {
	c.mu.RLock()
	apiKey := c.APIKey
	sessionID := c.SessionID
	c.mu.RUnlock()
	payload := BuildRetrieveUserQuotaSummary(apiKey, sessionID)
	return c.Call("RetrieveUserQuotaSummary", payload)
}

// RunJetboxSubscription ouvre le stream server-streaming
// JetboxSubscribeToSummaries (application/connect+json, cf. jetbox.js du Deck)
// et appelle onSummary à chaque frame : {updates: {id: summary}, deletes: [ids]}.
// Le stream est long-vivant : la connexion HTTP reste ouverte et le LS pousse
// le snapshot initial puis les mises à jour incrémentales. Retourne une erreur
// uniquement si la connexion échoue — l'appelant décide de la reconnexion.
func (c *Client) RunJetboxSubscription(onSummary func(updates map[string]JetboxSummary, deletes []string)) error {
	return c.CallStreamJSON("JetboxSubscribeToSummaries", JetboxEnvelope([]byte("{}")), 0, func(frame []byte) error {
		updates, deletes := ParseJetboxFrame(frame)
		if len(updates) > 0 || len(deletes) > 0 {
			onSummary(updates, deletes)
		}
		return nil
	})
}
