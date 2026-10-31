package cdp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// RPCRequest représente une commande CDP JSON-RPC.
type RPCRequest struct {
	ID     int64       `json:"id"`
	Method string      `json:"method"`
	Params interface{} `json:"params,omitempty"`
}

// RPCResponse représente la réponse d'une commande CDP JSON-RPC.
type RPCResponse struct {
	ID     int64           `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *RPCError       `json:"error,omitempty"`
}

// RPCError détaille une erreur renvoyée par Chromium.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data,omitempty"`
}

func (e *RPCError) Error() string {
	return fmt.Sprintf("CDP error %d: %s (%s)", e.Code, e.Message, e.Data)
}

// Client gère une connexion WebSocket CDP avec Chromium/Electron.
type Client struct {
	wsURL   string
	conn    *websocket.Conn
	mu      sync.Mutex
	reqSeq  int64
	pending map[int64]chan *RPCResponse
	done    chan struct{}
	closed  bool
}

// Dial établit la connexion avec la cible CDP spécifiée.
func Dial(wsURL string, timeout time.Duration) (*Client, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout: timeout,
		Proxy:            http.ProxyFromEnvironment,
	}

	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("erreur de connexion CDP ws (%s): %w", wsURL, err)
	}

	c := &Client{
		wsURL:   wsURL,
		conn:    conn,
		pending: make(map[int64]chan *RPCResponse),
		done:    make(chan struct{}),
	}

	go c.readPump()
	return c, nil
}

func (c *Client) readPump() {
	defer func() {
		c.mu.Lock()
		c.closed = true
		for _, ch := range c.pending {
			close(ch)
		}
		c.pending = make(map[int64]chan *RPCResponse)
		c.mu.Unlock()
		close(c.done)
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			return
		}

		var resp RPCResponse
		if err := json.Unmarshal(message, &resp); err != nil {
			continue
		}

		if resp.ID != 0 {
			c.mu.Lock()
			ch, ok := c.pending[resp.ID]
			if ok {
				delete(c.pending, resp.ID)
			}
			c.mu.Unlock()

			if ok {
				ch <- &resp
			}
		}
	}
}

// Call exécute une méthode CDP et attend sa réponse.
func (c *Client) Call(ctx context.Context, method string, params interface{}) (json.RawMessage, error) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, fmt.Errorf("client CDP fermé")
	}

	id := atomic.AddInt64(&c.reqSeq, 1)
	ch := make(chan *RPCResponse, 1)
	c.pending[id] = ch

	req := RPCRequest{
		ID:     id,
		Method: method,
		Params: params,
	}

	err := c.conn.WriteJSON(req)
	c.mu.Unlock()

	if err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("erreur envoi CDP: %w", err)
	}

	select {
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, ctx.Err()
	case resp, ok := <-ch:
		if !ok {
			return nil, fmt.Errorf("connexion CDP fermée prématurément")
		}
		if resp.Error != nil {
			return nil, resp.Error
		}
		return resp.Result, nil
	}
}

// CaptureScreenshot capture l'écran de la fenêtre de l'IDE en Base64.
func (c *Client) CaptureScreenshot(ctx context.Context, format string, quality int) (string, error) {
	if format == "" {
		format = "png"
	}

	params := map[string]interface{}{
		"format": format,
	}
	if format == "jpeg" && quality > 0 {
		params["quality"] = quality
	}

	res, err := c.Call(ctx, "Page.captureScreenshot", params)
	if err != nil {
		return "", err
	}

	var result struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(res, &result); err != nil {
		return "", fmt.Errorf("erreur décodage screenshot: %w", err)
	}

	return result.Data, nil
}

// Navigate redirige la vue de l'IDE vers l'URL spécifiée.
func (c *Client) Navigate(ctx context.Context, url string) error {
	_, err := c.Call(ctx, "Page.navigate", map[string]interface{}{
		"url": url,
	})
	return err
}

// Evaluate exécute une expression JavaScript dans le contexte de la page.
func (c *Client) Evaluate(ctx context.Context, expression string) (json.RawMessage, error) {
	res, err := c.Call(ctx, "Runtime.evaluate", map[string]interface{}{
		"expression":    expression,
		"returnByValue": true,
	})
	if err != nil {
		return nil, err
	}

	var result struct {
		Result struct {
			Value json.RawMessage `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(res, &result); err == nil && len(result.Result.Value) > 0 {
		return result.Result.Value, nil
	}

	return res, nil
}

// Close termine la session CDP.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	return c.conn.Close()
}
