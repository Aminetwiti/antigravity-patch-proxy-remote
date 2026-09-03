//go:build !windows

package notification

import "os/exec"

func hideWindow(_ *exec.Cmd) {}
