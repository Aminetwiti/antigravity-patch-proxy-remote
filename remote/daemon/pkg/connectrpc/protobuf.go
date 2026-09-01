package connectrpc

import (
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
)

// Encodage protobuf manuel — pas de bibliothèque (règle AGENTS.md).
// Wire format : varint fields (key = (fieldNum << 3) | wireType).
// wireType 0 = varint, 2 = length-delimited.

type writer struct {
	b []byte
}

var writerPool = sync.Pool{
	New: func() interface{} {
		return &writer{b: make([]byte, 0, 256)}
	},
}

func getWriter() *writer {
	w := writerPool.Get().(*writer)
	w.b = w.b[:0]
	return w
}

func putWriter(w *writer) {
	if cap(w.b) <= 65536 {
		writerPool.Put(w)
	}
}


func (w *writer) varint(v uint64) {
	for v >= 0x80 {
		w.b = append(w.b, byte(v)|0x80)
		v >>= 7
	}
	w.b = append(w.b, byte(v))
}

func (w *writer) key(fieldNum, wireType int) {
	w.varint(uint64(fieldNum<<3 | wireType))
}

func (w *writer) varintField(fieldNum int, v uint64) {
	w.key(fieldNum, 0)
	w.varint(v)
}

func (w *writer) stringField(fieldNum int, s string) {
	w.key(fieldNum, 2)
	w.varint(uint64(len(s)))
	w.b = append(w.b, s...)
}

func (w *writer) bytesField(fieldNum int, data []byte) {
	w.key(fieldNum, 2)
	w.varint(uint64(len(data)))
	w.b = append(w.b, data...)
}

// Sources CommandRequestSource (énum exa.codeium_common_pb, décodée du binaire) :
const (
	CommandRequestSourceDefault       = 1
	CommandRequestSourcePlan          = 2
	CommandRequestSourceFastApply     = 3
	CommandRequestSourceTerminal      = 4 // injection slash command depuis le mobile
	CommandRequestSourceSupercomplete = 5
	CommandRequestSourceTabJump       = 6
	CommandRequestSourceCascadeChat   = 7
)

