package connectrpc

import (
	"encoding/json"
	"strings"
)

// Flux réactif StreamReactiveUpdates (application/connect+json, cf. le SDK
// officiel antigravity-client et reactive_component_pb.ts) : le Language
// Server pousse l'état des cascades (status, requestedInteraction, waiting…)
// au fil de l'eau. C'est une SOURCE SECONDAIRE de fiabilité pour le daemon :
// le chemin principal reste le parsing des frames de réponse (ParseFrameEvents,
// déjà testé). On ne décode que ce dont le daemon a besoin : le statut de la
// cascade (pour la détection instantanée "waiting for input") et la demande
// d'interaction (approbation d'outil).

// CascadeRunStatus : enum du LS (CascadeRunStatus, cortex_pb.ts ligne 843).
// 1 IDLE, 2 RUNNING, 3 CANCELING, 4 BUSY. Nommées en protojson, acceptées
// aussi en nombre et en snake_case par robustesse.
const (
	ReactiveStatusIdle      = 1
	ReactiveStatusRunning   = 2
	ReactiveStatusCanceling = 3
	ReactiveStatusBusy      = 4
)

// InteractionType : enum du LS pour requestedInteraction (field 56 du
// CascadeState — carte établie par le Deck : le oneof member exact doit être
// répondu, sinon le LS droppe silencieusement la décision). Les valeurs
// 5/6/19/21/23 sont déjà déclarées dans protobuf.go (même package).
const (
	InteractionNone            = 0
	InteractionPlanApproval    = 2
	InteractionSingleSelect    = 3
	InteractionMultiSelect     = 4
	InteractionApprovalTypeAsk = 10
)

// ReactiveUpdate : état décodé d'une cascade à partir d'une frame du stream.
// Seuls les champs utiles au daemon sont exposés (YAGNI : pas de miroir complet
// de CascadeState).
type ReactiveUpdate struct {
	CascadeID            string
	Status               int    // ReactiveStatus* — 0 si absent
	RequestedInteraction int    // Interaction* — 0 = aucune demande
	WaitingForInput      bool   // computed : status IDLE + interaction active
	StepIndex            uint32 // step_index de la demande d'interaction
	TrajectoryID         string // trajectory_id de la demande d'interaction
	CallID               string // call_id de la demande (corrélation mobile)
	Model                string // modèle en cours (log)
}

// reactiveFrame : forme wire d'une frame du stream. Le LS peut pousser soit
// une mise à jour de cascade directe, soit un wrapper {updates: {...}}.
type reactiveFrame struct {
	Updates map[string]json.RawMessage `json:"updates"`
	// Champs du CascadeState en protojson (camelCase).
	CascadeID            string          `json:"cascadeId,omitempty"`
	Status               any             `json:"status,omitempty"`
	RequestedInteraction json.RawMessage `json:"requestedInteraction,omitempty"`
	StepIndex            uint32          `json:"stepIndex,omitempty"`
	TrajectoryID         string          `json:"trajectoryId,omitempty"`
	CallID               string          `json:"callId,omitempty"`
	Model                string          `json:"model,omitempty"`
}

// reactiveInteraction : forme wire de requestedInteraction. Le champ
// "interactionType" (protojson de l'enum InteractionType) est la clé ; on
// accepte aussi le membre oneof "interactionTypeV2" et les variantes
// snake_case par robustesse.
type reactiveInteraction struct {
	InteractionType      any `json:"interactionType,omitempty"`
	InteractionTypeSnake any `json:"interaction_type,omitempty"`
}

// ParseReactiveFrame décode une frame JSON du stream StreamReactiveUpdates.
// Retourne les mises à jour par cascadeId. Une frame vide ou sans cascade
// identifiable est ignorée silencieusement (heartbeat/snapshot).
func ParseReactiveFrame(frame []byte) map[string]ReactiveUpdate {
	var f reactiveFrame
	if err := json.Unmarshal(frame, &f); err != nil {
		return nil
	}
	out := make(map[string]ReactiveUpdate)
	if len(f.Updates) > 0 {
		for id, raw := range f.Updates {
			if u, ok := parseReactiveRaw(id, raw); ok {
				out[id] = u
			}
		}
		return out
	}
	if f.CascadeID != "" {
		if u, ok := parseReactiveRaw(f.CascadeID, frame); ok {
			out[f.CascadeID] = u
		}
	}
	return out
}

// parseReactiveRaw décode un objet CascadeState (frame directe ou valeur d'une
// entrée "updates"). La frame entière est ré-analysée pour requestedInteraction
// car json.RawMessage ne décode pas les champs imbriqués automatiquement.
func parseReactiveRaw(id string, raw json.RawMessage) (ReactiveUpdate, bool) {
	var inner reactiveFrame
	if err := json.Unmarshal(raw, &inner); err != nil {
		return ReactiveUpdate{}, false
	}
	u := ReactiveUpdate{
		CascadeID:    id,
		Status:       reactiveStatusValue(inner.Status),
		StepIndex:    inner.StepIndex,
		TrajectoryID: inner.TrajectoryID,
		CallID:       inner.CallID,
		Model:        inner.Model,
	}
	if len(inner.RequestedInteraction) > 0 && string(inner.RequestedInteraction) != "{}" && string(inner.RequestedInteraction) != "null" {
		var it reactiveInteraction
		if err := json.Unmarshal(inner.RequestedInteraction, &it); err == nil {
			u.RequestedInteraction = reactiveInteractionValue(it.InteractionType)
			if u.RequestedInteraction == InteractionNone {
				u.RequestedInteraction = reactiveInteractionValue(it.InteractionTypeSnake)
			}
		}
	}
	// "Waiting for input" = la cascade est idle (plus rien à exécuter) et une
	// interaction utilisateur est en attente — c'est l'état que le mobile doit
	// refléter en temps réel (le parseur de frames le rate parfois).
	u.WaitingForInput = u.Status == ReactiveStatusIdle && u.RequestedInteraction != InteractionNone
	return u, true
}

