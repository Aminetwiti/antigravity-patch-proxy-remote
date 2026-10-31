//go:build !windows

package workspace

import (
	"syscall"
)

func killOSProcessTree(pid int) {
	pgid, err := syscall.Getpgid(pid)
	if err == nil && pgid > 0 {
		_ = syscall.Kill(-pgid, syscall.SIGKILL)
	}
}