// StartCascadeRequest : field 4 source=1, 5 trajectory_type=1,
// 8 workspace_uris (string), 14 requested_model (varint),
// 15 requested_model_uid (string).
// BuildStartCascade génère un message StartCascadeRequest brut.
// Note cruciale gRPC : Le Language Server refuse la requête avec "cannot specify both workspace URIs and project environment config"
// si field 17 et field 8 sont tous les deux présents. Si projectID != "", on met UNIQUEMENT field 17. Sinon, field 8.
func BuildStartCascade(workspaceURI, projectID, modelUID string, modelEnum uint64) []byte {
	w := &writer{}
	w.varintField(4, 1) // CortexTrajectorySource = 1
	w.varintField(5, 1) // TrajectoryType = 1
	if projectID != "" {
		envW := &writer{}
		envW.stringField(1, projectID)
		envW.bytesField(4, []byte{}) // defaultProjectEnvironment
		w.bytesField(17, envW.b)
	} else if workspaceURI != "" {
		normURI := strings.TrimPrefix(workspaceURI, "file:///")
		normURI = strings.TrimPrefix(normURI, "file://")
		normURI = strings.ReplaceAll(normURI, `\`, `/`)
		normURI = "file:///" + strings.TrimPrefix(normURI, "/")
		w.stringField(8, normURI)
	}
	enum := modelEnum
	if enum == 0 && modelUID != "" {
		enum = ResolveStandardModelEnum(modelUID)
	}
	if enum > 0 {
		w.varintField(14, enum)
	}
	if modelUID != "" {
		w.stringField(15, modelUID)
	}
	return w.b
}

// MediaAttachment represents an attached image or file sent with a user prompt.
type MediaAttachment struct {
	URI         string `json:"uri,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
	Description string `json:"description,omitempty"`
	Base64Data  string `json:"base64Data,omitempty"`
	Data        []byte `json:"-"`
}

func buildMediaItem(m MediaAttachment) []byte {
	mw := &writer{}
	mime := m.MimeType
	if mime == "" {
		mime = "application/octet-stream"
	}
	mw.stringField(1, mime)
	if len(m.Data) > 0 {
		mw.bytesField(2, m.Data)
	} else if m.Base64Data != "" {
		cleanB64 := m.Base64Data
		if idx := strings.Index(cleanB64, ","); idx != -1 {
			cleanB64 = cleanB64[idx+1:]
		}
		if b, err := base64.StdEncoding.DecodeString(cleanB64); err == nil && len(b) > 0 {
			mw.bytesField(2, b)
		}
	}
	if m.Description != "" {
		mw.stringField(4, m.Description)
	}
	if m.URI != "" {
		mw.stringField(5, m.URI)
	}
	return mw.b
}

func buildImageData(m MediaAttachment) []byte {
	iw := &writer{}
	b64 := m.Base64Data
	if b64 == "" && len(m.Data) > 0 {
		b64 = base64.StdEncoding.EncodeToString(m.Data)
	}
	if idx := strings.Index(b64, ","); idx != -1 {
		b64 = b64[idx+1:]
	}
	if b64 != "" {
		iw.stringField(1, b64)
	}
	mime := m.MimeType
	if mime == "" {
		mime = "image/png"
	}
	iw.stringField(2, mime)

	if m.Description != "" {
		iw.stringField(3, m.Description)
	}
	if m.URI != "" {
		iw.stringField(4, m.URI)
	}
	return iw.b
}

// SendUserCascadeMessageRequest : field 1 cascade_id, field 2 items[]
// où chaque item est TextOrScopeItem{ 1: chunk.text }.
//
// NOTE: Les images ne doivent JAMAIS être injectées comme blobs binaires inline
// dans le protobuf (fields 6/14), car le Language Server (processMediaData generation.go:742)
// plante lors du hook de summarisation de contexte ("unsupported mime type image/png").
// Comme dans l'IDE native Antigravity, les images sont sauvegardées sur disque dans .user_uploaded/
// et référencées dans le texte du prompt via le bloc <ADDITIONAL_METADATA>.
func BuildSendMessageWithMedia(cascadeID, text, apiKey, sessionID, modelUID string, modelEnum uint64, media []MediaAttachment, noTools ...bool) []byte {
	item := &writer{}
	item.stringField(1, text)

	w := &writer{}
	w.stringField(1, cascadeID)
	w.bytesField(2, item.b)

	for _, m := range media {
		// N'encoder en protobuf que les pièces non-images (ex: PDF) pour éviter le crash processMediaData du LS
		if !strings.HasPrefix(m.MimeType, "image/") && (m.URI != "" || len(m.Data) > 0 || m.Base64Data != "") {
			w.bytesField(13, buildMediaItem(m))
		}
	}

	if apiKey != "" {
		w.bytesField(3, buildMetadata(apiKey, sessionID))
	}
	w.bytesField(5, BuildCascadeConfig(modelUID, modelEnum, noTools...))

	// Propagation directe du modèle demandé au niveau de la requête SendUserCascadeMessage
	// pour forcer le basculement de modèle sur une session existante.
	effectiveEnum := modelEnum
	if effectiveEnum == 0 && modelUID != "" {
		effectiveEnum = ResolveStandardModelEnum(modelUID)
	}
	if effectiveEnum != 0 {
		w.varintField(4, effectiveEnum)
		w.varintField(14, effectiveEnum)
	}
	if modelUID != "" {
		w.stringField(15, modelUID)
	}
	return w.b
}

// BuildSendMessage construit un SendMessageRequest (sans pièces jointes). noTools force
// planner_mode = 3 (NO_TOOL) dans le cascade_config.
func BuildSendMessage(cascadeID, text, apiKey, sessionID, modelUID string, modelEnum uint64, noTools ...bool) []byte {
	return BuildSendMessageWithMedia(cascadeID, text, apiKey, sessionID, modelUID, modelEnum, nil, noTools...)
}

// DefaultModelEnum : repli quand aucun modèle n'est demandé — enum LS
// GOOGLE_GEMINI_3_7_FLASH (défaut Antigravity 2.0 / haute capacité).
// CONSTANTE UNIQUE partagée entre BuildCascadeConfig (plan_model) et le repli
// create_cascade du gateway : deux littéraux 312/190 auraient divergé.
const DefaultModelEnum uint64 = 312

// ResolveStandardModelEnum résout un nom de modèle (ou displayName ou ID) vers son enum LS officiel.
func ResolveStandardModelEnum(nameOrID string) uint64 {
	lower := strings.ToLower(strings.TrimSpace(nameOrID))
	if lower == "" {
		return 0
	}
	switch {
	case strings.Contains(lower, "3.7-flash") || strings.Contains(lower, "3.6-flash") || strings.Contains(lower, "3.5-flash") || strings.Contains(lower, "gemini-flash"):
		return 312
	case strings.Contains(lower, "3.1-pro") || strings.Contains(lower, "2.5-pro") || strings.Contains(lower, "gemini-pro"):
		return 246
	case strings.Contains(lower, "sonnet") || strings.Contains(lower, "claude-3-7") || strings.Contains(lower, "claude-3.7") || strings.Contains(lower, "claude-3-5"):
		return 384
	case strings.Contains(lower, "haiku"):
		return 394
	case strings.Contains(lower, "opus"):
		return 393
	case strings.Contains(lower, "gpt-4o-mini") || strings.Contains(lower, "4o-mini"):
		return 281
	case strings.Contains(lower, "gpt-4o") || strings.Contains(lower, "4o"):
		return 280
	case strings.Contains(lower, "o3-mini"):
		return 395
	case strings.Contains(lower, "o1-mini"):
		return 368
	case strings.Contains(lower, "o1"):
		return 367
	case strings.Contains(lower, "deepseek-r1") || strings.Contains(lower, "r1"):
		return 401
	case strings.Contains(lower, "deepseek-v3") || strings.Contains(lower, "v3"):
		return 400
	case strings.Contains(lower, "qwen"):
		return 450
	case strings.Contains(lower, "grok"):
		return 460
	default:
		return 0
	}
}

// BuildCascadeConfig construit le sous-message cascade_config.
//
// Format validé contre le vrai Language Server 2.8.0 :
//
//	CascadeConfig {
//	  1: planner_config (CascadePlannerConfig) {
//	    1: plan_model (enum, ex: 246 = GOOGLE_GEMINI_2_5_PRO)
//	    2: conversational_config {1: planner_mode}
//	    8: last_selected_model_name (string)
//	    15: requested_model (ModelOrAlias {1: model, 3: model_name})
//	    28: model_name (string, ex: "claude-sonnet-4.6-thinking" ou custom model UID)
//	    30: last_selected_cascade_model_or_alias (ModelOrAlias)
//	    46: last_model_override (enum)
//	  }
//	  4: requested_model_id (enum)
//	  14: requested_model (enum)
//	  15: requested_model_uid (string)
//	  28: model_name (string)
//	}

//
// planner_mode 3 = NO_TOOL (pas de boucle d'outils — le mobile ne voit
// que le texte). requested_model (15) et plan_model (1) contrôlent le modèle du tour.
func BuildCascadeConfig(modelUID string, modelEnum uint64, noTools ...bool) []byte {
	planner := &writer{}

	// plan_model (field 1) : même valeur que requested_model ci-dessous.
	// Le LS l'exige explicitement (« neither PlanModel nor RequestedModel »).
	effectiveEnum := modelEnum
	if effectiveEnum == 0 && modelUID != "" {
		effectiveEnum = ResolveStandardModelEnum(modelUID)
	}
	if effectiveEnum == 0 {
		effectiveEnum = DefaultModelEnum
	}
	planner.varintField(1, effectiveEnum)

	// conversational_config (field 2) {1: planner_mode} :
	// 3 = NO_TOOL (pas de boucle d'outils — le mobile ne voit que le texte),
	// sinon 1 = AUTO (boucle d'outils par défaut du LS).
	mode := uint64(1) // AUTO
	if len(noTools) > 0 && noTools[0] {
		mode = 3 // NO_TOOL
	}
	conv := &writer{}
	conv.varintField(1, mode)
	planner.bytesField(2, conv.b)

	// requested_model (field 15) = ModelOrAlias {1: model, 3: model_name}.
	// Si un modèle explicite (UID ou enum) est fourni, on transmet l'enum demandé ainsi que son nom/UID.
	// Si AUCUN modèle n'est spécifié (modelUID == "" && modelEnum == 0), on retombe sur
	// ModelOrAlias.alias = CASCADE_BASE (1) pour hériter du modèle initial de la cascade.
	reqModel := &writer{}
	if modelEnum != 0 || modelUID != "" {
		reqModel.varintField(1, effectiveEnum)
		if modelUID != "" {
			reqModel.stringField(3, modelUID)
		}
	} else {
		reqModel.varintField(2, 1)
	}
	planner.bytesField(15, reqModel.b)

	if modelUID != "" {
		planner.stringField(28, modelUID)
		planner.stringField(8, modelUID)
		planner.bytesField(30, reqModel.b)
	}
	if effectiveEnum != 0 && effectiveEnum != DefaultModelEnum {
		planner.varintField(46, effectiveEnum)
	}

	w := &writer{}
	w.bytesField(1, planner.b)
	if modelUID != "" {
		w.stringField(15, modelUID)
		w.stringField(28, modelUID)
	}
	if effectiveEnum != 0 {
		w.varintField(14, effectiveEnum)
		w.varintField(4, effectiveEnum)
	}
	return w.b
}

// HandleStreamingCommandRequest (champs validés par décodage du DescriptorProto
// réel dans language_server.exe, offset 47540541) :
//
//	1 metadata (Metadata)   2 document (Document)   3 editor_options
//	4 requested_model_id    5 experiment_config    6 selection_start_line
//	7 selection_end_line    8 command_text          9 request_source
//	10 mentioned_scope      11 action_pointer      12 parent_completion_id
//	13 diff_type            14 diagnostics         15 supercomplete_trigger_condition
//	16 terminal_command_data 17 ignore_supercomplete_debounce
//	18 clipboard_entry      19 intellisense_suggestions
//
// BuildHandleStreamingCommand construit une demande de commande minimale
// (source = Terminal, comme si la commande venait du terminal IDE) pour
// router une slash commande vers le Language Server sans passer par le chat.
func BuildHandleStreamingCommand(commandText string, source uint64) []byte {
	w := &writer{}
	w.stringField(8, commandText)
	w.varintField(9, source)
	return w.b
}

// Champs oneof de CascadeUserInteraction (vérifiés dans cortex.proto et language_server binary).
const (
	InteractionDeploy            = 4   // CascadeDeployInteraction
	InteractionRunCommand        = 5   // CascadeRunCommandInteraction
	InteractionOpenBrowserURL    = 6   // CascadeOpenBrowserUrlInteraction
	InteractionRunExtensionCode  = 7   // CascadeRunExtensionCodeInteraction
	InteractionExecuteBrowserJS  = 8   // CascadeExecuteBrowserJavaScriptInteraction
	InteractionCaptureScreenshot = 9   // CascadeCaptureBrowserScreenshotInteraction
	InteractionClickPixel        = 10  // CascadeClickBrowserPixelInteraction
	InteractionBrowserAction     = 13  // CascadeBrowserActionInteraction
	InteractionOpenBrowserSetup  = 14  // CascadeOpenBrowserSetupInteraction
	InteractionConfirmBrowserSetup = 15 // CascadeConfirmBrowserSetupInteraction
	InteractionSendCommandInput  = 16  // CascadeSendCommandInputInteraction
	InteractionReadUrlContent    = 17  // CascadeReadUrlContentInteraction
	InteractionMcp               = 18  // CascadeMcpInteraction
	InteractionFilePermission    = 19  // FilePermissionInteraction
	InteractionElicitation       = 20  // ElicitationInteraction
	InteractionPermission        = 21  // PermissionInteraction
	InteractionAskQuestion       = 22  // AskQuestionInteraction
	InteractionApproval          = 23  // ApprovalInteraction
	InteractionDeleteDirectory   = 105 // CascadeDeleteDirectoryInteraction (legacy)
	InteractionInvokeSubagent    = 143 // CascadeInvokeSubagentInteraction (legacy)
	InteractionCloudSQL          = 153 // CascadeCloudSqlInteraction (legacy)
)

// Valeurs enum PermissionScope (cortex_pb)
const (
	PermissionScopeUnspecified  uint64 = 0
	PermissionScopeOnce         uint64 = 1
	PermissionScopeConversation uint64 = 2
	PermissionScopeWorkspace    uint64 = 3
	PermissionScopeGlobal       uint64 = 4
	PermissionScopeProject      uint64 = 5
)

// BuildRunCommandInteraction : {1: confirm, 2: proposed, 3: submitted}.
func BuildRunCommandInteraction(confirm bool, proposed, submitted string) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(confirm))
	w.stringField(2, proposed)
	if submitted != "" {
		w.stringField(3, submitted)
	}
	return w.b
}

