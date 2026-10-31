// trajdbg : affiche les résumés de trajectoires extraits par ParseTrajectories.
package main

import (
	"fmt"
	"os"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

func main() {
	raw, err := os.ReadFile("pkg/connectrpc/testdata/hub_trajectories.bin")
	if err != nil {
		fmt.Println("read:", err)
		os.Exit(1)
	}
	for _, s := range connectrpc.ParseTrajectories(raw) {
		fmt.Printf("%s | %-45q | %-22s | %s\n", s.CascadeID, s.Title, s.Status, s.Workspace)
	}
}
