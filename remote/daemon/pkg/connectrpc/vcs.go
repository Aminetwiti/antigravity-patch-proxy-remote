package connectrpc

import (
	"encoding/binary"
	"strings"
	"time"
)

// VCS — décodage best-effort de GetVersionControlStateResponse (exa.vcs_pb).
// Schéma (vcs.proto, capturé dans remote/tools/protocols/grpc-schemas) :
//
//	VcsWorkspaceState {
//	  1: VcsType vcs_type                 // 4 = GIT
//	  2: string current_ref               // branche courante
//	  3: string active_commit_id
//	  4: repeated VcsCommit commits       // history (sous-ensemble)
//	  5: repeated VcsFileChange working_directory_changes
//	  6: VcsConflictState conflict_state
//	  7: repeated VcsFileChange staged_changes
//	  8: repeated VcsFileChange branch_changes
//	  9: string merge_base_commit_id
//	  10: string target_branch
//	}
//	VcsFileChange { 1: uri, 2: Operation, 3: original_uri, 4: content_hash }
//	VcsCommit { 1: id, 4: author{1:name,2:email}, 5: timestamp_ms,
//	           6: message{1:subject,2:body}, 8: refs{1:branches} }
//	VcsConflictState { 1: in_conflict, 2: Operation, 3: conflicts[] }
//
// Le décodage est best-effort : un schéma inconnu retourne des champs vides,
// jamais une erreur fatale (dégradation gracieuse comme ParseModels).

// VcsFileChange décrit un fichier modifié/ajouté/supprimé dans le workspace.
type VcsFileChange struct {
	URI         string `json:"uri"`
	Operation   string `json:"operation"`
	OriginalURI string `json:"originalUri,omitempty"`
}

// VcsCommit résume un commit de l'historique.
type VcsCommit struct {
	ID        string `json:"id"`
	Author    string `json:"author,omitempty"`
	Timestamp int64  `json:"timestampMs,omitempty"`
	Subject   string `json:"subject,omitempty"`
	Body      string `json:"body,omitempty"`
}

// VcsConflictFile décrit un fichier en conflit.
type VcsConflictFile struct {
	Path string `json:"path"`
}

// VcsWorkspaceState est la forme JSON du VcsWorkspaceState protobuf.
type VcsWorkspaceState struct {
	VcsType           string            `json:"vcsType"`
	CurrentRef        string            `json:"currentRef"`
	ActiveCommitID    string            `json:"activeCommitId"`
	Commits           []VcsCommit       `json:"commits,omitempty"`
	WorkingDirChanges []VcsFileChange   `json:"workingDirectoryChanges,omitempty"`
	StagedChanges     []VcsFileChange   `json:"stagedChanges,omitempty"`
	BranchChanges     []VcsFileChange   `json:"branchChanges,omitempty"`
	InConflict        bool              `json:"inConflict,omitempty"`
	Conflicts         []VcsConflictFile `json:"conflicts,omitempty"`
	MergeBaseCommitID string            `json:"mergeBaseCommitId,omitempty"`
	TargetBranch      string            `json:"targetBranch,omitempty"`
}

// ParseVersionControlState dé-framme la réponse gRPC-Web de
// GetVersionControlState et extrait l'état VCS du workspace.
func ParseVersionControlState(raw []byte) (VcsWorkspaceState, bool) {
	payload := raw
	for len(payload) >= 5 {
		length := int(binary.BigEndian.Uint32(payload[1:5]))
		if length <= 0 || 5+length > len(payload) {
			break
		}
		if payload[0]&0x80 == 0 { // frame de données
			return parseVcsFields(DecodeFields(payload[5 : 5+length]))
		}
		payload = payload[5+length:]
	}
	return parseVcsFields(DecodeFields(payload))
}

func parseVcsFields(fields []Field) (VcsWorkspaceState, bool) {
	var st VcsWorkspaceState
	ok := false
	for _, f := range fields {
		if f.WireType != 2 {
			continue
		}
		switch f.Num {
		case 1: // vcs_type (enum varint, wireType 0) — traité plus bas
		case 2:
			st.CurrentRef = string(f.Bytes)
			ok = true
		case 3:
			st.ActiveCommitID = string(f.Bytes)
		case 4:
			if c, parsed := parseVcsCommit(f.Bytes); parsed {
				st.Commits = append(st.Commits, c)
				ok = true
			}
		case 5:
			if fc, parsed := parseVcsFileChange(f.Bytes); parsed {
				st.WorkingDirChanges = append(st.WorkingDirChanges, fc)
				ok = true
			}
		case 6:
			if c, parsed := parseVcsConflictState(f.Bytes); parsed {
				st.InConflict = c.inConflict
				st.Conflicts = c.conflicts
				ok = true
			}
		case 7:
			if fc, parsed := parseVcsFileChange(f.Bytes); parsed {
				st.StagedChanges = append(st.StagedChanges, fc)
				ok = true
			}
		case 8:
			if fc, parsed := parseVcsFileChange(f.Bytes); parsed {
				st.BranchChanges = append(st.BranchChanges, fc)
				ok = true
			}
		case 9:
			st.MergeBaseCommitID = string(f.Bytes)
		case 10:
			st.TargetBranch = string(f.Bytes)
		}
	}
	// VcsType est un varint (wireType 0, champ 1) — décodé séparément.
	for _, f := range fields {
		if f.Num == 1 && f.WireType == 0 {
			st.VcsType = vcsTypeName(int(f.Varint))
			ok = true
		}
	}
	return st, ok
}