// BuildReadUrlContentInteraction : {1: confirm}.
func BuildReadUrlContentInteraction(confirm bool) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(confirm))
	return w.b
}

// BuildOpenBrowserUrlInteraction : {1: confirm}.
func BuildOpenBrowserUrlInteraction(confirm bool) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(confirm))
	return w.b
}

// BuildPermissionInteraction : {1: allow, 2: scope, 6: edited_target}.
func BuildPermissionInteraction(allow bool, scope uint64, pathOrURL ...string) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(allow))
	if scope != 0 {
		w.varintField(2, scope)
	}
	if len(pathOrURL) > 0 && pathOrURL[0] != "" {
		w.stringField(6, pathOrURL[0])
	}
	return w.b
}

// BuildFilePermissionInteraction : {1: allow, 2: scope, 3: absolute_path_uri}.
func BuildFilePermissionInteraction(allow bool, scope uint64, pathURI string) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(allow))
	if scope != 0 {
		w.varintField(2, scope)
	}
	if pathURI != "" {
		w.stringField(3, pathURI)
	}
	return w.b
}

// BuildSendCommandInputInteraction : {1: confirm}.
func BuildSendCommandInputInteraction(input string, endOfInput bool) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(!endOfInput))
	return w.b
}

// BuildMcpInteraction : {1: confirm}.
func BuildMcpInteraction(confirm bool, serverName, toolName, argumentsJson string) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(confirm))
	return w.b
}

