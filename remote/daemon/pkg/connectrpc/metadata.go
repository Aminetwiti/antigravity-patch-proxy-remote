package connectrpc

import ()

// buildMetadata construit le sous-message Metadata (champs validés par le
// DescriptorProto réel du LS 2.5.0) :
//
//	1  ide_name            2  extension_version   3  api_key
//	4  locale              5  os                  7  ide_version
//	8  hardware            9  request_id (uint64) 10 session_id
//	12 extension_name      21 user_jwt
//
// Le champ 3 (api_key) doit être présent : sans lui, le LS rejette
// StartCascade avec `untrusted workspace` / `api key missing`.
// Le champ 10 (session_id) doit être stable sur toute la session.
func buildMetadata(apiKey, sessionID string) []byte {
	w := &writer{}
	w.stringField(1, "Antigravity")
	w.stringField(2, "2.5.0")
	w.stringField(3, apiKey)
	w.stringField(7, "2.5.0")
	w.stringField(8, "x86_64")
	w.stringField(12, "antigravity.remote")
	if sessionID != "" {
		w.stringField(10, sessionID)
	}
	return w.b
}
