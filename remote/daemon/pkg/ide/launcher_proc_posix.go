//go:build !windows

package ide

import (
	"os/exec"
	"syscall"
)

func setDetachedProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}
}
