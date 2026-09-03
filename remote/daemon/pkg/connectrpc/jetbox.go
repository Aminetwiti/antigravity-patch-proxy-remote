package connectrpc

import (
	"encoding/json"
	"time"
)

// JetboxSummary est la forme compacte d'une CascadeTrajectorySummary reçue du
// stream JetboxSubscribeToSummaries — suffisant pour list_sessions sans
// télécharger la trajectoire complète (~10x plus petit que GetAllCascades).
//
// Le stream parle application/connect+json (voir jetbox.js du projet Deck) :
// chaque frame gRPC-Web contient un objet JSON
//
//	{ "updates": { "<cascadeId>": { ...CascadeTrajectorySummary } },
//	  "deletes": ["<cascadeId>", ...] }
//
// avec les champs sérialisés en protojson (camelCase, enums en string,
// Timestamp en RFC3339). On accepte aussi enum en nombre et Timestamp en
// objet {seconds, nanos} par robustesse (variantes de sérialisation).
type JetboxSummary struct {
	CascadeID    string    `json:"cascadeId"`
	TrajectoryID string    `json:"trajectoryId,omitempty"`
	Title        string    `json:"title"`
	Workspace    string    `json:"workspace"`
	ProjectID    string    `json:"projectId"`
	Status       string    `json:"status"`
	UpdatedAt    time.Time `json:"updatedAt,omitempty"`
	StepCount    int       `json:"stepCount,omitempty"`
	Source       int       `json:"source,omitempty"` // 16 = SUBAGENT
	IsSubagent      bool      `json:"isSubagent,omitempty"`
	ParentCascadeID string    `json:"parentCascadeId,omitempty"`
	Archived     bool      `json:"archived,omitempty"`
	Killed       bool      `json:"killed,omitempty"`
	Waiting      bool      `json:"waiting,omitempty"`
}

// jetboxFrame : forme wire d'une frame du stream JetboxSubscribeToSummaries.
type jetboxFrame struct {
	Updates map[string]jetboxSummaryJSON `json:"updates"`
	Deletes []string                     `json:"deletes"`
}

// jetboxSummaryJSON : miroir protojson de CascadeTrajectorySummary
// (jetski_cortex_pb.ts) — on ne décode que ce dont list_sessions a besoin.
type jetboxSummaryJSON struct {
	Summary      string `json:"summary"` // premier prompt utilisateur = titre
	StepCount    int    `json:"stepCount"`
	LastModified string `json:"lastModifiedTime"`
	TrajectoryID string `json:"trajectoryId"`
	Status       any    `json:"status"` // string "CASCADE_RUN_STATUS_*" ou nombre
	WaitingSteps []any  `json:"waitingSteps"`
	Annotations  *struct {
		Archived                bool `json:"archived"`
		IsArchived              bool `json:"isArchived"`
		ArchivalStatusTimestamp any  `json:"archivalStatusTimestamp"`
		ArchivalStatus          any  `json:"archivalStatus"`
		Deleted                 bool `json:"deleted"`
		IsDeleted               bool `json:"isDeleted"`
	} `json:"annotations"`
	TrajectoryMetadata *struct {
		ProjectID            string `json:"projectId"`
		ParentConversationID string `json:"parentConversationId"`
		ParentCascadeID      string `json:"parentCascadeId"`
		ParentTrajectoryID   string `json:"parentTrajectoryId"`
		RootConversationID   string `json:"rootConversationId"`
		NestingDepth         int    `json:"nestingDepth"`
		SubagentSpec         any    `json:"subagentSpec"`
		AgentScript          any    `json:"agentScript"`
		SubagentMetadata     any    `json:"subagentMetadata"`
		WorktreeMetadata     any    `json:"worktreeMetadata"`
	} `json:"trajectoryMetadata"`
	Workspaces []struct {
		WorkspaceFolderAbsoluteURI string `json:"workspaceFolderAbsoluteUri"`
	} `json:"workspaces"`
	Source       any  `json:"source"`
	NotFullyIdle bool `json:"notFullyIdle"`
	Killed       bool `json:"killed"`
}

// ParseJetboxFrame décode une frame JSON du stream JetboxSubscribeToSummaries.
// Retourne les mises à jour (cascadeId → résumé) et les suppressions.
// Une frame sans "updates" ni "deletes" est ignorée silencieusement (heartbeat
// ou snapshot vide).
func ParseJetboxFrame(frame []byte) (updates map[string]JetboxSummary, deletes []string) {
	var f jetboxFrame
	if err := json.Unmarshal(frame, &f); err != nil {
		return nil, nil
	}
	updates = make(map[string]JetboxSummary, len(f.Updates))
	for id, raw := range f.Updates {
		s := raw.toSummary(id)
		if s.CascadeID != "" {
			updates[id] = s
		}
	}
	return updates, f.Deletes
}

