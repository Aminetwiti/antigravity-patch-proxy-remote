package connectrpc

import (
	"fmt"
	"time"
)

// CreateCascade crée une session via StartCascade. Le modèle demandé est
// transmis par le mobile : ModelUID (requested_model_uid) si fourni, sinon
// l'enum historique (requested_model_id).
func (c *Client) CreateCascade(workspaceURI, projectID, modelUID string, modelEnum uint64) ([]byte, error) {
	return c.Call("StartCascade", BuildStartCascade(workspaceURI, projectID, modelUID, modelEnum))
}

// GetAllCascades liste toutes les sessions via GetAllCascadeTrajectories.
func (c *Client) GetAllCascades() ([]byte, error) {
	return c.Call("GetAllCascadeTrajectories", nil)
}

// SendMessage envoie un prompt et retourne la première frame de réponse.
func (c *Client) SendMessage(cascadeID, text string) ([]byte, error) {
	return c.Call("SendUserCascadeMessage", BuildSendMessage(cascadeID, text, c.APIKey, c.SessionID, c.ModelUID, c.ModelEnum))
}

// SendMessageStream envoie un prompt et transmet chaque frame de réponse reçue au callback onFrame.
func (c *Client) SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error {
	return c.CallStream("SendUserCascadeMessage", BuildSendMessage(cascadeID, text, c.APIKey, c.SessionID, c.ModelUID, c.ModelEnum), 120*time.Second, onFrame)
}

// SendMessageStreamModel comme SendMessageStream mais avec un modèle
// explicite (venant du message send_prompt du mobile) : le daemon doit
// respecter la sélection du téléphone, pas le repli global du client.
// noTools force planner_mode = 3 (NO_TOOL) dans le cascade_config.
func (c *Client) SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, noTools ...bool) error {
	return c.CallStream("SendUserCascadeMessage", BuildSendMessage(cascadeID, text, c.APIKey, c.SessionID, modelUID, modelEnum, noTools...), 120*time.Second, onFrame)
}

// SendMessageStreamModelWithMedia transmet un prompt avec pièces jointes (media/images) au Language Server.
func (c *Client) SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []MediaAttachment, onFrame func([]byte) error, noTools ...bool) error {
	return c.CallStream("SendUserCascadeMessage", BuildSendMessageWithMedia(cascadeID, text, c.APIKey, c.SessionID, modelUID, modelEnum, media, noTools...), 120*time.Second, onFrame)
}

// SubmitToolApproval approuve/refuse une interaction d'outil via le RPC officiel
// HandleCascadeUserInteraction (trajectory_id + step_index + oneof décision).
func (c *Client) SubmitToolApproval(cascadeID, trajectoryID string, stepIndex uint32, oneofField int, oneofPayload []byte) ([]byte, error) {
	return c.Call("HandleCascadeUserInteraction", BuildHandleCascadeUserInteraction(cascadeID, trajectoryID, stepIndex, oneofField, oneofPayload))
}

// Heartbeat vérifie que le serveur répond et que l'auth passe.
func (c *Client) Heartbeat() ([]byte, error) {
	return c.Call("Heartbeat", nil)
}

// SendCommand route une slash commande vers le Language Server comme si elle
// venait du terminal IDE (source=4), via HandleStreamingCommand.
func (c *Client) SendCommand(commandText string) ([]byte, error) {
	return c.Call("HandleStreamingCommand", BuildHandleStreamingCommand(commandText, CommandRequestSourceTerminal))
}

// SetBrowserOpenConversation force l'IDE Antigravity à s'abonner et ouvrir une session spécifique.
func (c *Client) SetBrowserOpenConversation(cascadeID string) ([]byte, error) {
	return c.Call("SetBrowserOpenConversation", BuildSetBrowserOpenConversation(cascadeID))
}

// ListModels récupère la liste des modèles disponibles via GetAvailableModels
// (réponse imbriquée FetchAvailableModelsResponse — décodée best-effort par
// ParseModels, jamais fatale en cas de schéma inconnu).
func (c *Client) ListModels() ([]byte, error) {
	return c.Call("GetAvailableModels", nil)
}

