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

	cascadeID := "456db45a-e6e7-470c-b051-cf97cfae99e5"

	// 1. GetTrajectory
	fmt.Printf("Calling GetCascadeTrajectory for %s...\n", cascadeID)
	trajRaw, err := client.GetCascadeTrajectory(cascadeID, 0)
	fmt.Printf("GetCascadeTrajectory: len=%d, err=%v\n", len(trajRaw), err)
}
