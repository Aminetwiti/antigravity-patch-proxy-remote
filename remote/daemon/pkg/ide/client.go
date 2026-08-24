package ide

import (
	"fmt"
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// Client est le contrôleur haut niveau pour piloter une instance Antigravity IDE.
type Client struct {
	instance *Instance
	rpc      *connectrpc.Client
}

// NewClient initialise un client connecté à une instance IDE.
func NewClient(inst *Instance) *Client {
	rpcClient := connectrpc.NewClient(inst.Port, inst.CSRFToken)
	rpcClient.UseTLS = false
	rpcClient.HTTP.Timeout = 120 * time.Second

	return &Client{
		instance: inst,
		rpc:      rpcClient,
	}
}

// NewAutoClient découvre automatiquement l'instance IDE et s'y connecte.
func NewAutoClient() (*Client, error) {
	inst, err := FindActiveInstance()
	if err != nil {
		return nil, err
	}
	return NewClient(inst), nil
}

// Instance retourne les métadonnées de l'instance connectée.
func (c *Client) Instance() *Instance {
	return c.instance
}

// CreateSession crée une nouvelle session de chat pour un workspace donné.
func (c *Client) CreateSession(workspacePath, modelUID string) (string, error) {
	if modelUID == "" {
		modelUID = "gemini-2.5-flash"
	}
	wsURI := workspacePath
	if wsURI != "" && !strings.HasPrefix(wsURI, "file://") {
		norm := strings.ReplaceAll(wsURI, `\`, `/`)
		wsURI = "file:///" + strings.TrimPrefix(norm, "/")
	}

	resp, err := c.rpc.CreateCascade(wsURI, "", modelUID, 0)
	if err != nil {
		return "", err
	}

	// Extraire le cascadeID depuis les champs retournés
	fields := connectrpc.DecodeFields(resp)
	for _, f := range fields {
		cid := strings.TrimSpace(string(f.Bytes))
		if len(cid) > 10 && strings.Contains(cid, "-") {
			return cid, nil
		}
		for _, sf := range connectrpc.DecodeFields(f.Bytes) {
			scid := strings.TrimSpace(string(sf.Bytes))
			if len(scid) > 10 && strings.Contains(scid, "-") {
				return scid, nil
			}
		}
	}

	return "", fmt.Errorf("impossible de décoder le cascade_id de la réponse")
}

// SendMessageStream envoie un prompt et transmet les fragments de texte et pensée au callback.
func (c *Client) SendMessageStream(cascadeID, text string, onEvent func(connectrpc.StreamEvent)) error {
	return c.rpc.SendMessageStream(cascadeID, text, func(frame []byte) error {
		events := connectrpc.ParseFrameEvents(frame, cascadeID)
		for _, ev := range events {
			onEvent(ev)
		}
		return nil
	})
}

// SetFocus force le panneau de l'IDE à s'ouvrir sur la conversation.
func (c *Client) SetFocus(cascadeID string) error {
	_, err := c.rpc.SetBrowserOpenConversation(cascadeID)
	return err
}

// GetTurnDiff récupère les modifications de fichiers associées à une étape.
func (c *Client) GetTurnDiff(cascadeID string, stepIndex int64) ([]byte, error) {
	return c.rpc.GetTurnDiff(cascadeID, stepIndex)
}

// ApproveTool transmet l'approbation ou le rejet d'un appel d'outil.
func (c *Client) ApproveTool(cascadeID, trajectoryID string, stepIndex uint32, approved bool) error {
	var payload []byte
	if approved {
		payload = []byte{0x08, 0x01} // oneof approved = true
	} else {
		payload = []byte{0x08, 0x00} // oneof approved = false
	}
	_, err := c.rpc.SubmitToolApproval(cascadeID, trajectoryID, stepIndex, 5, payload)
	return err
}

// Heartbeat teste la santé de l'instance.
func (c *Client) Heartbeat() (bool, error) {
	_, err := c.rpc.Heartbeat()
	if err != nil {
		return false, err
	}
	return true, nil
}