// BuildDeployInteraction : {1: cancel, 3: subdomain}.
func BuildDeployInteraction(confirm bool, targetEnv string) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(!confirm)) // 1: cancel (bool)
	if targetEnv != "" {
		w.stringField(3, targetEnv) // 3: subdomain (string)
	}
	return w.b
}

// BuildSubagentSpawnInteraction : {1: confirm, 2: subagent_types}.
func BuildSubagentSpawnInteraction(confirm bool, subagentTypes ...string) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(confirm))
	for _, st := range subagentTypes {
		if st != "" {
			w.stringField(2, st)
		}
	}
	return w.b
}

// BuildAskQuestionInteraction encode la réponse à un questionnaire interactif
// (AskQuestionInteraction tag 22 dans CascadeUserInteraction).
// responses (1) -> AskQuestionEntry { selected_option_ids (4), write_in_response (5), skipped (6) }, cancelled (2).
func BuildAskQuestionInteraction(selectedIDs []string, writeInResponse string, cancelled bool) []byte {
	w := &writer{}
	entry := &writer{}
	for _, id := range selectedIDs {
		entry.stringField(4, id)
	}
	if writeInResponse != "" {
		entry.stringField(5, writeInResponse)
	}
	if cancelled {
		entry.varintField(6, 1)
	}
	w.bytesField(1, entry.b)
	if cancelled {
		w.varintField(2, 1)
	}
	return w.b
}

// BuildApprovalInteraction : {1: confirm} — fallback générique.
func BuildApprovalInteraction(confirm bool) []byte {
	w := &writer{}
	w.varintField(1, boolToUint64(confirm))
	return w.b
}

