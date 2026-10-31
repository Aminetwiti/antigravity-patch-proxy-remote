//go:build windows

package workspace

import (
	"os/exec"
	"strconv"
)

func killOSProcessTree(pid int) {
	_ = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid)).Run()
}
