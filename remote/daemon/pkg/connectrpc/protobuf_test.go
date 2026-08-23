package connectrpc

import (
	"testing"
)

func TestBuildStartCascadeAndDecode(t *testing.T) {
	workspaceURI := "file:///C:/test_project"
	requestedModel := uint64(190)

	buf := BuildStartCascade(workspaceURI, "", "", requestedModel)
	if len(buf) == 0 {
		t.Fatalf("BuildStartCascade ne devrait pas renvoyer un buffer vide")
	}

	fields := DecodeFields(buf)
	if len(fields) == 0 {
		t.Fatalf("DecodeFields ne devrait pas renvoyer une liste de champs vide")
	}

	foundWorkspace := false
	foundModel := false

	for _, f := range fields {
		if f.Num == 8 && string(f.Bytes) == workspaceURI {
			foundWorkspace = true
		}
		if f.Num == 14 && f.Varint == requestedModel {
			foundModel = true
		}
	}

	if !foundWorkspace {
		t.Errorf("Attendu workspaceURI=%s dans le champ #8", workspaceURI)
	}
	if !foundModel {
		t.Errorf("Attendu modelID=%d dans le champ #14", requestedModel)
	}
}

// TestBuildStartCascadeModelUID - quand le mobile fournit un modelUID, le
// champ 15 (requested_model_uid) est encodé à la place de l'enum (14), et
// l'inverse quand l'UID est vide.
func TestBuildStartCascadeModelUID(t *testing.T) {
	t.Run("UID prioritaire", func(t *testing.T) {
		buf := BuildStartCascade("file:///C:/x", "", "gemini-3.1-pro-low", 0)
		foundEnum := false
		for _, f := range DecodeFields(buf) {
			if f.Num == 14 && f.Varint == 246 {
				foundEnum = true
			}
		}
		if !foundEnum {
			t.Error("Attendu requested_model (champ 14) résolu vers l'enum du modèle")
		}
	})

	t.Run("repli enum", func(t *testing.T) {
		buf := BuildStartCascade("file:///C:/x", "", "", 190)
		foundEnum := false
		for _, f := range DecodeFields(buf) {
			if f.Num == 14 && f.Varint == 190 {
				foundEnum = true
			}
		}
		if !foundEnum {
			t.Error("Attendu requested_model (14)=190 en repli sans UID")
		}
	})
}

func TestBuildSendMessage(t *testing.T) {
	cascadeID := "casc-1234-abcd"
	promptText := "Hello Antigravity!"
	apiKey := "test-api-key"
	sessionID := "sess-1"
	modelUID := "gemini-3.0-flash-high"

	buf := BuildSendMessage(cascadeID, promptText, apiKey, sessionID, modelUID, 0)
	fields := DecodeFields(buf)

	if len(fields) < 2 {
		t.Fatalf("Attendu au moins 2 champs dans BuildSendMessage")
	}

	if string(fields[0].Bytes) != cascadeID {
		t.Errorf("Attendu cascadeID=%s dans champ #1, reçu=%s", cascadeID, string(fields[0].Bytes))
	}

	// Le LS 2.8.0 exige cascade_config (champ 5) avec un modèle demandé :
	// format validé 1/15 (plan_model + requested_model ModelOrAlias) —
	// l'ancien layout 5/6 est rejeté (« neither PlanModel nor RequestedModel »).
	foundConfig := false
	for _, f := range fields {
		if f.Num == 5 && len(f.Bytes) > 0 {
			foundConfig = true
			inner := DecodeFields(f.Bytes)
			for _, sub := range inner {
				if sub.Num == 1 { // planner_config (CascadePlannerConfig)
					planner := DecodeFields(sub.Bytes)
					foundPlan := false
					foundReq := false
					foundModelName := false
					for _, p := range planner {
						if p.Num == 1 && p.Varint != 0 {
							foundPlan = true // plan_model
						}
						if p.Num == 15 { // requested_model (ModelOrAlias)
							reqModel := DecodeFields(p.Bytes)
							for _, rm := range reqModel {
								if rm.Num == 1 && rm.Varint != 0 {
									foundReq = true // model = enum
								}
							}
						}
						if p.Num == 28 && string(p.Bytes) == modelUID {
							foundModelName = true
						}
					}
					if !foundPlan {
						t.Errorf("cascade_config: plan_model (planner field 1) manquant")
					}
					if !foundReq {
						t.Errorf("cascade_config: requested_model (planner field 15) manquant")
					}
					if !foundModelName {
						t.Errorf("cascade_config: model_name (planner field 28) manquant")
					}
				}
			}
		}
	}
	if !foundConfig {
		t.Errorf("cascade_config (champ 5) manquant dans BuildSendMessage")
	}
}