// BuildHandleCascadeUserInteraction construit le payload de
// HandleCascadeUserInteractionRequest : {1: cascade_id, 2: interaction}
// où interaction = {1: trajectory_id, 2: step_index, <oneofField>: oneofPayload}.
func BuildHandleCascadeUserInteraction(cascadeID, trajectoryID string, stepIndex uint32, oneofField int, oneofPayload []byte) []byte {
	interaction := &writer{}
	interaction.stringField(1, trajectoryID)
	interaction.varintField(2, uint64(stepIndex))
	interaction.bytesField(oneofField, oneofPayload)

	w := &writer{}
	w.stringField(1, cascadeID)
	w.bytesField(2, interaction.b)
	return w.b
}

func boolToUint64(b bool) uint64 {
	if b {
		return 1
	}
	return 0
}

// DecodeFields extrait les champs de premier niveau d'un message protobuf.
func DecodeFields(buf []byte) []Field {
	var fields []Field
	offset := 0
	for offset < len(buf) {
		key, n := readVarint(buf, offset)
		offset = n
		fieldNum := int(key >> 3)
		wireType := int(key & 7)
		switch wireType {
		case 0:
			v, n := readVarint(buf, offset)
			fields = append(fields, Field{Num: fieldNum, WireType: wireType, Varint: v})
			offset = n
		case 2:
			length, n := readVarint(buf, offset)
			offset = n
			if offset+int(length) > len(buf) {
				fields = append(fields, Field{Num: fieldNum, WireType: wireType, Bytes: buf[offset:]})
				offset = len(buf)
			} else {
				fields = append(fields, Field{Num: fieldNum, WireType: wireType, Bytes: buf[offset : offset+int(length)]})
				offset += int(length)
			}
		default:
			fields = append(fields, Field{Num: fieldNum, WireType: wireType, Bytes: buf[offset:]})
			offset = len(buf)
		}
	}
	return fields
}

type Field struct {
	Num      int
	WireType int
	Varint   uint64
	Bytes    []byte
}

func (f Field) String() string {
	if f.WireType == 0 {
		return fmt.Sprintf("#%d:%d=%d", f.Num, f.WireType, f.Varint)
	}
	return fmt.Sprintf("#%d:%d=%dB", f.Num, f.WireType, len(f.Bytes))
}

func readVarint(buf []byte, offset int) (uint64, int) {
	var result uint64
	var shift uint
	for offset < len(buf) {
		b := buf[offset]
		result |= uint64(b&0x7f) << shift
		offset++
		if b&0x80 == 0 {
			break
		}
		shift += 7
		if shift > 63 {
			break
		}
	}
	return result, offset
}

// BuildSetBrowserOpenConversation construit un message SetBrowserOpenConversationRequest
// pour forcer l'IDE Antigravity à ouvrir et afficher une cascade spécifique.
func BuildSetBrowserOpenConversation(cascadeID string) []byte {
	w := &writer{}
	w.stringField(1, cascadeID)
	return w.b
}

// BuildDeleteCascadeTrajectory construit un DeleteCascadeTrajectoryRequest :
// {1: cascade_id} — schéma vérifié dans antigravity-client
// (src/gen/exa/language_server_pb/language_server_pb.ts, ligne 11572).
func BuildDeleteCascadeTrajectory(cascadeID string) []byte {
	w := &writer{}
	w.stringField(1, cascadeID)
	return w.b
}

// BuildReadFileRequest construit un ReadFileRequest : {1: uri} — schéma
// vérifié dans antigravity-client (ligne 15483).
func BuildReadFileRequest(uri string) []byte {
	w := &writer{}
	w.stringField(1, uri)
	return w.b
}

// ParseReadFileResponse extrait le contenu du fichier (champ 1, bytes) d'un
// ReadFileResponse protobuf retourné par le Language Server.
func ParseReadFileResponse(buf []byte) []byte {
	for _, f := range DecodeFields(buf) {
		if f.Num == 1 && f.WireType == 2 {
			return f.Bytes
		}
	}
	return buf
}

// BuildWriteFileRequest construit un WriteFileRequest :
// {1: uri, 2: content (bytes), 3: overwrite (bool)} — schéma vérifié dans
// antigravity-client (ligne 15631).
func BuildWriteFileRequest(uri string, content []byte, overwrite bool) []byte {
	w := &writer{}
	w.stringField(1, uri)
	w.bytesField(2, content)
	if overwrite {
		w.varintField(3, 1)
	}
	return w.b
}

// BuildStatUriRequest construit un StatUriRequest : {1: uri} — schéma vérifié
// dans antigravity-client (ligne 15397).
func BuildStatUriRequest(uri string) []byte {
	w := &writer{}
	w.stringField(1, uri)
	return w.b
}

// BuildTrackWorkspace construit un AddTrackedWorkspaceRequest :
// {1: workspace (chemin brut, séparateurs '/'), 2: do_not_watch_files} —
// schéma vérifié dans antigravity-client (language_server_pb.ts ligne 4425).
// do_not_watch_files=true : le file-watcher LS est inutile pour un accès
// distant et coûte des ressources. is_passive_workspace (3) reste à false.
func BuildTrackWorkspace(workspacePath string) []byte {
	w := &writer{}
	w.stringField(1, workspacePath)
	w.varintField(2, 1)
	return w.b
}