// reactiveStatusValue : enum CascadeRunStatus, accepte string protojson
// ("CASCADE_RUN_STATUS_RUNNING"), snake_case et nombre.
func reactiveStatusValue(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case string:
		switch strings.ToUpper(t) {
		case "CASCADE_RUN_STATUS_IDLE", "IDLE":
			return ReactiveStatusIdle
		case "CASCADE_RUN_STATUS_RUNNING", "RUNNING":
			return ReactiveStatusRunning
		case "CASCADE_RUN_STATUS_CANCELING", "CANCELING":
			return ReactiveStatusCanceling
		case "CASCADE_RUN_STATUS_BUSY", "BUSY":
			return ReactiveStatusBusy
		}
	}
	return 0
}

// reactiveInteractionValue : enum InteractionType, accepte string protojson
// ("INTERACTION_TYPE_FILE_PERMISSION", "APPROVAL"), snake_case et nombre.
func reactiveInteractionValue(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case string:
		switch strings.ToUpper(strings.ReplaceAll(t, "-", "_")) {
		case "APPROVAL", "INTERACTION_TYPE_APPROVAL":
			return InteractionApproval
		case "RUN_COMMAND", "INTERACTION_TYPE_RUN_COMMAND":
			return InteractionRunCommand
		case "FILE_PERMISSION", "INTERACTION_TYPE_FILE_PERMISSION":
			return InteractionFilePermission
		case "PERMISSION", "INTERACTION_TYPE_PERMISSION":
			return InteractionPermission
		case "OPEN_BROWSER_URL", "INTERACTION_TYPE_OPEN_BROWSER_URL":
			return InteractionOpenBrowserURL
		case "READ_URL_CONTENT", "INTERACTION_TYPE_READ_URL_CONTENT", "READ_URL", "BROWSE":
			return InteractionReadUrlContent
		case "PLAN_APPROVAL", "INTERACTION_TYPE_PLAN_APPROVAL":
			return InteractionPlanApproval
		case "MULTI_SELECT", "INTERACTION_TYPE_MULTI_SELECT":
			return InteractionMultiSelect
		case "SINGLE_SELECT", "INTERACTION_TYPE_SINGLE_SELECT":
			return InteractionSingleSelect
		case "ASK_QUESTION", "INTERACTION_TYPE_ASK_QUESTION":
			return InteractionAskQuestion
		case "MCP", "MCP_TOOL", "CALL_MCP_TOOL", "INTERACTION_TYPE_MCP", "CASCADE_MCP":
			return InteractionMcp
		case "DEPLOY", "INTERACTION_TYPE_DEPLOY":
			return InteractionDeploy
		case "SEND_COMMAND_INPUT", "INTERACTION_TYPE_SEND_COMMAND_INPUT":
			return InteractionSendCommandInput
		case "INVOKE_SUBAGENT", "INTERACTION_TYPE_INVOKE_SUBAGENT":
			return InteractionInvokeSubagent
		case "DELETE_DIRECTORY", "INTERACTION_TYPE_DELETE_DIRECTORY":
			return InteractionDeleteDirectory
		case "CLOUDSQL", "INTERACTION_TYPE_CLOUDSQL":
			return InteractionCloudSQL
		case "RUN_EXTENSION_CODE", "INTERACTION_TYPE_RUN_EXTENSION_CODE":
			return InteractionRunExtensionCode
		case "BROWSER_ACTION", "INTERACTION_TYPE_BROWSER_ACTION", "EXECUTE_BROWSER_JS", "CAPTURE_SCREENSHOT", "CLICK_PIXEL":
			return InteractionBrowserAction
		case "ELICITATION", "INTERACTION_TYPE_ELICITATION":
			return InteractionElicitation
		}
	}
	return 0
}

// RunReactiveSubscription ouvre le stream server-streaming
// StreamReactiveUpdates (application/connect+json) et appelle onUpdate à
// chaque frame décodée. Le stream est long-vivant ; retourne une erreur
// uniquement si la connexion échoue — l'appelant décide de la reconnexion.
func (c *Client) RunReactiveSubscription(onUpdate func(updates map[string]ReactiveUpdate)) error {
	return c.CallStreamJSON("StreamReactiveUpdates", JetboxEnvelope([]byte("{}")), 0, func(frame []byte) error {
		updates := ParseReactiveFrame(frame)
		if len(updates) > 0 {
			onUpdate(updates)
		}
		return nil
	})
}
