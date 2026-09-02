package gateway

import (
	"context"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// RPCClient est l'ensemble des méthodes du backend LanguageServer utilisées
// par le gateway (interface minimale pour permettre les tests avec un faux).
type RPCClient interface {
	Heartbeat() ([]byte, error)
	CreateCascade(uri string, projectID string, modelUID string, modelEnum uint64) ([]byte, error)
	GetAllCascades() ([]byte, error)
	SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error
	SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, noTools ...bool) error
	// SendMessageStreamModelWithMedia : transmet le prompt avec pièces jointes (media/images).
	SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error
	SubmitToolApproval(cascadeID, trajectoryID string, stepIndex uint32, oneofField int, oneofPayload []byte) ([]byte, error)
	SetBrowserOpenConversation(cascadeID string) ([]byte, error)
	SendCommand(commandText string) ([]byte, error)
	// ListModels récupère la liste des modèles disponibles (GetAvailableModels).
	ListModels() ([]byte, error)
	// DeleteCascade supprime une session (DeleteCascadeTrajectory).
	DeleteCascade(cascadeID string) ([]byte, error)
	// CancelCascadeInvocation demande au Language Server d'annuler immédiatement l'invocation active.
	CancelCascadeInvocation(cascadeID string, killBackgroundTasks bool) ([]byte, error)
	// ForceStopCascadeTree force l'arrêt complet de l'arbre d'exécution de la cascade dans Antigravity.
	ForceStopCascadeTree(cascadeID string) ([]byte, error)
	// CancelCascadeSteps annule une série d'étapes en cours d'exécution dans Antigravity.
	CancelCascadeSteps(cascadeID string, stepIndices []uint32) ([]byte, error)
	// ReadFile lit un fichier via le RPC officiel du LS (ReadFile).
	ReadFile(uri string) ([]byte, error)
	// WriteFile écrit un fichier via le RPC officiel du LS (WriteFile).
	WriteFile(uri string, content []byte, overwrite bool) ([]byte, error)
	// TrackWorkspace déclare un dossier au hub (AddTrackedWorkspace) — le LS
	// crée l'instance virtuelle ; StartCascade fonctionne ensuite sans projectID.
	TrackWorkspace(workspacePath string) ([]byte, error)
	// UntrackWorkspace retire un dossier du hub (RemoveTrackedWorkspace).
	UntrackWorkspace(workspacePath string) ([]byte, error)
	// GetCascadeTrajectory récupère l'historique structuré d'une session
	// (GetCascadeTrajectory) — verbosity 0 = défaut du LS.
	GetCascadeTrajectory(cascadeID string, verbosity uint64) ([]byte, error)
	// GetTurnDiff récupère le diff officiel d'un tour (GetTurnDiff).
	// stepIndex < 0 → le LS résout le dernier tour.
	GetTurnDiff(conversationID string, stepIndex int64) ([]byte, error)
	// GetRevertPreview demande la prévisualisation du rollback d'une cascade.
	GetRevertPreview(cascadeID string, stepIndex int64) ([]byte, error)
	// RevertToCascadeStep applique le rollback de la cascade à une étape donnée.
	RevertToCascadeStep(cascadeID string, stepIndex int64) error
	// SendStepsToBackground bascule des étapes en tâche d'arrière-plan.
	SendStepsToBackground(conversationID string, stepIndices []int64) error
	// SkipBrowserSubagent saute une étape de sous-agent de navigation.
	SkipBrowserSubagent(cascadeID string, stepIndex int64) error
	// RetrieveUserQuotaSummary récupère le résumé des quotas utilisateur du Language Server.
	RetrieveUserQuotaSummary() ([]byte, error)
	// GetUserStatus récupère les infos et crédits de l'utilisateur.
	GetUserStatus() ([]byte, error)
	// GetModelStatuses récupère la disponibilité et dégradation des modèles.
	GetModelStatuses() ([]byte, error)
	// GenerateCommitMessage génère un message de commit IA à partir du staging git.
	GenerateCommitMessage() ([]byte, error)
	// ConvertTrajectoryToMarkdown convertit une session en document Markdown.
	ConvertTrajectoryToMarkdown(trajectoryID string) ([]byte, error)
	// CreateWorktree crée un nouveau worktree Git.
	CreateWorktree(branch, path string) ([]byte, error)
	// GetLintErrors récupère les erreurs de lint d'un fichier (LSP).
	GetLintErrors(uri string) ([]byte, error)
	// GetDefinition résout la définition du symbole à une position (LSP).
	GetDefinition(uri string, line, character int) ([]byte, error)
	// GetCodeValidationStates récupère l'état de validation du code (LSP).
	GetCodeValidationStates(uri string) ([]byte, error)
	// GetVersionControlState récupère l'état VCS complet d'un workspace
	// (branche, commits, changements, conflits) — GetVersionControlState.
	GetVersionControlState(workspacePath string) ([]byte, error)
	// GitStage / GitUnstage / GitDiscard modifient le staging area git.
	GitStage(workspaceURI string, uris []string) ([]byte, error)
	GitUnstage(workspaceURI string, uris []string) ([]byte, error)
	GitDiscard(workspaceURI string, uris []string) ([]byte, error)
	// GitCommit crée un commit git (retourne son ID).
	GitCommit(workspaceURI, message string) ([]byte, error)
	// GetCommitDetails récupère les fichiers changés et parents d'un commit.
	GetCommitDetails(workspaceURI, commitID string) ([]byte, error)
	// RPC Sidecar : listes/logs/contrôle des sidecars (cascade_plugins).
	ListSidecarLogFiles(sidecarID string) ([]byte, error)
	GetSidecarLogs(sidecarID, logFileName string) ([]byte, error)
	ManageSidecar(sidecarID string, action uint64) ([]byte, error)
	// RPC Colosseum / Battle Mode : duel multi-modèles et arbitrage de branches.
	StartBattleMode(workspaceURI, prompt, modelUIDA string, modelEnumA uint64, modelUIDB string, modelEnumB uint64) ([]byte, error)
	GetBattleWorktreeDiff(workspaceURI string) ([]byte, error)
	EliminateBattleArm(armID string) ([]byte, error)
	EndBattleMode(winningArmID string, mergeStrategy uint64) ([]byte, error)
	// RPC Diagnostics & FlightRecorder.
	DumpFlightRecorder() ([]byte, error)
	// RPC MCP Lifecycle & OAuth.
	RefreshMcpServers() ([]byte, error)
	CompleteMcpOAuth(serverID, authCode string) ([]byte, error)
	DisconnectMcpOAuth(serverID string) ([]byte, error)
	// RPC Code Index & RAG.
	HybridSearch(query, workspaceURI string, limit uint32) ([]byte, error)
	SearchCode(query, workspaceURI string, maxResults, linesContext int32) ([]byte, error)
	CheckoutWorktree(worktreeDirURI, targetWorkspaceURI string, deleteAfterCheckout bool, mergeStrategy uint64) ([]byte, error)
}

// RPCStreamContextClient permet la coupure immédiate du socket HTTP de stream sur annulation contextuelle.
type RPCStreamContextClient interface {
	SendMessageStreamModelWithMediaContext(ctx context.Context, cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error
}

// JetboxStreamer est la portion minimale du client LS nécessaire au flux
// temps réel des résumés de sessions (JetboxSubscribeToSummaries). Interface
// étroite : les tests injectent un faux sans réimplémenter RPCClient.
type JetboxStreamer interface {
	RunJetboxSubscription(onSummary func(updates map[string]connectrpc.JetboxSummary, deletes []string)) error
}