// Verbosités ClientTrajectoryVerbosity (enum exa.language_server_pb,
// language_server_pb.ts ligne 257) — 0 = UNSPECIFIED, 1 = DEBUG,
// 2 = PROD_UI, 3 = FULL. 3 est demandé par défaut (vue structurée complète).
const (
	TrajectoryVerbosityUnspecified = 0
	TrajectoryVerbosityDebug       = 1
	TrajectoryVerbosityProdUI      = 2
	TrajectoryVerbosityFull        = 3
)

// BuildGetCascadeTrajectory construit un GetCascadeTrajectoryRequest :
// {1: cascade_id, 2: verbosity, 3: trajectory_verbosity} — schéma vérifié
// dans antigravity-client (language_server_pb.ts ligne 8711).
// verbosity=0 (UNSPECIFIED) → champ omis (le LS applique son défaut).
func BuildGetCascadeTrajectory(cascadeID string, verbosity uint64) []byte {
	w := &writer{}
	w.stringField(1, cascadeID)
	if verbosity != 0 {
		w.varintField(2, verbosity)
		w.varintField(3, verbosity)
	}
	return w.b
}

// BuildGetTurnDiff construit un GetTurnDiffRequest :
// {1: conversation_id, 2: step_index} — schéma vérifié dans
// antigravity-client (language_server_pb.ts ligne 7779).
// step_index < 0 → champ omis (le LS résout le dernier tour).
func BuildGetTurnDiff(conversationID string, stepIndex int64) []byte {
	w := &writer{}
	w.stringField(1, conversationID)
	if stepIndex >= 0 {
		w.varintField(2, uint64(stepIndex))
	}
	return w.b
}

// BuildGetRevertPreview construit un GetRevertPreviewRequest :
// {1: cascade_id, 2: step_index, 3: metadata, 4: override_config}
func BuildGetRevertPreview(cascadeID string, stepIndex int64, apiKey, sessionID string, modelUID string, modelEnum uint64) []byte {
	w := &writer{}
	w.stringField(1, cascadeID)
	if stepIndex >= 0 {
		w.varintField(2, uint64(stepIndex))
	}
	if apiKey != "" {
		w.bytesField(3, buildMetadata(apiKey, sessionID))
	}
	w.bytesField(4, BuildCascadeConfig(modelUID, modelEnum))
	return w.b
}

// BuildRevertToCascadeStep construit un RevertToCascadeStepRequest :
// {1: cascade_id, 2: step_index, 3: metadata, 5: override_config}
func BuildRevertToCascadeStep(cascadeID string, stepIndex int64, apiKey, sessionID string, modelUID string, modelEnum uint64) []byte {
	w := &writer{}
	w.stringField(1, cascadeID)
	if stepIndex >= 0 {
		w.varintField(2, uint64(stepIndex))
	}
	if apiKey != "" {
		w.bytesField(3, buildMetadata(apiKey, sessionID))
	}
	w.bytesField(5, BuildCascadeConfig(modelUID, modelEnum))
	return w.b
}

// BuildSendStepsToBackground construit un SendStepsToBackgroundRequest :
// {1: conversation_id, 2: repeated step_indices}
func BuildSendStepsToBackground(conversationID string, stepIndices []int64) []byte {
	w := &writer{}
	w.stringField(1, conversationID)
	for _, idx := range stepIndices {
		if idx >= 0 {
			w.varintField(2, uint64(idx))
		}
	}
	return w.b
}

// BuildSkipBrowserSubagent construit un SkipBrowserSubagentRequest :
// {1: cascade_id, 2: step_index}
func BuildSkipBrowserSubagent(cascadeID string, stepIndex int64) []byte {
	w := &writer{}
	w.stringField(1, cascadeID)
	if stepIndex >= 0 {
		w.varintField(2, uint64(stepIndex))
	}
	return w.b
}

// BuildRetrieveUserQuotaSummary construit un RetrieveUserQuotaSummaryRequest :
// {1: metadata, 2: force_refresh=true}
// Le champ 2 (force_refresh varint 1) force le LS à recalculer le quota au lieu
// de renvoyer son cache — même payload que le projet Antigravity-Chinese
// ([0,0,0,0,2,16,1] = frame vide + field 2 varint 1).
func BuildRetrieveUserQuotaSummary(apiKey, sessionID string) []byte {
	w := &writer{}
	if apiKey != "" {
		w.bytesField(1, buildMetadata(apiKey, sessionID))
	}
	w.varintField(2, 1)
	return w.b
}

// --- RPC Git officiels (exa.language_server_pb) ---

// BuildGetVersionControlState construit un GetVersionControlStateRequest :
// {1: workspace_path} — schéma language_server.proto (ligne 2942).
// Le LS travaille en chemins natifs (pas d'URI) pour le VCS.
func BuildGetVersionControlState(workspacePath string) []byte {
	w := &writer{}
	w.stringField(1, workspacePath)
	return w.b
}

