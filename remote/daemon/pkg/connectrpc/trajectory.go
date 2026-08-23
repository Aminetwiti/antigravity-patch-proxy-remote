package connectrpc

import (
	"encoding/binary"
	"regexp"
	"strings"
	"time"
)

// TrajectorySummary décrit une cascade (session) listée par
// GetAllCascadeTrajectories — extraite de la réponse protobuf réelle.
type TrajectorySummary struct {
	CascadeID    string    `json:"cascadeId"`
	TrajectoryID string    `json:"trajectoryId,omitempty"`
	Title        string    `json:"title"`
	Workspace    string    `json:"workspace"`
	ProjectID    string    `json:"projectId"`
	Status       string    `json:"status"`
	UpdatedAt    time.Time `json:"updatedAt,omitempty"`
	StepCount    int       `json:"stepCount,omitempty"`
	Size         int       `json:"size"`
	Archived     bool      `json:"archived,omitempty"` // annotations.archived (field 15→4)
	Killed       bool      `json:"killed,omitempty"`   // field 23
	Source       int       `json:"source,omitempty"`   // field 20 (1=CASCADE_CLIENT, 16=SUBAGENT)
	IsSubagent   bool      `json:"isSubagent,omitempty"`
}

var (
	uuidRe         = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)
	uuidFragmentRe = regexp.MustCompile(`^[0-9a-fA-F-]+$`)
	workspaceRe    = regexp.MustCompile(`file:///[^\x00-\x1f]+`)
	titleBytesRe   = regexp.MustCompile(`[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ._'\-]{4,80}`)
)

// ParseTrajectories dé-framme la réponse gRPC-Web de GetAllCascadeTrajectories
// et extrait un résumé par trajectoire.
//
// Structure observée (rétro-ingénierie, capture réelle) :
//
//	GetAllCascadeTrajectoriesResponse {
//	  1: repeated CascadeTrajectorySummary summaries
//	}
//	CascadeTrajectorySummary {
//	  1: string cascade_id
//	  2: CascadeTrajectoryMetadata metadata   ← titre (sous-champ 1), workspace (sous-champ 9→1)
//	  3: Timestamp created                     ← secondes (sous-champ 1), nanos (sous-champ 2)
//	  22: varint status (4 = READY)
//	}
//
// Certaines entrées (sessions de continuation) sont des blobs texte bruts
// " $<uuid> <contenu>…" — traitées en fallback.
func ParseTrajectories(raw []byte) []TrajectorySummary {
	payload := raw
	// Dé-framming gRPC-Web : flags(1) + longueur BE(4) + payload
	for len(payload) >= 5 {
		length := int(binary.BigEndian.Uint32(payload[1:5]))
		if length <= 0 || 5+length > len(payload) {
			break
		}
		if payload[0]&0x80 == 0 { // frame de données
			return parseTrajectoryFields(DecodeFields(payload[5 : 5+length]))
		}
		payload = payload[5+length:]
	}
	return parseTrajectoryFields(DecodeFields(payload))
}

func parseTrajectoryFields(fields []Field) []TrajectorySummary {
	var out []TrajectorySummary
	for _, f := range fields {
		if f.WireType != 2 || len(f.Bytes) == 0 {
			continue
		}
		if f.Num == 1 {
			out = append(out, trajectoryFromBlob(f.Bytes))
		}
	}
	return out
}

func trajectoryFromBlob(blob []byte) TrajectorySummary {
	t := TrajectorySummary{Size: len(blob)}

	// Forme 1 : message structuré (marqueur = UUID de 36 octets présent)
	fields := DecodeFields(blob)
	if isStructuredTrajectory(fields) {
		for _, f := range fields {
			switch f.Num {
			case 1:
				if f.WireType == 2 && len(f.Bytes) == 36 {
					t.CascadeID = string(f.Bytes)
				}
			case 2:
				if f.WireType == 2 {
					for _, mf := range DecodeFields(f.Bytes) {
						switch mf.Num {
						case 1:
							if mf.WireType == 2 && len(mf.Bytes) > 0 {
								t.Title = string(mf.Bytes)
							}
						case 2:
							if mf.WireType == 0 {
								t.StepCount = int(mf.Varint)
							}
						case 3:
							if t.UpdatedAt.IsZero() {
								t.UpdatedAt = timestampFromMessage(mf.Bytes)
							}
						case 9:
							if mf.WireType == 2 {
								for _, wf := range DecodeFields(mf.Bytes) {
									if wf.WireType == 2 {
										s := string(wf.Bytes)
										if strings.Contains(s, "/") || strings.Contains(s, "\\") {
											t.Workspace = s
										}
									}
								}
								if t.Workspace == "" {
									t.Workspace = string(mf.Bytes)
								}
							}
						case 10:
							tUp := timestampFromMessage(mf.Bytes)
							if !tUp.IsZero() {
								t.UpdatedAt = tUp
							}
						case 15:
							if mf.WireType == 2 {
								for _, af := range DecodeFields(mf.Bytes) {
									if (af.Num == 4 && af.WireType == 0 && af.Varint != 0) || af.Num == 5 {
										t.Archived = true
									}
								}
							}
						case 18:
							if mf.WireType == 2 {
								t.ProjectID = string(mf.Bytes)
							}
						case 22:
							if mf.WireType == 0 {
								t.Status = statusName(int(mf.Varint))
							}
						}
					}
				}
			case 3: // timestamp fallback
				if t.UpdatedAt.IsZero() {
					t.UpdatedAt = timestampFromMessage(f.Bytes)
				}
			case 15: // annotations submessage fallback
				if f.WireType == 2 {
					for _, af := range DecodeFields(f.Bytes) {
						if (af.Num == 4 && af.WireType == 0 && af.Varint != 0) || af.Num == 5 {
							t.Archived = true
						}
					}
				}
			case 20: // source (1=CASCADE_CLIENT, 16=SUBAGENT, 17=CLI, ...)
				t.Source = int(f.Varint)
				if t.Source == 16 {
					t.IsSubagent = true
				}
			case 22:
				if t.Status == "" {
					t.Status = statusName(int(f.Varint))
				}
			case 23: // killed
				if f.Varint != 0 {
					t.Killed = true
				}
			}
			if f.WireType == 2 {
				if t.Title == "" {
					t.Title = findTitle(f.Bytes)
				}
				if t.Workspace == "" {
					t.Workspace = workspaceRe.FindString(string(f.Bytes))
				}
			}
		}
	}

	// Forme 2 (fallback) : blob texte brut " $<uuid> <titre> <workspace>…"
	if t.CascadeID == "" {
		text := strings.TrimSpace(string(blob))
		t.CascadeID = firstUUID(text)
		t.Title = extractTitle(text)
		if t.Workspace == "" {
			t.Workspace = workspaceRe.FindString(text)
		}
	}
	if t.Status == "" {
		t.Status = "CASCADE_STATUS_READY"
	}
	// Archived / killed / subagent override le run status pour que les filtres aval
	// (daemon + mobile) puissent les exclure uniformément.
	if t.Archived {
		t.Status = "CASCADE_STATUS_ARCHIVED"
	}
	if t.Killed {
		t.Status = "CASCADE_STATUS_KILLED"
	}
	if t.Title == "" {
		t.Title = "Cascade Session"
	}
	return t
}

