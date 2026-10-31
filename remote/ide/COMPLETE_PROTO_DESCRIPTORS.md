# 📜 Descripteurs Protobuf Complets : Antigravity IDE

> **Reconstitution Forensique Complète des Fichiers de Définition `.proto`**  
> Fichiers générés à partir de l'analyse des tables de symboles et des structures de réflexion de `language_server_windows_x64.exe` et `extension.js`.

---

## 1. `language_server.proto`

```protobuf
syntax = "proto3";

package exa.language_server_pb;

import "google/protobuf/timestamp.proto";
import "third_party/jetski/cortex_pb/cortex.proto";
import "third_party/jetski/cortex_pb/options.proto";

service LanguageServerService {
  // --- Cycle de Vie des Sessions (Cascade) ---
  rpc StartCascade (StartCascadeRequest) returns (StartCascadeResponse);
  rpc GetAllCascadeTrajectories (GetAllCascadeTrajectoriesRequest) returns (GetAllCascadeTrajectoriesResponse);
  rpc GetCascadeTrajectory (GetCascadeTrajectoryRequest) returns (GetCascadeTrajectoryResponse);
  rpc DeleteCascadeTrajectory (DeleteCascadeTrajectoryRequest) returns (DeleteCascadeTrajectoryResponse);
  rpc ForkConversation (ForkConversationRequest) returns (ForkConversationResponse);
  rpc RevertToCascadeStep (RevertToCascadeStepRequest) returns (RevertToCascadeStepResponse);
  rpc GetRevertPreview (GetRevertPreviewRequest) returns (GetRevertPreviewResponse);
  rpc CancelCascadeInvocation (CancelCascadeInvocationRequest) returns (CancelCascadeInvocationResponse);
  rpc ForceStopCascadeTree (ForceStopCascadeTreeRequest) returns (ForceStopCascadeTreeResponse);
  rpc SetBrowserOpenConversation (SetBrowserOpenConversationRequest) returns (SetBrowserOpenConversationResponse);

  // --- Streaming & Interactions ---
  rpc SendUserCascadeMessage (SendUserCascadeMessageRequest) returns (stream SendUserCascadeMessageResponse);
  rpc StreamCascadeReactiveUpdates (StreamCascadeReactiveUpdatesRequest) returns (stream StreamCascadeReactiveUpdatesResponse);
  rpc StreamCascadeSummariesReactiveUpdates (StreamCascadeSummariesReactiveUpdatesRequest) returns (stream StreamCascadeSummariesReactiveUpdatesResponse);
  rpc StreamAgentStateUpdates (StreamAgentStateUpdatesRequest) returns (stream StreamAgentStateUpdatesResponse);
  rpc HandleCascadeUserInteraction (HandleCascadeUserInteractionRequest) returns (HandleCascadeUserInteractionResponse);
  rpc JetboxSubscribeToSummaries (JetboxSubscribeToSummariesRequest) returns (stream JetboxSubscribeToSummariesResponse);
  rpc JetboxSubscribeToState (JetboxSubscribeToStateRequest) returns (stream JetboxSubscribeToStateResponse);

  // --- Modèles & Quotas ---
  rpc GetAvailableModels (GetAvailableModelsRequest) returns (GetAvailableModelsResponse);
  rpc RetrieveUserQuotaSummary (RetrieveUserQuotaSummaryRequest) returns (RetrieveUserQuotaSummaryResponse);
  rpc GetUserStatus (GetUserStatusRequest) returns (GetUserStatusResponse);
  rpc Heartbeat (HeartbeatRequest) returns (HeartbeatResponse);

  // --- Système de Fichiers & Terminal ---
  rpc ReadFile (ReadFileRequest) returns (ReadFileResponse);
  rpc WriteFile (WriteFileRequest) returns (WriteFileResponse);
  rpc GetVersionControlState (GetVersionControlStateRequest) returns (GetVersionControlStateResponse);
  rpc GetTurnDiff (GetTurnDiffRequest) returns (GetTurnDiffResponse);
  rpc StreamTerminalOutput (StreamTerminalOutputRequest) returns (stream StreamTerminalOutputResponse);
  rpc SendTerminalInput (SendTerminalInputRequest) returns (SendTerminalInputResponse);
  rpc CloseTerminal (CloseTerminalRequest) returns (CloseTerminalResponse);
}

// --- Messages de Requêtes et Réponses ---

message HeartbeatRequest {}
message HeartbeatResponse {
  bool alive = 1;
  int64 timestamp_ms = 2;
}

message StartCascadeRequest {
  string workspace_root = 1;
  uint32 source = 4;                 // 1 = CORTEX_TRAJECTORY_SOURCE_IDE
  uint32 trajectory_type = 5;         // 1 = CORTEX_TRAJECTORY_TYPE_DEFAULT
  string workspace_uri = 8;
  uint64 requested_model_enum = 14;
  string requested_model_uid = 15;
  ProjectEnvironmentConfig project_env = 17;
}

message StartCascadeResponse {
  string cascade_id = 1;
  string trajectory_id = 2;
  google.protobuf.Timestamp created_at = 3;
}

message SendUserCascadeMessageRequest {
  string cascade_id = 1;
  string text = 2;
  Metadata metadata = 3;
  CascadeConfig cascade_config = 4;
  repeated MediaAttachment media = 6;
  bool is_continuation = 7;
  uint32 parent_step_index = 8;
}

message SendUserCascadeMessageResponse {
  string cascade_id = 1;
  cortex_pb.CascadeUserInteraction interaction_event = 2;
  uint32 step_index = 3;
  string text_delta = 5;
  string thought_delta = 6;
  ToolCallStart tool_call_start = 7;
  ToolCallOutput tool_call_output = 8;
  CascadeRunStatus status = 9;
  string error_message = 10;
}

message SetBrowserOpenConversationRequest {
  string cascade_id = 1;
  google.protobuf.Timestamp expires_at = 2;
}

message SetBrowserOpenConversationResponse {}

message GetTurnDiffRequest {
  string conversation_id = 1;
  uint32 step_index = 2;
}

message GetTurnDiffResponse {
  repeated FileDiff file_diffs = 1;
  uint32 total_additions = 2;
  uint32 total_deletions = 3;
  cortex_pb.CortexStepUserInput user_input = 4;
  uint32 turn_start_index = 5;
  uint32 turn_end_index_exclusive = 6;
}

message FileDiff {
  string file_path = 1;
  uint32 additions = 2;
  uint32 deletions = 3;
  string original_contents = 4;
  string modified_contents = 5;
  bool is_artifact_file = 6;
}
```