// DeleteCascade supprime une session via DeleteCascadeTrajectory
// (irréversible — l'appelant DOIT avoir confirmé côté client).
func (c *Client) DeleteCascade(cascadeID string) ([]byte, error) {
	return c.Call("DeleteCascadeTrajectory", BuildDeleteCascadeTrajectory(cascadeID))
}

// ReadFile lit un fichier via le RPC officiel ReadFile du Language Server
// (URI file:/// — gère l'encodage et le workspace tracking du LS).
func (c *Client) ReadFile(uri string) ([]byte, error) {
	raw, err := c.Call("ReadFile", BuildReadFileRequest(uri))
	if err != nil {
		return nil, err
	}
	return ParseReadFileResponse(raw), nil
}

// TrackWorkspace déclare un dossier au hub via AddTrackedWorkspace — le LS
// crée l'instance virtuelle du workspace ; StartCascade avec workspace_uri
// fonctionne ensuite sans project_id (plus de cascade « orpheline » qui
// renvoyait un payload vide). doNotWatchFiles évite le file-watcher du LS
// (inutile pour un accès distant). Réponse vide (AddTrackedWorkspaceResponse).
func (c *Client) TrackWorkspace(workspacePath string) ([]byte, error) {
	return c.Call("AddTrackedWorkspace", BuildTrackWorkspace(workspacePath))
}

// UntrackWorkspace retire un dossier du hub (RemoveTrackedWorkspace).
func (c *Client) UntrackWorkspace(workspacePath string) ([]byte, error) {
	return c.Call("RemoveTrackedWorkspace", BuildTrackWorkspace(workspacePath))
}

// WriteFile écrit un fichier via le RPC officiel WriteFile du Language Server.
// overwrite=false → erreur si le fichier existe déjà (pas d'écrasement silencieux).
func (c *Client) WriteFile(uri string, content []byte, overwrite bool) ([]byte, error) {
	return c.Call("WriteFile", BuildWriteFileRequest(uri, content, overwrite))
}

// GetCascadeTrajectory récupère l'historique structuré d'une session
// (GetCascadeTrajectory). verbosity=0 → défaut du LS.
func (c *Client) GetCascadeTrajectory(cascadeID string, verbosity uint64) ([]byte, error) {
	return c.Call("GetCascadeTrajectory", BuildGetCascadeTrajectory(cascadeID, verbosity))
}

// GetTurnDiff récupère le diff officiel d'un tour (GetTurnDiff).
// stepIndex < 0 → le LS résout le dernier tour.
func (c *Client) GetTurnDiff(conversationID string, stepIndex int64) ([]byte, error) {
	return c.Call("GetTurnDiff", BuildGetTurnDiff(conversationID, stepIndex))
}

// GetUserStatus récupère les infos du compte utilisateur (statut, crédits, plan).
func (c *Client) GetUserStatus() ([]byte, error) {
	return c.CallJSON("GetUserStatus", nil)
}

// GetModelStatuses récupère les statuts et disponibilités des modèles.
func (c *Client) GetModelStatuses() ([]byte, error) {
	return c.CallJSON("GetModelStatuses", nil)
}

// GenerateCommitMessage génère un message de commit IA basé sur le staging git.
func (c *Client) GenerateCommitMessage() ([]byte, error) {
	return c.CallJSON("GenerateCommitMessage", nil)
}

// ConvertTrajectoryToMarkdown convertit une trajectoire résolue en Markdown.
func (c *Client) ConvertTrajectoryToMarkdown(trajectoryID string) ([]byte, error) {
	payload := []byte(`{"trajectory":{"trajectoryId":"` + trajectoryID + `"}}`)
	return c.CallJSON("ConvertTrajectoryToMarkdown", payload)
}

// CreateWorktree crée un worktree Git pour le développement parallèle.
func (c *Client) CreateWorktree(branch, path string) ([]byte, error) {
	payload := []byte(`{"branch":"` + branch + `","path":"` + path + `"}`)
	return c.CallJSON("CreateWorktree", payload)
}

// GetLintErrors récupère les erreurs de lint d'un fichier (diagnostics LSP).
func (c *Client) GetLintErrors(uri string) ([]byte, error) {
	payload := []byte(`{"uri":"` + uri + `"}`)
	return c.CallJSON("GetLintErrors", payload)
}

