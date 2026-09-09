package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
)

// ComputeHunkHash calculates a deterministic, line-number-independent hash for a diff hunk.
// Ported from Google Antigravity's hunk_storage.ts computeHunkHash.
func ComputeHunkHash(insertions []string, deletions []string, contextStr string) string {
	content := strings.Join(insertions, "\n") + "|||" + strings.Join(deletions, "\n") + "|||" + contextStr
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:8]) // 16-character hex hash
}

// EnrichFileDiff annotates a diff map with a deterministic hunkHash derived from
// its original and modified contents.
func EnrichFileDiff(path string, diff map[string]interface{}) {
	if diff == nil {
		return
	}
	orig, _ := diff["originalContents"].(string)
	mod, _ := diff["modifiedContents"].(string)
	if orig == "" && mod == "" {
		return
	}
	origLines := strings.Split(orig, "\n")
	modLines := strings.Split(mod, "\n")
	diff["hunkHash"] = ComputeHunkHash(modLines, origLines, path)
}

// Position represents a line and character offset in a document.
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

// IsBeforeOrEqual returns true if pos is before or at other.
func (p Position) IsBeforeOrEqual(other Position) bool {
	if p.Line < other.Line {
		return true
	}
	if p.Line == other.Line {
		return p.Character <= other.Character
	}
	return false
}

// IsBefore returns true if pos is strictly before other.
func (p Position) IsBefore(other Position) bool {
	if p.Line < other.Line {
		return true
	}
	if p.Line == other.Line {
		return p.Character < other.Character
	}
	return false
}

// IsEqual returns true if pos and other have the exact same line and character.
func (p Position) IsEqual(other Position) bool {
	return p.Line == other.Line && p.Character == other.Character
}

// Range represents a start and end Position in a text document.
type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

// Contains returns true if the position falls within the range.
func (r Range) Contains(p Position) bool {
	return r.Start.IsBeforeOrEqual(p) && p.IsBeforeOrEqual(r.End)
}

// Intersects returns true if this range intersects with another range.
func (r Range) Intersects(other Range) bool {
	return !other.End.IsBefore(r.Start) && !r.End.IsBefore(other.Start)
}

// TextChange represents a document content change event.
type TextChange struct {
	Range Range  `json:"range"`
	Text  string `json:"text"`
}

// CalculateNewPosition computes the shifted position after a text change.
// Faithful port of inline_diff_range_tracker.ts:calculateNewPosition.
func CalculateNewPosition(pos Position, change TextChange) Position {
	newLine := pos.Line
	newChar := pos.Character

	if !change.Range.End.IsBeforeOrEqual(pos) {
		return pos
	}

	// Handle deletions
	if !change.Range.Start.IsEqual(change.Range.End) {
		if change.Range.End.Line == newLine {
			newChar -= change.Range.End.Character - change.Range.Start.Character
		}
		newLine -= change.Range.End.Line - change.Range.Start.Line
	}

	// Handle insertions
	if change.Text != "" {
		if change.Range.Start.Line == newLine {
			if strings.Contains(change.Text, "\n") {
				newChar -= change.Range.Start.Character
				lastNL := strings.LastIndex(change.Text, "\n")
				newChar += len(change.Text[lastNL+1:])
			} else {
				newChar += len(change.Text)
			}
		}
		newLine += strings.Count(change.Text, "\n")
	}

	return Position{Line: newLine, Character: newChar}
}

// HandleRangeShrinkage shrinks a range if the change event partially or fully overlaps it.
// Ported from inline_diff_range_tracker.ts:handleRangeShrinkage.
func HandleRangeShrinkage(r *Range, change TextChange) *Range {
	if r == nil {
		return nil
	}

	if r.Intersects(change.Range) &&
		!change.Range.End.IsEqual(r.Start) &&
		!change.Range.Start.IsEqual(r.End) {
		if !change.Range.Start.IsEqual(change.Range.End) {
			updatedStart := r.Start
			updatedEnd := r.End

			if change.Range.Contains(r.Start) {
				updatedStart = change.Range.End
			}
			if change.Range.Contains(r.End) {
				updatedEnd = change.Range.Start
			}

			if updatedEnd.IsBefore(updatedStart) {
				return nil
			}
			return &Range{Start: updatedStart, End: updatedEnd}
		}
	}
	return r
}

// CalculateUpdatedRanges shifts a list of Ranges based on document content changes.
// CRITICAL ALGORITHM: Sorts changes in descending order of start position so lower
// edits never perturb the offsets of higher ranges being recalculated.
// Ported from inline_diff_range_tracker.ts:calculateUpdatedRanges.
func CalculateUpdatedRanges(ranges []Range, changes []TextChange) []Range {
	// 1. Clone ranges as pointers
	updated := make([]*Range, len(ranges))
	for i := range ranges {
		r := ranges[i]
		updated[i] = &r
	}

	// 2. Clone and sort changes descending by Start position
	sortedChanges := make([]TextChange, len(changes))
	copy(sortedChanges, changes)
	sort.Slice(sortedChanges, func(i, j int) bool {
		// Descending: c2.start compared to c1.start
		return sortedChanges[j].Range.Start.IsBefore(sortedChanges[i].Range.Start)
	})

	// 3. Apply changes sequentially from bottom to top
	for _, change := range sortedChanges {
		for i := 0; i < len(updated); i++ {
			updated[i] = HandleRangeShrinkage(updated[i], change)
			if updated[i] == nil {
				continue
			}
			newStart := CalculateNewPosition(updated[i].Start, change)
			newEnd := CalculateNewPosition(updated[i].End, change)
			updated[i] = &Range{Start: newStart, End: newEnd}
		}
	}

	// 4. Nullify collapsed ranges & filter
	result := make([]Range, 0, len(updated))
	for _, r := range updated {
		if r != nil && !r.Start.IsEqual(r.End) {
			result = append(result, *r)
		}
	}

	return result
}
