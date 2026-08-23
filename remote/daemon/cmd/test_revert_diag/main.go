package main

import (
	"fmt"
	"os"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/discovery"
)

func main() {
	info, err := discovery.Discover()
	if err != nil {
		fmt.Printf("Discover error: %v\n", err)
		os.Exit(1)
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

	// 1. GetTrajectory
	trajRaw, err := client.GetCascadeTrajectory(cascadeID, 0)
	fmt.Printf("GetCascadeTrajectory: len=%d, err=%v\n", len(trajRaw), err)

	// 2. Test GetRevertPreview for stepIndex 0, 1, 2, etc.
	for step := int64(0); step <= 3; step++ {
		prevRaw, err := client.GetRevertPreview(cascadeID, step)
		fmt.Printf("GetRevertPreview(step=%d): len=%d, err=%v, raw_hex=%x\n", step, len(prevRaw), err, prevRaw)
	}

	// 3. Test RevertToCascadeStep for stepIndex 0, 1, 2
	for step := int64(0); step <= 2; step++ {
		err := client.RevertToCascadeStep(cascadeID, step)
		fmt.Printf("RevertToCascadeStep(step=%d): err=%v\n", step, err)
	}
}