// GetDefinition résout la définition du symbole à la position donnée
// (line/character, indices 0-based comme le protocole LSP).
func (c *Client) GetDefinition(uri string, line, character int) ([]byte, error) {
	payload := []byte(fmt.Sprintf(`{"uri":"%s","position":{"line":%d,"character":%d}}`, uri, line, character))
	return c.CallJSON("GetDefinition", payload)
}

// GetCodeValidationStates récupère l'état de validation du code
// (erreurs/squiggles visibles dans l'éditeur).
func (c *Client) GetCodeValidationStates(uri string) ([]byte, error) {
	payload := []byte(`{"uri":"` + uri + `"}`)
	return c.CallJSON("GetCodeValidationStates", payload)
}

// --- RPC Git officiels (exa.language_server_pb) ---

// GetVersionControlState récupère l'état VCS complet d'un workspace :
// branche courante, commits, changements working directory / staged,
// conflits de merge — via GetVersionControlState (champ 1 = workspace_path,
// pas une URI ; le LS fait sa propre résolution de chemin).
func (c *Client) GetVersionControlState(workspacePath string) ([]byte, error) {
	return c.Call("GetVersionControlState", BuildGetVersionControlState(workspacePath))
}

// GitStage indexe une liste de fichiers (URIs file:///) dans le staging area.
func (c *Client) GitStage(workspaceURI string, uris []string) ([]byte, error) {
	return c.Call("GitStage", BuildGitStage(workspaceURI, uris))
}

// GitUnstage retire des fichiers du staging area.
func (c *Client) GitUnstage(workspaceURI string, uris []string) ([]byte, error) {
	return c.Call("GitUnstage", BuildGitUnstage(workspaceURI, uris))
}

// GitCommit crée un commit avec le message fourni. Retourne l'ID du commit
// (champ 1 de GitCommitResponse).
func (c *Client) GitCommit(workspaceURI, message string) ([]byte, error) {
	return c.Call("GitCommit", BuildGitCommit(workspaceURI, message))
}

// GitDiscard annule les modifications non indexées des fichiers donnés.
// Destructif : l'appelant DOIT confirmer côté client avant d'invoquer.
func (c *Client) GitDiscard(workspaceURI string, uris []string) ([]byte, error) {
	return c.Call("GitDiscard", BuildGitDiscard(workspaceURI, uris))
}

// GetCommitDetails récupère les fichiers changés et les parents d'un commit
// (GetCommitDetailsResponse).
func (c *Client) GetCommitDetails(workspaceURI, commitID string) ([]byte, error) {
	return c.Call("GetCommitDetails", BuildGetCommitDetails(workspaceURI, commitID))
}

// --- RPC Sidecar officiels (exa.cascade_plugins_pb) ---

// ListSidecarLogFiles liste les fichiers de log disponibles pour un sidecar.
func (c *Client) ListSidecarLogFiles(sidecarID string) ([]byte, error) {
	return c.Call("ListSidecarLogFiles", BuildListSidecarLogFiles(sidecarID))
}

// GetSidecarLogs récupère le contenu d'un fichier de log d'un sidecar.
func (c *Client) GetSidecarLogs(sidecarID, logFileName string) ([]byte, error) {
	return c.Call("GetSidecarLogs", BuildGetSidecarLogs(sidecarID, logFileName))
}

// ManageSidecar contrôle un sidecar (action : 1=start, 2=stop, 3=restart, 4=remove).
func (c *Client) ManageSidecar(sidecarID string, action uint64) ([]byte, error) {
	return c.Call("ManageSidecar", BuildManageSidecar(sidecarID, action))
}

// --- RPC Colosseum / Battle Mode (exa.language_server_pb) ---

// StartBattleMode initialise une session de duel multi-modèles sur deux worktrees.
func (c *Client) StartBattleMode(workspaceURI, prompt, modelUIDA string, modelEnumA uint64, modelUIDB string, modelEnumB uint64) ([]byte, error) {
	return c.Call("StartBattleMode", BuildStartBattleMode(workspaceURI, prompt, modelUIDA, modelEnumA, modelUIDB, modelEnumB))
}

