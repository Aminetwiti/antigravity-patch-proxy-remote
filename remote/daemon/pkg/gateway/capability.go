package gateway

type ServerCapabilities struct {
	CanRollback            bool     `json:"canRollback"`
	CanUploadChunked       bool     `json:"canUploadChunked"`
	CanBattle              bool     `json:"canBattle"`
	CanPTY                 bool     `json:"canPty"`
	CanADB                 bool     `json:"canAdb"`
	SupportedSlashCommands []string `json:"supportedSlashCommands"`
	ProtocolVersion        int      `json:"protocolVersion"`
}

func DefaultCapabilities() ServerCapabilities {
	return ServerCapabilities{
		CanRollback:      true,
		CanUploadChunked: true,
		CanBattle:        true,
		CanPTY:           true,
		CanADB:           true,
		SupportedSlashCommands: []string{
			"/btw",
			"/grill-me",
			"/teamwork-preview",
			"/goal",
			"/learn",
			"/schedule",
		},
		ProtocolVersion: 2,
	}
}