// BuildGitStage construit un GitStageRequest :
// {1: workspace_uri, 2: repeated uris} — schéma language_server.proto (ligne 3089).
func BuildGitStage(workspaceURI string, uris []string) []byte {
	w := &writer{}
	w.stringField(1, workspaceURI)
	for _, u := range uris {
		w.stringField(2, u)
	}
	return w.b
}

// BuildGitUnstage construit un GitUnstageRequest (même schéma que Stage).
func BuildGitUnstage(workspaceURI string, uris []string) []byte {
	return BuildGitStage(workspaceURI, uris)
}

// BuildGitCommit construit un GitCommitRequest :
// {1: workspace_uri, 2: message} — schéma language_server.proto (ligne 3110).
func BuildGitCommit(workspaceURI, message string) []byte {
	w := &writer{}
	w.stringField(1, workspaceURI)
	w.stringField(2, message)
	return w.b
}

// BuildGitDiscard construit un GitDiscardRequest (même schéma que Stage).
func BuildGitDiscard(workspaceURI string, uris []string) []byte {
	return BuildGitStage(workspaceURI, uris)
}

// BuildGetCommitDetails construit un GetCommitDetailsRequest :
// {1: workspace_uri, 2: commit_id} — schéma language_server.proto (ligne 3030).
func BuildGetCommitDetails(workspaceURI, commitID string) []byte {
	w := &writer{}
	w.stringField(1, workspaceURI)
	w.stringField(2, commitID)
	return w.b
}

// --- RPC Sidecar officiels (exa.cascade_plugins_pb) ---

// BuildListSidecarLogFiles construit un ListSidecarLogFilesRequest :
// {1: sidecar_id} — schéma cascade_plugins.proto.
func BuildListSidecarLogFiles(sidecarID string) []byte {
	w := &writer{}
	w.stringField(1, sidecarID)
	return w.b
}

// BuildGetSidecarLogs construit un GetSidecarLogsRequest :
// {1: sidecar_id, 2: tail_lines, 3: log_filename} — schéma cascade_plugins.proto.
func BuildGetSidecarLogs(sidecarID, logFileName string, tailLines ...int32) []byte {
	w := &writer{}
	w.stringField(1, sidecarID)
	if len(tailLines) > 0 && tailLines[0] > 0 {
		w.varintField(2, uint64(tailLines[0]))
	}
	if logFileName != "" {
		w.stringField(3, logFileName)
	}
	return w.b
}

// BuildManageSidecar construit un ManageSidecarRequest :
// {1: sidecar_id, 2: action, 3: config} — schéma cascade_plugins.proto.
// action : 1=start, 2=stop, 3=restart, 4=remove.
func BuildManageSidecar(sidecarID string, action uint64) []byte {
	w := &writer{}
	w.stringField(1, sidecarID)
	w.varintField(2, action)
	return w.b
}

// --- RPC Colosseum / Battle Mode (exa.language_server_pb) ---

// BuildStartBattleMode construit un StartBattleModeRequest :
// {1: request (SendUserCascadeMessageRequest), 2: num_forks, 3: models (repeated enum)}.
func BuildStartBattleMode(workspaceURI, prompt, modelUIDA string, modelEnumA uint64, modelUIDB string, modelEnumB uint64) []byte {
	userMsg := &writer{}
	if prompt != "" {
		item := &writer{}
		item.stringField(1, prompt)
		userMsg.bytesField(2, item.b)
	}

	w := &writer{}
	w.bytesField(1, userMsg.b)
	w.varintField(2, 2) // num_forks = 2

	enumA := modelEnumA
	if enumA == 0 && modelUIDA != "" {
		enumA = ResolveStandardModelEnum(modelUIDA)
	}
	if enumA > 0 {
		w.varintField(3, enumA)
	}

	enumB := modelEnumB
	if enumB == 0 && modelUIDB != "" {
		enumB = ResolveStandardModelEnum(modelUIDB)
	}
	if enumB > 0 {
		w.varintField(3, enumB)
	}
	return w.b
}

// BuildGetBattleWorktreeDiff construit un GetBattleWorktreeDiffRequest :
// {1: arm_workspace_uri, 2: parent_workspace_uri}.
func BuildGetBattleWorktreeDiff(workspaceURI string, parentWorkspaceURI ...string) []byte {
	w := &writer{}
	w.stringField(1, workspaceURI)
	if len(parentWorkspaceURI) > 0 && parentWorkspaceURI[0] != "" {
		w.stringField(2, parentWorkspaceURI[0])
	}
	return w.b
}

// BuildEliminateBattleModeArm construit un EliminateBattleModeArmRequest :
// {1: source_conversation_id, 2: eliminated_conversation_id}.
func BuildEliminateBattleModeArm(armID string, sourceConversationID ...string) []byte {
	w := &writer{}
	sourceID := ""
	if len(sourceConversationID) > 0 {
		sourceID = sourceConversationID[0]
	}
	if sourceID != "" {
		w.stringField(1, sourceID)
		w.stringField(2, armID)
	} else {
		w.stringField(1, armID)
		w.stringField(2, armID)
	}
	return w.b
}