// timestampFromMessage : message {1: secondes, 2: nanos} → time.Time.
func timestampFromMessage(b []byte) time.Time {
	for _, f := range DecodeFields(b) {
		if f.Num == 1 && f.WireType == 0 {
			sec := int64(f.Varint)
			if sec > 0 {
				return time.Unix(sec, 0)
			}
		}
	}
	return time.Time{}
}

// findTitle cherche un titre lisible dans un blob, en descendant d'un niveau
// dans les sous-messages protobuf si nécessaire.
func findTitle(b []byte) string {
	if s := strings.TrimSpace(string(b)); s != "" && isTitleLike([]byte(s)) {
		return s
	}
	for _, f := range DecodeFields(b) {
		if f.WireType != 2 || len(f.Bytes) == 0 {
			continue
		}
		if s := strings.TrimSpace(string(f.Bytes)); isTitleLike([]byte(s)) {
			return s
		}
	}
	return ""
}

// isStructuredTrajectory : vrai si un champ contient un UUID de 36 caractères
// (cascade_id) — marqueur fiable d'une entrée structurée.
func isStructuredTrajectory(fields []Field) bool {
	for _, f := range fields {
		if f.WireType == 2 && len(f.Bytes) == 36 && uuidRe.Match(f.Bytes) {
			return true
		}
	}
	return false
}

// isTitleLike : chaîne imprimable courte (<200 octets) sans UUID ni workspace.
func isTitleLike(b []byte) bool {
	if len(b) == 0 || len(b) > 200 {
		return false
	}
	s := string(b)
	if strings.Contains(s, "file:///") || uuidRe.MatchString(s) {
		return false
	}
	// Fragment d'UUID résiduel ("47da31-5b79-4741-…") : tout hex + tirets.
	if strings.ContainsAny(s, "-") && uuidFragmentRe.MatchString(s) {
		return false
	}
	return len(titleBytesRe.FindString(s)) >= 4
}

func firstUUID(s string) string {
	m := uuidRe.FindString(s)
	if m == "" {
		return ""
	}
	return strings.ToLower(m)
}

func extractTitle(s string) string {
	cleaned := strings.TrimSpace(s)
	cleaned = strings.TrimPrefix(cleaned, "$")
	if m := uuidRe.FindStringIndex(cleaned); m != nil {
		cleaned = cleaned[m[1]:]
	}
	// Nettoie les octets de contrôle / ponctuation binaire avant extraction
	cleaned = strings.TrimLeft(cleaned, " \t\n\r\xb7\x00\x01\x02\x03\x04\x05\"'$+(")
	if i := strings.IndexByte(cleaned, '\n'); i >= 0 {
		cleaned = cleaned[:i]
	}
	candidates := titleBytesRe.FindAllString(cleaned, -1)
	for _, c := range candidates {
		// ignore les fragments d'UUID résiduels (trop courts ou tirets seuls)
		if len(c) >= 8 && !strings.Contains(c, "-") {
			return c
		}
	}
	for _, c := range candidates {
		if len(c) >= 8 {
			return c
		}
	}
	if len(candidates) > 0 {
		return candidates[len(candidates)-1]
	}
	return ""
}

func statusName(v int) string {
	switch v {
	case 1:
		return "CASCADE_STATUS_RUNNING"
	case 2:
		return "CASCADE_STATUS_WAITING_APPROVAL"
	case 4:
		return "CASCADE_STATUS_READY"
	case 5:
		return "CASCADE_STATUS_ERROR"
	default:
		return "CASCADE_STATUS_UNKNOWN"
	}
}