---

## 2. `cortex.proto`

```protobuf
syntax = "proto3";

package exa.cortex_pb;

enum CortexTrajectorySource {
  CORTEX_TRAJECTORY_SOURCE_UNSPECIFIED = 0;
  CORTEX_TRAJECTORY_SOURCE_IDE = 1;
  CORTEX_TRAJECTORY_SOURCE_CLI = 2;
  CORTEX_TRAJECTORY_SOURCE_JETBOX = 3;
  CORTEX_TRAJECTORY_SOURCE_SUBAGENT = 4;
}

enum CascadeRunStatus {
  CASCADE_RUN_STATUS_UNSPECIFIED = 0;
  CASCADE_RUN_STATUS_RUNNING = 1;
  CASCADE_RUN_STATUS_IDLE = 2;
  CASCADE_RUN_STATUS_WAITING_USER_INPUT = 3;
  CASCADE_RUN_STATUS_ERROR = 4;
  CASCADE_RUN_STATUS_COMPLETED = 5;
}

message CascadeUserInteraction {
  string trajectory_id = 1;
  uint32 step_index = 2;
  oneof payload {
    RunCommandInteraction run_command = 5;
    FilePermissionInteraction file_permission = 6;
    AskQuestionInteraction ask_question = 7;
    McpToolInteraction mcp_tool = 8;
  }
}

message RunCommandInteraction {
  string command = 1;
  string working_directory = 2;
  bool auto_approved = 3;
}

message AskQuestionInteraction {
  string question = 1;
  repeated string options = 2;
  bool is_multi_select = 3;
}
```

---

## 3. `jetbox_summaries.proto`

```protobuf
syntax = "proto3";

package exa.language_server_pb;

import "google/protobuf/timestamp.proto";

message JetboxSubscribeToSummariesRequest {}

message JetboxSubscribeToSummariesResponse {
  map<string, CascadeTrajectorySummary> updates = 1;
  repeated string deletes = 2;
}

message CascadeTrajectorySummary {
  string cascade_id = 1;
  string title = 2;
  string workspace_root = 3;
  google.protobuf.Timestamp last_modified = 4;
  int32 step_count = 5;
  string active_model = 6;
  bool is_pinned = 7;
}
```