// BuildEndBattleMode construit un EndBattleModeRequest :
// {1: winner_conversation_id, 2: merge_strategy, 3: end_type, 4: source_conversation_id}.
// mergeStrategy : 1=OVERWRITE, 2=SAFE_MERGE, 3=MERGE_WITH_CONFLICTS.
func BuildEndBattleMode(winningArmID string, mergeStrategy uint64, sourceConversationID ...string) []byte {
	w := &writer{}
	w.stringField(1, winningArmID)
	if mergeStrategy > 0 {
		w.varintField(2, mergeStrategy)
	}
	w.varintField(3, 1) // default end_type = 1
	if len(sourceConversationID) > 0 && sourceConversationID[0] != "" {
		w.stringField(4, sourceConversationID[0])
	}
	return w.b
}

// --- RPC Diagnostics & FlightRecorder ---

// BuildDumpFlightRecorder construit un DumpFlightRecorderRequest (vide {}).
func BuildDumpFlightRecorder() []byte {
	return []byte{}
}

// --- RPC MCP Lifecycle & OAuth (exa.language_server_pb) ---

// BuildRefreshMcpServers construit un RefreshMcpServersRequest (vide {}).
func BuildRefreshMcpServers() []byte {
	return []byte{}
}

// BuildCompleteMcpOAuth construit un CompleteMcpOAuthRequest :
// {1: server_id, 2: auth_code}.
func BuildCompleteMcpOAuth(serverID, authCode string) []byte {
	w := &writer{}
	w.stringField(1, serverID)
	w.stringField(2, authCode)
	return w.b
}

// BuildDisconnectMcpOAuth construit un DisconnectMcpOAuthRequest :
// {1: server_id}.
func BuildDisconnectMcpOAuth(serverID string) []byte {
	w := &writer{}
	w.stringField(1, serverID)
	return w.b
}

// --- Code Index & RAG (exa.code_index_pb) ---

// BuildHybridSearch construit un HybridSearchRequest :
// {1: query, 2: workspace_uri, 3: limit}.
func BuildHybridSearch(query, workspaceURI string, limit uint32) []byte {
	w := &writer{}
	w.stringField(1, query)
	if workspaceURI != "" {
		w.stringField(2, workspaceURI)
	}
	if limit > 0 {
		w.varintField(3, uint64(limit))
	}
	return w.b
}

// BuildSearchCode construit un SearchCodeRequest :
// {1: query, 2: workspace_uri, 3: max_results, 4: lines_context} — schéma language_server.proto.
func BuildSearchCode(query, workspaceURI string, maxResults, linesContext int32) []byte {
	w := &writer{}
	w.stringField(1, query)
	if workspaceURI != "" {
		w.stringField(2, workspaceURI)
	}
	if maxResults > 0 {
		w.varintField(3, uint64(maxResults))
	}
	if linesContext > 0 {
		w.varintField(4, uint64(linesContext))
	}
	return w.b
}

// BuildCheckoutWorktree construit un CheckoutWorktreeRequest :
// {1: worktree_dir_uri, 2: target_workspace_uri, 3: delete_worktree_after_checkout, 4: merge_strategy}.
func BuildCheckoutWorktree(worktreeDirURI, targetWorkspaceURI string, deleteAfterCheckout bool, mergeStrategy uint64) []byte {
	w := &writer{}
	w.stringField(1, worktreeDirURI)
	if targetWorkspaceURI != "" {
		w.stringField(2, targetWorkspaceURI)
	}
	if deleteAfterCheckout {
		w.varintField(3, 1)
	}
	if mergeStrategy > 0 {
		w.varintField(4, mergeStrategy)
	}
	return w.b
}

// BuildCancelCascadeInvocation construit un CancelCascadeInvocationRequest protobuf :
// field 1 = cascade_id (string)
// field 2 = kill_background_tasks (bool/varint)
// field 3 = notify_parent (bool/varint)
func BuildCancelCascadeInvocation(cascadeID string, killBackgroundTasks bool) []byte {
	w := getWriter()
	defer putWriter(w)
	if cascadeID != "" {
		w.stringField(1, cascadeID)
	}
	if killBackgroundTasks {
		w.varintField(2, 1)
	}
	w.varintField(3, 1)
	res := make([]byte, len(w.b))
	copy(res, w.b)
	return res
}

// BuildForceStopCascadeTree construit un ForceStopCascadeTreeRequest protobuf :
// field 1 = conversation_id (string)
func BuildForceStopCascadeTree(conversationID string) []byte {
	w := getWriter()
	defer putWriter(w)
	if conversationID != "" {
		w.stringField(1, conversationID)
	}
	res := make([]byte, len(w.b))
	copy(res, w.b)
	return res
}

// BuildCancelCascadeSteps construit un CancelCascadeStepsRequest protobuf :
// field 1 = cascade_id (string)
// field 2 = step_indices (repeated uint32)
func BuildCancelCascadeSteps(cascadeID string, stepIndices []uint32) []byte {
	w := getWriter()
	defer putWriter(w)
	if cascadeID != "" {
		w.stringField(1, cascadeID)
	}
	for _, idx := range stepIndices {
		w.varintField(2, uint64(idx))
	}
	res := make([]byte, len(w.b))
	copy(res, w.b)
	return res
}


