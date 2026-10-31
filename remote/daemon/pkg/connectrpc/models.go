package connectrpc

import "encoding/binary"

// ModelInfo résume un modèle disponible, extrait de GetAvailableModelsResponse.
// Les numéros de champs sont vérifiés dans antigravity-client
// (src/gen/exa/google/internal/cloud/code/v1internal/model_configs_pb.ts).
type ModelInfo struct {
	ModelID          string `json:"modelId"`
	DisplayName      string `json:"displayName"`
	Recommended      bool   `json:"recommended"`
	Disabled         bool   `json:"disabled"`
	Beta             bool   `json:"beta"`
	Preview          bool   `json:"preview"`
	SupportsThinking bool   `json:"supportsThinking"`
	SupportsImages   bool   `json:"supportsImages"`
	ThinkingBudget   int    `json:"thinkingBudget,omitempty"`
	MaxOutputTokens  int    `json:"maxOutputTokens,omitempty"`
	Description      string `json:"description,omitempty"`
}

// Structure décodée (source of truth : antigravity-client) :
//
//	GetAvailableModelsResponse { 1: FetchAvailableModelsResponse response }
//	FetchAvailableModelsResponse {
//	  1: repeated ModelsEntry models   // entry = {1: key, 2: ModelDetails value}
//	  2: string default_agent_model_id
//	  ...
//	}
//	ModelDetails {
//	  1: display_name   2: supports_images   3: supports_thinking
//	  4: thinking_budget  6: recommended      8: max_output_tokens
//	  12: beta          13: disabled          14: description
//	  29: tag_title     34: preview
//	}
//
// ParseModels dé-framme la réponse et extrait la liste des modèles en mode
// best-effort : un schéma inconnu ou un payload corrompu retourne (nil, false)
// — jamais une panne ni une erreur fatale (dégradation gracieuse).
func ParseModels(raw []byte) ([]ModelInfo, bool) {
	payload := raw
	// Dé-framming gRPC-Web : flags(1) + longueur BE(4) + payload
	for len(payload) >= 5 {
		length := int(binary.BigEndian.Uint32(payload[1:5]))
		if length <= 0 || 5+length > len(payload) {
			break
		}
		if payload[0]&0x80 == 0 { // frame de données
			return parseModelsFields(DecodeFields(payload[5 : 5+length]))
		}
		payload = payload[5+length:]
	}
	return parseModelsFields(DecodeFields(payload))
}

func parseModelsFields(fields []Field) ([]ModelInfo, bool) {
	for _, f := range fields {
		if f.Num != 1 || f.WireType != 2 {
			continue
		}
		return parseFetchAvailableModels(DecodeFields(f.Bytes))
	}
	return nil, false
}

// parseFetchAvailableModels parcourt les ModelsEntry (champ 1, map key/value).
func parseFetchAvailableModels(fields []Field) ([]ModelInfo, bool) {
	var out []ModelInfo
	ok := false
	for _, f := range fields {
		if f.Num != 1 || f.WireType != 2 {
			continue
		}
		entry := DecodeFields(f.Bytes)
		var key string
		var details []Field
		for _, ef := range entry {
			switch {
			case ef.Num == 1 && ef.WireType == 2:
				key = string(ef.Bytes)
			case ef.Num == 2 && ef.WireType == 2:
				details = DecodeFields(ef.Bytes)
			}
		}
		if key == "" {
			continue
		}
		m := ModelInfo{ModelID: key}
		for _, df := range details {
			switch df.Num {
			case 1:
				if df.WireType == 2 {
					m.DisplayName = string(df.Bytes)
				}
			case 2:
				m.SupportsImages = df.Varint != 0
			case 3:
				m.SupportsThinking = df.Varint != 0
			case 4:
				m.ThinkingBudget = int(df.Varint)
			case 6:
				m.Recommended = df.Varint != 0
			case 8:
				m.MaxOutputTokens = int(df.Varint)
			case 12:
				m.Beta = df.Varint != 0
			case 13:
				m.Disabled = df.Varint != 0
			case 14:
				if df.WireType == 2 {
					m.Description = string(df.Bytes)
				}
			case 34:
				m.Preview = df.Varint != 0
			}
		}
		if m.DisplayName == "" {
			m.DisplayName = key
		}
		out = append(out, m)
		ok = true
	}
	return out, ok
}
