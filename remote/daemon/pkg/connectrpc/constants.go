package connectrpc

// Définitions centralisées des endpoints gRPC-Web / ConnectRPC pour Antigravity.
const (
	// ServiceName est le namespace de service Protobuf officiel du Language Server.
	ServiceName = "exa.language_server_pb.LanguageServerService"

	// Endpoints RPC officiels
	MethodHeartbeat                 = "Heartbeat"
	MethodCreateCascade             = "CreateCascade"
	MethodGetAllCascades            = "GetAllCascades"
	MethodGetCascadeTrajectory      = "GetCascadeTrajectory"
	MethodDeleteCascadeTrajectory   = "DeleteCascadeTrajectory"
	MethodStreamCascadeTrajectory   = "StreamCascadeTrajectory"
	MethodSubmitToolApproval        = "SubmitToolApproval"
	MethodSetBrowserOpenConversation = "SetBrowserOpenConversation"
	MethodSendCommand               = "SendCommand"
	MethodGetAvailableModels        = "GetAvailableModels"
	MethodReadFile                  = "ReadFile"
	MethodWriteFile                 = "WriteFile"
	MethodAddTrackedWorkspace       = "AddTrackedWorkspace"
	MethodRemoveTrackedWorkspace    = "RemoveTrackedWorkspace"
	MethodGetTurnDiff               = "GetTurnDiff"
	MethodGetRevertPreview          = "GetRevertPreview"
	MethodRevertToCascadeStep       = "RevertToCascadeStep"
	MethodSendStepsToBackground     = "SendStepsToBackground"
	MethodSkipBrowserSubagent       = "SkipBrowserSubagent"
	MethodRetrieveUserQuotaSummary  = "RetrieveUserQuotaSummary"
	MethodGetUserStatus             = "GetUserStatus"
	MethodGetModelStatuses          = "GetModelStatuses"
	MethodGenerateCommitMessage     = "GenerateCommitMessage"
	MethodConvertTrajectoryToMarkdown = "ConvertTrajectoryToMarkdown"
	MethodCreateWorktree            = "CreateWorktree"
	MethodGetLintErrors             = "GetLintErrors"

	// Headers HTTP requis par le protocole ConnectRPC / gRPC-Web
	HeaderContentType           = "Content-Type"
	HeaderAccept                = "Accept"
	HeaderConnectProtocolVersion = "Connect-Protocol-Version"
	HeaderCSRFToken             = "x-csrf-token"
	HeaderCodeiumCSRFToken      = "x-codeium-csrf-token"
	HeaderGrpcWeb               = "X-Grpc-Web"

	// Valeurs standard des headers
	ContentTypeGrpcWebProto     = "application/grpc-web+proto"
	AcceptGrpcWebTextProto      = "application/grpc-web+proto,application/grpc-web-text"
	ConnectProtocolVersionValue = "1"
	ContentTypeJSON             = "application/json"
)

// Identifiants d'outils standardisés
const (
	ToolRunCommand          = "run_command"
	ToolViewFile            = "view_file"
	ToolReplaceFileContent  = "replace_file_content"
	ToolAskQuestion         = "ask_question"
	ToolAskUser             = "ask_user"
	ToolSearchWeb           = "search_web"
	ToolListDir             = "list_dir"
	ToolInvokeSubagent      = "invoke_subagent"
	ToolDefineSubagent      = "define_subagent"
)
