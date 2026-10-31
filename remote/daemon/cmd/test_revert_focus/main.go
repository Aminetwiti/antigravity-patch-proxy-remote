package main

import (
	"fmt"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/discovery"
)

func main() {
	info, err := discovery.Discover()
	if err != nil {
		fmt.Printf("Discover error: %v\n", err)
		return
	}
	token := info.ExtensionCSRF
	if token == "" {
		token = info.CSRFToken
	}
	client := connectrpc.NewClient(info.ConnectRPCPort, token)
	if info.UseTLS {
		client.SetUseTLS(true)
	}

	cascadeID := "436813a3-75ed-4636-86be-f41790fa992c"

	for step := int64(1); step <= 3; step++ {
		prevRaw, errPrev := client.GetRevertPreview(cascadeID, step)
		fmt.Printf("Step %d - Preview: len=%d, err=%v\n", step, len(prevRaw), errPrev)

		errRev := client.RevertToCascadeStep(cascadeID, step)
		fmt.Printf("Step %d - Revert: err=%v\n", step, errRev)
	}
}