func TestBuildSendMessageModelFallback(t *testing.T) {
	// Sans modèle spécifié, repli sur CASCADE_BASE (alias = 1)
	buf := BuildSendMessage("casc-1", "Hello", "", "", "", 0)
	fields := DecodeFields(buf)
	foundAlias := false
	for _, f := range fields {
		if f.Num == 5 {
			for _, sub := range DecodeFields(f.Bytes) {
				if sub.Num == 1 {
					for _, p := range DecodeFields(sub.Bytes) {
						if p.Num == 15 {
							for _, rm := range DecodeFields(p.Bytes) {
								if rm.Num == 2 && rm.Varint == 1 {
									foundAlias = true
								}
							}
						}
					}
				}
			}
		}
	}
	if !foundAlias {
		t.Errorf("Attendu requested_model alias=CASCADE_BASE quand aucun modèle n'est spécifié")
	}
}

func TestResolveStandardModelEnum(t *testing.T) {
	cases := []struct {
		in   string
		want uint64
	}{
		{"gemini-3.7-flash", 312},
		{"gemini-3.1-pro", 246},
		{"claude-sonnet-4.6-thinking", 384},
		{"claude-3-7-sonnet", 384},
		{"claude-opus-4.6-thinking", 393},
		{"deepseek-r1", 401},
		{"gpt-4o-mini", 281},
		{"unknown-custom-model", 0},
	}
	for _, tc := range cases {
		got := ResolveStandardModelEnum(tc.in)
		if got != tc.want {
			t.Errorf("ResolveStandardModelEnum(%q) = %d, attendu %d", tc.in, got, tc.want)
		}
	}
}

func TestVarintEncoding(t *testing.T) {
	w := &writer{}
	w.varint(300)

	val, n := readVarint(w.b, 0)
	if val != 300 {
		t.Errorf("Attendu varint=300, reçu=%d", val)
	}
	if n != len(w.b) {
		t.Errorf("Attendu octets luss=%d, reçu=%d", len(w.b), n)
	}
}

func TestBuildHandleCascadeUserInteraction_RoundTrip(t *testing.T) {
	cascadeID := "casc-111"
	trajID := "traj-222"
	step := uint32(3)

	oneof := BuildRunCommandInteraction(true, "echo hi", "")
	buf := BuildHandleCascadeUserInteraction(cascadeID, trajID, step, InteractionRunCommand, oneof)

	fields := DecodeFields(buf)
	if len(fields) != 2 || fields[0].Num != 1 || string(fields[0].Bytes) != cascadeID {
		t.Fatalf("wrapper invalide: %+v", fields)
	}
	if fields[1].Num != 2 {
		t.Fatalf("interaction attendue dans le champ #2, reçu #%d", fields[1].Num)
	}

	sub := DecodeFields(fields[1].Bytes)
	var gotTraj string
	var gotStep uint32
	var gotOneof int
	var gotConfirm bool
	for _, f := range sub {
		switch f.Num {
		case 1:
			gotTraj = string(f.Bytes)
		case 2:
			gotStep = uint32(f.Varint)
		case InteractionRunCommand:
			gotOneof = f.Num
			for _, inner := range DecodeFields(f.Bytes) {
				if inner.Num == 1 {
					gotConfirm = inner.Varint == 1
				}
			}
		}
	}
	if gotTraj != trajID || gotStep != step || gotOneof != InteractionRunCommand || !gotConfirm {
		t.Fatalf("round-trip KO: traj=%s step=%d oneof=%d confirm=%v", gotTraj, gotStep, gotOneof, gotConfirm)
	}
}

func TestBuildHandleStreamingCommand(t *testing.T) {
	cmd := "/model gemini-3-pro"
	buf := BuildHandleStreamingCommand(cmd, CommandRequestSourceTerminal)
	fields := DecodeFields(buf)
	if len(fields) != 2 {
		t.Fatalf("Attendu 2 champs (command_text + request_source), reçu %d: %+v", len(fields), fields)
	}
	var gotText string
	var gotSource uint64
	for _, f := range fields {
		switch f.Num {
		case 8:
			gotText = string(f.Bytes)
		case 9:
			gotSource = f.Varint
		}
	}
	if gotText != cmd {
		t.Errorf("Attendu command_text=%q, reçu=%q", cmd, gotText)
	}
	if gotSource != CommandRequestSourceTerminal {
		t.Errorf("Attendu request_source=%d (TERMINAL), reçu=%d", CommandRequestSourceTerminal, gotSource)
	}
}