func parseVcsFileChange(b []byte) (VcsFileChange, bool) {
	var fc VcsFileChange
	for _, f := range DecodeFields(b) {
		switch f.Num {
		case 1:
			if f.WireType == 2 {
				fc.URI = string(f.Bytes)
			}
		case 2:
			fc.Operation = vcsOperationName(int(f.Varint))
		case 3:
			if f.WireType == 2 {
				fc.OriginalURI = string(f.Bytes)
			}
		}
	}
	return fc, fc.URI != ""
}

func parseVcsCommit(b []byte) (VcsCommit, bool) {
	var c VcsCommit
	for _, f := range DecodeFields(b) {
		switch f.Num {
		case 1:
			if f.WireType == 2 {
				c.ID = string(f.Bytes)
			}
		case 4: // author {1: name, 2: email}
			if f.WireType == 2 {
				for _, af := range DecodeFields(f.Bytes) {
					if af.Num == 1 && af.WireType == 2 {
						c.Author = string(af.Bytes)
						break
					}
				}
			}
		case 5:
			c.Timestamp = int64(f.Varint)
		case 6: // message {1: subject, 2: body}
			if f.WireType == 2 {
				for _, mf := range DecodeFields(f.Bytes) {
					if mf.WireType == 2 {
						switch mf.Num {
						case 1:
							c.Subject = string(mf.Bytes)
						case 2:
							c.Body = string(mf.Bytes)
						}
					}
				}
			}
		}
	}
	return c, c.ID != ""
}

func parseVcsConflictState(b []byte) (struct {
	inConflict bool
	conflicts  []VcsConflictFile
}, bool) {
	var out struct {
		inConflict bool
		conflicts  []VcsConflictFile
	}
	for _, f := range DecodeFields(b) {
		switch f.Num {
		case 1:
			out.inConflict = f.Varint != 0
		case 3:
			if f.WireType == 2 {
				var cf VcsConflictFile
				for _, ff := range DecodeFields(f.Bytes) {
					if ff.Num == 1 && ff.WireType == 2 {
						cf.Path = string(ff.Bytes)
						break
					}
				}
				if cf.Path != "" {
					out.conflicts = append(out.conflicts, cf)
				}
			}
		}
	}
	return out, true
}

// vcsTypeName : enum VcsType (vcs.proto) — 4 = GIT.
func vcsTypeName(v int) string {
	switch v {
	case 1:
		return "PIPER"
	case 2:
		return "FIG"
	case 3:
		return "JJ"
	case 4:
		return "GIT"
	default:
		return "UNSPECIFIED"
	}
}

// vcsOperationName : enum VcsFileChange.Operation.
func vcsOperationName(v int) string {
	switch v {
	case 1:
		return "ADDED"
	case 2:
		return "MODIFIED"
	case 3:
		return "DELETED"
	case 4:
		return "RENAMED"
	case 5:
		return "COPIED"
	default:
		return "UNKNOWN"
	}
}

// VcsStateToJSON est le point d'entrée du gateway : convertit la réponse brute
// en objet JSON (pour toOutgoing). Renvoie nil si le schéma est inconnu.
func VcsStateToJSON(raw []byte) interface{} {
	st, ok := ParseVersionControlState(raw)
	if !ok {
		return nil
	}
	return st
}

// NormalizeWorkspaceURI garantit un URI file:/// à partir d'un chemin natif
// (le LS accepte les deux pour les RPC git ; le mobile envoie des chemins).
func NormalizeWorkspaceURI(p string) string {
	if strings.HasPrefix(p, "file://") {
		return p
	}
	return "file:///" + strings.TrimLeft(strings.ReplaceAll(p, "\\", "/"), "/")
}

// GitTimestampTime convertit un timestamp VCS (ms) en time.Time.
func GitTimestampTime(ms int64) time.Time {
	if ms <= 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms)
}
