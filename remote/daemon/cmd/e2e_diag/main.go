package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	host := os.Getenv("AG_BIND_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	port := os.Getenv("AG_DAEMON_PORT")
	if port == "" {
		port = "8090"
	}
	u := url.URL{Scheme: "ws", Host: fmt.Sprintf("%s:%s", host, port), Path: "/ws", RawQuery: "token=11"}
	wsConn, _, wsErr := websocket.DefaultDialer.Dial(u.String(), http.Header{})
	if wsErr != nil {
		fmt.Printf("❌ WebSocket connexion err: %v\n", wsErr)
		return
	}
	defer wsConn.Close()

	cascadeID := "36138b3f-47ed-4673-b7a0-b6fda07fa922"

	// 3. get_session_history
	_ = wsConn.WriteJSON(map[string]interface{}{
		"type":      "get_session_history",
		"requestId": "test-hist-1",
		"cascadeId": cascadeID,
	})
	_ = wsConn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, hData, _ := wsConn.ReadMessage()

	var resp map[string]interface{}
	_ = json.Unmarshal(hData, &resp)
	formatted, _ := json.MarshalIndent(resp, "", "  ")
	fmt.Printf("✅ get_session_history response for %s:\n%s\n", cascadeID, string(formatted))
}