func TestBuildAskQuestionInteraction(t *testing.T) {
	selected := []string{"opt_1", "opt_2"}
	writeIn := "Custom write in answer"
	buf := BuildAskQuestionInteraction(selected, writeIn, false)
	fields := DecodeFields(buf)
	if len(fields) != 1 || fields[0].Num != 1 {
		t.Fatalf("Attendu champ responses (tag 1), reçu: %+v", fields)
	}
	entryFields := DecodeFields(fields[0].Bytes)
	var gotOptions []string
	var gotWriteIn string
	for _, f := range entryFields {
		switch f.Num {
		case 4:
			gotOptions = append(gotOptions, string(f.Bytes))
		case 5:
			gotWriteIn = string(f.Bytes)
		}
	}
	if len(gotOptions) != 2 || gotOptions[0] != "opt_1" || gotOptions[1] != "opt_2" {
		t.Errorf("Attendu options [opt_1, opt_2], reçu %v", gotOptions)
	}
	if gotWriteIn != writeIn {
		t.Errorf("Attendu writeIn %q, reçu %q", writeIn, gotWriteIn)
	}
}

func TestBuildSearchCode(t *testing.T) {
	buf := BuildSearchCode("func Calculate", "file:///C:/workspace", 25, 4)
	fields := DecodeFields(buf)
	var gotQuery, gotURI string
	var gotMax, gotLines uint64
	for _, f := range fields {
		switch f.Num {
		case 1:
			gotQuery = string(f.Bytes)
		case 2:
			gotURI = string(f.Bytes)
		case 3:
			gotMax = f.Varint
		case 4:
			gotLines = f.Varint
		}
	}
	if gotQuery != "func Calculate" || gotURI != "file:///C:/workspace" || gotMax != 25 || gotLines != 4 {
		t.Errorf("SearchCode mismatch: query=%q uri=%q max=%d lines=%d", gotQuery, gotURI, gotMax, gotLines)
	}
}

func TestBuildCheckoutWorktree(t *testing.T) {
	buf := BuildCheckoutWorktree("file:///C:/worktrees/wt1", "file:///C:/main", true, 2)
	fields := DecodeFields(buf)
	var gotDir, gotTarget string
	var gotDelete bool
	var gotStrategy uint64
	for _, f := range fields {
		switch f.Num {
		case 1:
			gotDir = string(f.Bytes)
		case 2:
			gotTarget = string(f.Bytes)
		case 3:
			gotDelete = f.Varint == 1
		case 4:
			gotStrategy = f.Varint
		}
	}
	if gotDir != "file:///C:/worktrees/wt1" || gotTarget != "file:///C:/main" || !gotDelete || gotStrategy != 2 {
		t.Errorf("CheckoutWorktree mismatch: dir=%q target=%q delete=%v strategy=%d", gotDir, gotTarget, gotDelete, gotStrategy)
	}
}

func TestBuildSendMessageWithMedia(t *testing.T) {
	media := []MediaAttachment{
		{
			URI:         "file:///C:/Users/test/.gemini/antigravity/brain/c1/doc.pdf",
			MimeType:    "application/pdf",
			Description: "doc.pdf",
			Data:        []byte("fake_pdf_bytes"),
		},
		{
			URI:         "file:///C:/Users/test/.gemini/antigravity/brain/c1/.user_uploaded/photo.png",
			MimeType:    "image/png",
			Description: "photo.png",
			Base64Data:  "iVBORw0KGgo=",
			Data:        []byte("fake_image_bytes"),
		},
	}

	buf := BuildSendMessageWithMedia("c1", "Look at this document", "apikey123", "sess1", "gemini-3.7-flash", 312, media)
	if len(buf) == 0 {
		t.Fatal("BuildSendMessageWithMedia returned empty buffer")
	}

	fields := DecodeFields(buf)
	foundCascadeID := false
	foundItems := false
	foundNonImageMedia := false
	foundForbiddenImageField := false
	foundConfig := false

	for _, f := range fields {
		switch f.Num {
		case 1:
			if string(f.Bytes) == "c1" {
				foundCascadeID = true
			}
		case 2:
			itemFields := DecodeFields(f.Bytes)
			for _, itemField := range itemFields {
				if itemField.Num == 1 && string(itemField.Bytes) == "Look at this document" {
					foundItems = true
				}
			}
		case 6:
			// Field 6 should NOT be emitted for images to prevent LS crash
			foundForbiddenImageField = true
		case 13:
			mFields := DecodeFields(f.Bytes)
			hasURI := false
			hasInlineData := false
			for _, mField := range mFields {
				if mField.Num == 5 && string(mField.Bytes) == "file:///C:/Users/test/.gemini/antigravity/brain/c1/doc.pdf" {
					hasURI = true
				}
				if mField.Num == 2 && string(mField.Bytes) == "fake_pdf_bytes" {
					hasInlineData = true
				}
			}
			if hasURI && hasInlineData {
				foundNonImageMedia = true
			}
		case 5:
			foundConfig = true
		}
	}

	if !foundCascadeID {
		t.Error("cascade_id (field 1) not found")
	}
	if !foundItems {
		t.Error("items (field 2) with clean text not found")
	}
	if foundForbiddenImageField {
		t.Error("image field 6 should not be present in protobuf to prevent LS unsupported mime type error")
	}
	if !foundNonImageMedia {
		t.Error("non-image media (field 13) not found")
	}
	if !foundConfig {
		t.Error("cascade_config (field 5) not found")
	}
}