// GetBattleWorktreeDiff récupère le diff unifié comparatif entre les deux worktrees Battle Mode.
func (c *Client) GetBattleWorktreeDiff(workspaceURI string) ([]byte, error) {
	return c.Call("GetBattleWorktreeDiff", BuildGetBattleWorktreeDiff(workspaceURI))
}

// EliminateBattleArm supprime un worktree perdant du mode Battle.
func (c *Client) EliminateBattleArm(armID string) ([]byte, error) {
	return c.Call("EliminateBattleModeArm", BuildEliminateBattleModeArm(armID))
}

// EndBattleMode termine le mode Battle et applique la solution victorieuse via la stratégie SafeMerge choisie.
func (c *Client) EndBattleMode(winningArmID string, mergeStrategy uint64) ([]byte, error) {
	return c.Call("EndBattleMode", BuildEndBattleMode(winningArmID, mergeStrategy))
}

// --- RPC Diagnostics & FlightRecorder ---

// DumpFlightRecorder extrait la trace binaire d'exécution Go (runtime/trace).
func (c *Client) DumpFlightRecorder() ([]byte, error) {
	return c.Call("DumpFlightRecorder", BuildDumpFlightRecorder())
}

// --- RPC MCP Lifecycle & OAuth ---

// RefreshMcpServers recharge à chaud la configuration des serveurs MCP.
func (c *Client) RefreshMcpServers() ([]byte, error) {
	return c.Call("RefreshMcpServers", BuildRefreshMcpServers())
}

// CompleteMcpOAuth valide un flux OAuth pour un serveur MCP tiers.
func (c *Client) CompleteMcpOAuth(serverID, authCode string) ([]byte, error) {
	return c.Call("CompleteMcpOAuth", BuildCompleteMcpOAuth(serverID, authCode))
}

// DisconnectMcpOAuth révoque les identifiants OAuth d'un serveur MCP.
func (c *Client) DisconnectMcpOAuth(serverID string) ([]byte, error) {
	return c.Call("DisconnectMcpOAuth", BuildDisconnectMcpOAuth(serverID))
}

// --- Code Index & RAG ---

// HybridSearch effectue une recherche sémantique hybride (BM25 + Cosine) dans le code indexé.
func (c *Client) HybridSearch(query, workspaceURI string, limit uint32) ([]byte, error) {
	return c.Call("HybridSearch", BuildHybridSearch(query, workspaceURI, limit))
}

// SearchCode effectue une recherche de symboles et texte dans l'index du Language Server.
func (c *Client) SearchCode(query, workspaceURI string, maxResults, linesContext int32) ([]byte, error) {
	return c.Call("SearchCode", BuildSearchCode(query, workspaceURI, maxResults, linesContext))
}

// CheckoutWorktree bascule l'espace de travail sur un worktree Git ou fusionne les changements.
func (c *Client) CheckoutWorktree(worktreeDirURI, targetWorkspaceURI string, deleteAfterCheckout bool, mergeStrategy uint64) ([]byte, error) {
	return c.Call("CheckoutWorktree", BuildCheckoutWorktree(worktreeDirURI, targetWorkspaceURI, deleteAfterCheckout, mergeStrategy))
}

// CancelCascadeInvocation demande au Language Server d'annuler immédiatement l'invocation active d'une cascade.
func (c *Client) CancelCascadeInvocation(cascadeID string, killBackgroundTasks bool) ([]byte, error) {
	return c.Call("CancelCascadeInvocation", BuildCancelCascadeInvocation(cascadeID, killBackgroundTasks))
}

// ForceStopCascadeTree force l'arrêt complet de l'arbre d'exécution de la cascade dans Antigravity.
func (c *Client) ForceStopCascadeTree(cascadeID string) ([]byte, error) {
	return c.Call("ForceStopCascadeTree", BuildForceStopCascadeTree(cascadeID))
}

// CancelCascadeSteps annule une série d'étapes en cours d'exécution dans Antigravity.
func (c *Client) CancelCascadeSteps(cascadeID string, stepIndices []uint32) ([]byte, error) {
	return c.Call("CancelCascadeSteps", BuildCancelCascadeSteps(cascadeID, stepIndices))
}