func (j jetboxSummaryJSON) toSummary(id string) JetboxSummary {
	s := JetboxSummary{
		CascadeID:    id,
		TrajectoryID: j.TrajectoryID,
		Title:        j.Summary,
		StepCount:    j.StepCount,
		Status:       jetboxStatusName(j.Status),
		Source:       jetboxSourceValue(j.Source),
		Killed:       j.Killed,
		Waiting:      len(j.WaitingSteps) > 0 || j.NotFullyIdle,
	}
	if s.Source == 16 {
		s.IsSubagent = true
	}
	if j.Annotations != nil {
		if j.Annotations.Archived || j.Annotations.IsArchived || j.Annotations.ArchivalStatusTimestamp != nil || j.Annotations.ArchivalStatus != nil {
			s.Archived = true
		}
		if j.Annotations.Deleted || j.Annotations.IsDeleted {
			s.Killed = true
		}
	}
	if j.TrajectoryMetadata != nil {
		s.ProjectID = j.TrajectoryMetadata.ProjectID
		parentID := j.TrajectoryMetadata.ParentConversationID
		if parentID == "" {
			parentID = j.TrajectoryMetadata.ParentCascadeID
		}
		s.ParentCascadeID = parentID
		if parentID != "" ||
			j.TrajectoryMetadata.NestingDepth > 0 ||
			j.TrajectoryMetadata.SubagentSpec != nil ||
			j.TrajectoryMetadata.AgentScript != nil ||
			j.TrajectoryMetadata.SubagentMetadata != nil ||
			j.TrajectoryMetadata.WorktreeMetadata != nil {
			s.IsSubagent = true
			s.Source = 16
		}
	}
	if len(j.Workspaces) > 0 {
		s.Workspace = j.Workspaces[0].WorkspaceFolderAbsoluteURI
	}
	s.UpdatedAt = parseJetboxTime(j.LastModified)

	if s.Title == "" {
		s.Title = "Cascade Session"
	}
	if s.Archived {
		s.Status = "CASCADE_STATUS_ARCHIVED"
	}
	if s.Killed {
		s.Status = "CASCADE_STATUS_KILLED"
	}
	return s
}

// parseJetboxTime accepte RFC3339 (protojson) et objet {seconds, nanos}.
func parseJetboxTime(v string) time.Time {
	if v == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
		return t
	}
	return time.Time{}
}

// jetboxStatusName : enum CascadeRunStatus (cortex_pb.ts ligne 843) —
// 1 IDLE, 2 RUNNING, 3 CANCELING, 4 BUSY. Accepte string ou nombre.
// Mappé vers les statuts JSON historiques du daemon (contrat mobile inchangé).
func jetboxStatusName(v any) string {
	switch t := v.(type) {
	case string:
		switch t {
		case "CASCADE_RUN_STATUS_IDLE":
			return "CASCADE_STATUS_READY"
		case "CASCADE_RUN_STATUS_RUNNING":
			return "CASCADE_STATUS_RUNNING"
		case "CASCADE_RUN_STATUS_CANCELING":
			return "CASCADE_STATUS_ERROR"
		case "CASCADE_RUN_STATUS_BUSY":
			return "CASCADE_STATUS_RUNNING"
		default:
			return "CASCADE_STATUS_UNKNOWN"
		}
	case float64:
		switch int(t) {
		case 1:
			return "CASCADE_STATUS_READY"
		case 2:
			return "CASCADE_STATUS_RUNNING"
		case 3:
			return "CASCADE_STATUS_ERROR"
		case 4:
			return "CASCADE_STATUS_RUNNING"
		}
	}
	return "CASCADE_STATUS_UNKNOWN"
}

// jetboxSourceValue : enum CortexTrajectorySource (cortex_pb.ts ligne 351).
// Seule la valeur numérique intéresse le filtre subagent (16).
func jetboxSourceValue(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case string:
		switch t {
		case "CORTEX_TRAJECTORY_SOURCE_SUBAGENT":
			return 16
		case "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT":
			return 1
		case "CORTEX_TRAJECTORY_SOURCE_CLI":
			return 17
		case "CORTEX_TRAJECTORY_SOURCE_JETBOX":
			return 18
		}
	}
	return 0
}

// ToTrajectorySummary convertit un résumé Jetbox vers le type historique
// TrajectorySummary (utilisé par cachedProjectID et le filtre sessionsOut).
func (j JetboxSummary) ToTrajectorySummary() TrajectorySummary {
	return TrajectorySummary{
		CascadeID:    j.CascadeID,
		TrajectoryID: j.TrajectoryID,
		Title:        j.Title,
		Workspace:    j.Workspace,
		ProjectID:    j.ProjectID,
		Status:       j.Status,
		UpdatedAt:    j.UpdatedAt,
		Size:         j.StepCount,
		Archived:     j.Archived,
		Killed:       j.Killed,
		Source:          j.Source,
		IsSubagent:      j.IsSubagent,
		ParentCascadeID: j.ParentCascadeID,
	}
}
