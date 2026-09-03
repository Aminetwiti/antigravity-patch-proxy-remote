package gateway

import (
	"encoding/json"
	"strings"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// IncomingMessage modélise toutes les requêtes JSON-RPC reçues depuis le client mobile WebSocket.
type IncomingMessage struct {
	Type          string `json:"type"`
	RequestID     string `json:"requestId"`
	WorkspaceURI  string `json:"workspaceUri"`
	WorkspacePath string `json:"workspacePath,omitempty"`
	ProjectID     string `json:"projectId,omitempty"`
	CascadeID     string `json:"cascadeId,omitempty"`
	CallID        string `json:"callId,omitempty"`
	TrajectoryID  string `json:"trajectoryID,omitempty"`
	StepIndex     int64  `json:"stepIndex,omitempty"`
	ApprovalType  string `json:"approvalType,omitempty"`
	Decision      string `json:"decision,omitempty"`
	Scope         string `json:"scope,omitempty"`
	// DenyReason : instruction libre envoyée à l'agent quand l'utilisateur
	// refuse une approbation run_command (ex. « fais un revert d'abord »).
	// Transmise dans le champ 3 (submitted) du CascadeRunCommandInteraction.
	// Vide → comportement historique (deny simple).
	DenyReason      string                 `json:"denyReason,omitempty"`
	Prompt          string                 `json:"prompt,omitempty"`
	FilePath        string                 `json:"filePath,omitempty"`
	StreamCount     int                    `json:"streamCount,omitempty"`
	Command         string                 `json:"command,omitempty"`
	LastStepIndex   int64                  `json:"lastStepIndex,omitempty"`
	LastSeq         int64                  `json:"lastSeq,omitempty"`
	OmitThinking    bool                   `json:"omitThinking,omitempty"`
	SelectedAnswers []string               `json:"selectedAnswers,omitempty"`
	CustomAnswer    string                 `json:"customAnswer,omitempty"`
	TaskID          string                 `json:"taskId,omitempty"`
	Base64Data      string                 `json:"base64Data,omitempty"`
	FileName        string                 `json:"fileName,omitempty"`
	MimeType        string                 `json:"mimeType,omitempty"`
	Title           string                 `json:"title,omitempty"`
	NewTitle        string                 `json:"newTitle,omitempty"`
	Data            map[string]interface{} `json:"data,omitempty"`
	Images          []string               `json:"images,omitempty"`
	// ModelUID : identifiant du modèle sélectionné dans l'app mobile
	// (requested_model_uid du cascade_config). Vide → repli sur ModelEnum.
	ModelUID string `json:"modelUID,omitempty"`
	// Query : terme de recherche pour search_files.
	Query string `json:"query,omitempty"`
	// ModelEnum : repli historique (requested_model_id) quand ModelUID est vide.
	ModelEnum uint64 `json:"modelEnum,omitempty"`
	// Confirm : confirmation explicite exigée pour les actions destructives
	// (delete_cascade) — le mobile DOIT l'envoyer à true après dialog natif.
	Confirm bool `json:"confirm,omitempty"`
	// Pinned : statut d'épinglage explicite pour pin_cascade / unpin_cascade.
	Pinned *bool `json:"pinned,omitempty"`
	// Content : contenu du fichier pour write_file (encodage base64 JSON → bytes).
	Content string `json:"content,omitempty"`
	// Overwrite : autorise l'écrasement pour write_file (sinon erreur si existe).
	Overwrite      bool    `json:"overwrite,omitempty"`
	ConversationID string  `json:"conversationId,omitempty"`
	StepIndices    []int64 `json:"stepIndices,omitempty"`
	// Champs MCP (call_mcp_tool / connect_mcp_server / refresh_mcp_oauth_token) :
	// relayés au proxy Antigravity desktop (AG_BIND_HOST:AG_PROXY_PORT).
	ServerName string                 `json:"serverName,omitempty"`
	ToolName   string                 `json:"toolName,omitempty"`
	Arguments  map[string]interface{} `json:"arguments,omitempty"`
	Endpoint   string                 `json:"endpoint,omitempty"`
	GrantType  string                 `json:"grantType,omitempty"`
	// TerminalID + Input : session shell interactive (P3).
	TerminalID    string `json:"terminalId,omitempty"`
	TerminalIDAlt string `json:"id,omitempty"`
	Input         string `json:"input,omitempty"`
	// NoTools : mode « réponse directe sans boucle d'outils » (planner_mode 3
	// = NO_TOOL côté LS). Porté par le message send_prompt — le mobile décide
	// par prompt si l'agent peut utiliser des outils (toggle dédié).
	NoTools bool `json:"noTools,omitempty"`
	// Media : liste structurée de pièces jointes (images/fichiers).
	Media []connectrpc.MediaAttachment `json:"media,omitempty"`
	// CommitID : identifiant de commit pour git_commit_details / vcs.get_commit_details.
	CommitID string `json:"commitId,omitempty"`
	// SidecarID : identifiant de sidecar pour les RPC sidecar.* (logs, gestion).
	SidecarID string `json:"sidecarId,omitempty"`
	// Limit : nombre max de résultats pour code_search.
	Limit int `json:"limit,omitempty"`
	// LogFileName : nom du fichier de log pour get_sidecar_logs / sidecar.get_logs.
	LogFileName string `json:"logFileName,omitempty"`
	// Champs Colosseum / Battle Mode :
	ModelUIDA     string `json:"modelUIDA,omitempty"`
	ModelEnumA    uint64 `json:"modelEnumA,omitempty"`
	ModelUIDB     string `json:"modelUIDB,omitempty"`
	ModelEnumB    uint64 `json:"modelEnumB,omitempty"`
	ArmID         string `json:"armId,omitempty"`
	WinningArmID  string `json:"winningArmId,omitempty"`
	MergeStrategy uint64 `json:"mergeStrategy,omitempty"`
	// Champs MCP Lifecycle & OAuth :
	ServerID string `json:"serverId,omitempty"`
	AuthCode string `json:"authCode,omitempty"`
	// DeviceID : identifiant de session pour les opérations admin (list/revoke) ou appareil ADB.
	DeviceID string `json:"deviceId,omitempty"`
	// Champs Git & Worktree étendus :
	Branch  string   `json:"branch,omitempty"`
	Path    string   `json:"path,omitempty"`
	Message string   `json:"message,omitempty"`
	Uris    []string `json:"uris,omitempty"`
	// Champs Upload Chunking (G2) :
	UploadID    string `json:"uploadId,omitempty"`
	ChunkIndex  int    `json:"chunkIndex,omitempty"`
	TotalChunks int    `json:"totalChunks,omitempty"`
	TotalBytes  int64  `json:"totalBytes,omitempty"`
	TargetPath  string `json:"targetPath,omitempty"`
	// Champs ADB / Phone drive (G3) :
	RemotePath string `json:"remotePath,omitempty"`
	LocalPath  string `json:"localPath,omitempty"`
	Pattern    string `json:"pattern,omitempty"`
	MaxDepth   int    `json:"maxDepth,omitempty"`
}

func (m *IncomingMessage) UnmarshalJSON(data []byte) error {
	type Alias IncomingMessage
	var raw struct {
		Alias
		ConfirmRaw   interface{} `json:"confirm"`
		OverwriteRaw interface{} `json:"overwrite"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*m = IncomingMessage(raw.Alias)
	if raw.ConfirmRaw != nil {
		switch v := raw.ConfirmRaw.(type) {
		case bool:
			m.Confirm = v
		case string:
			m.Confirm = strings.EqualFold(v, "true") || v == "1"
		}
	}
	if raw.OverwriteRaw != nil {
		switch v := raw.OverwriteRaw.(type) {
		case bool:
			m.Overwrite = v
		case string:
			m.Overwrite = strings.EqualFold(v, "true") || v == "1"
		}
	}
	return nil
}

// OutgoingMessage modélise toutes les réponses et notifications poussées aux clients mobiles.
type OutgoingMessage struct {
	Type      string      `json:"type"`
	RequestID string      `json:"requestId,omitempty"`
	CascadeID string      `json:"cascadeId,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
}
