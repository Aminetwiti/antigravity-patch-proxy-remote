package agent

import (
	"testing"
)

func TestComputeHunkHash(t *testing.T) {
	insertions := []string{"const x = 42;", "return x * 2;"}
	deletions := []string{"return 84;"}
	contextStr := "function calculate()"

	hash1 := ComputeHunkHash(insertions, deletions, contextStr)
	hash2 := ComputeHunkHash(insertions, deletions, contextStr)

	if hash1 == "" {
		t.Fatalf("expected non-empty hash")
	}
	if hash1 != hash2 {
		t.Fatalf("expected deterministic hash, got %s and %s", hash1, hash2)
	}

	// Different content produces different hash
	hashDiff := ComputeHunkHash([]string{"const x = 43;"}, deletions, contextStr)
	if hash1 == hashDiff {
		t.Fatalf("expected different hash for different insertions")
	}
}

func TestCalculateNewPosition_InsertionAbove(t *testing.T) {
	pos := Position{Line: 10, Character: 5}

	// Insert 2 new lines at line 4
	change := TextChange{
		Range: Range{
			Start: Position{Line: 4, Character: 0},
			End:   Position{Line: 4, Character: 0},
		},
		Text: "line1\nline2\n",
	}

	newPos := CalculateNewPosition(pos, change)
	if newPos.Line != 12 {
		t.Fatalf("expected line 12 after inserting 2 new lines, got %d", newPos.Line)
	}
	if newPos.Character != 5 {
		t.Fatalf("expected character 5 unchanged, got %d", newPos.Character)
	}
}

func TestCalculateNewPosition_InsertionBelow(t *testing.T) {
	pos := Position{Line: 10, Character: 5}

	// Insert lines at line 15 (after pos)
	change := TextChange{
		Range: Range{
			Start: Position{Line: 15, Character: 0},
			End:   Position{Line: 15, Character: 0},
		},
		Text: "hello\nworld\n",
	}

	newPos := CalculateNewPosition(pos, change)
	if newPos.Line != 10 || newPos.Character != 5 {
		t.Fatalf("expected position unchanged for edit below, got %+v", newPos)
	}
}

func TestCalculateNewPosition_DeletionAbove(t *testing.T) {
	pos := Position{Line: 10, Character: 5}

	// Delete 3 lines between lines 2 and 5
	change := TextChange{
		Range: Range{
			Start: Position{Line: 2, Character: 0},
			End:   Position{Line: 5, Character: 0},
		},
		Text: "",
	}

	newPos := CalculateNewPosition(pos, change)
	if newPos.Line != 7 {
		t.Fatalf("expected line 7 after deleting 3 lines, got %d", newPos.Line)
	}
}

func TestCalculateUpdatedRanges_DescendingSort(t *testing.T) {
	ranges := []Range{
		{Start: Position{Line: 5, Character: 0}, End: Position{Line: 8, Character: 0}},
		{Start: Position{Line: 20, Character: 0}, End: Position{Line: 25, Character: 0}},
	}

	// User makes two edits: one at line 2 and one at line 15.
	// Even if provided in arbitrary order, descending sort processes line 15 first, then line 2.
	changes := []TextChange{
		{
			Range: Range{Start: Position{Line: 2, Character: 0}, End: Position{Line: 2, Character: 0}},
			Text:  "addedLine\n",
		},
		{
			Range: Range{Start: Position{Line: 15, Character: 0}, End: Position{Line: 15, Character: 0}},
			Text:  "addedLineA\naddedLineB\n",
		},
	}

	updated := CalculateUpdatedRanges(ranges, changes)
	if len(updated) != 2 {
		t.Fatalf("expected 2 updated ranges, got %d", len(updated))
	}

	// First range (originally 5..8) was after line 2 (1 line added) -> should be 6..9
	if updated[0].Start.Line != 6 || updated[0].End.Line != 9 {
		t.Fatalf("expected first range shifted by +1 to 6..9, got %+v", updated[0])
	}

	// Second range (originally 20..25) was after line 2 (+1) and line 15 (+2) -> total +3 -> should be 23..28
	if updated[1].Start.Line != 23 || updated[1].End.Line != 28 {
		t.Fatalf("expected second range shifted by +3 to 23..28, got %+v", updated[1])
	}
}