func TestBuildRevertToCascadeStep(t *testing.T) {
	cascadeID := "casc-undo-test"
	stepIndex := int64(11)
	apiKey := "test-key"
	sessionID := "sess-1"

	buf := BuildRevertToCascadeStep(cascadeID, stepIndex, apiKey, sessionID, "gemini-flash", 0)
	fields := DecodeFields(buf)

	var foundCascadeID string
	var foundStepIndex int64 = -1
	var foundMetadata bool
	var foundOverrideConfig bool

	for _, f := range fields {
		switch f.Num {
		case 1:
			foundCascadeID = string(f.Bytes)
		case 2:
			foundStepIndex = int64(f.Varint)
		case 3:
			foundMetadata = true
		case 5:
			foundOverrideConfig = true
		}
	}

	if foundCascadeID != cascadeID {
		t.Errorf("field 1 (cascade_id) expected %q, got %q", cascadeID, foundCascadeID)
	}
	if foundStepIndex != stepIndex {
		t.Errorf("field 2 (step_index) expected %d, got %d", stepIndex, foundStepIndex)
	}
	if !foundMetadata {
		t.Errorf("field 3 (metadata) expected to be present")
	}
	if !foundOverrideConfig {
		t.Errorf("field 5 (override_config) expected to be present")
	}
}

func TestBuildGetRevertPreview(t *testing.T) {
	cascadeID := "casc-prev-test"
	stepIndex := int64(5)
	apiKey := "test-key"
	sessionID := "sess-1"

	buf := BuildGetRevertPreview(cascadeID, stepIndex, apiKey, sessionID, "gemini-flash", 0)
	fields := DecodeFields(buf)

	var foundCascadeID string
	var foundStepIndex int64 = -1
	var foundMetadata bool
	var foundOverrideConfig bool

	for _, f := range fields {
		switch f.Num {
		case 1:
			foundCascadeID = string(f.Bytes)
		case 2:
			foundStepIndex = int64(f.Varint)
		case 3:
			foundMetadata = true
		case 4:
			foundOverrideConfig = true
		}
	}

	if foundCascadeID != cascadeID {
		t.Errorf("field 1 (cascade_id) expected %q, got %q", cascadeID, foundCascadeID)
	}
	if foundStepIndex != stepIndex {
		t.Errorf("field 2 (step_index) expected %d, got %d", stepIndex, foundStepIndex)
	}
	if !foundMetadata {
		t.Errorf("field 3 (metadata) expected to be present")
	}
	if !foundOverrideConfig {
		t.Errorf("field 4 (override_config) expected to be present")
	}
}

func TestBuildRevertToCascadeStep_DefaultModel(t *testing.T) {
	buf := BuildRevertToCascadeStep("casc-undo-default", 3, "key", "sess", "", 0)
	fields := DecodeFields(buf)
	var foundOverrideConfig bool
	for _, f := range fields {
		if f.Num == 5 {
			foundOverrideConfig = true
		}
	}
	if !foundOverrideConfig {
		t.Errorf("field 5 (override_config) must be present even when model is empty")
	}
}

func TestBuildGetRevertPreview_DefaultModel(t *testing.T) {
	buf := BuildGetRevertPreview("casc-prev-default", 3, "key", "sess", "", 0)
	fields := DecodeFields(buf)
	var foundOverrideConfig bool
	for _, f := range fields {
		if f.Num == 4 {
			foundOverrideConfig = true
		}
	}
	if !foundOverrideConfig {
		t.Errorf("field 4 (override_config) must be present even when model is empty")
	}
}

