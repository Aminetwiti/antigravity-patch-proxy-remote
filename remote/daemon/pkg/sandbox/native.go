package sandbox

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// NativeSandbox executes commands directly on the host OS confined to the workspace directory.
type NativeSandbox struct{}

func NewNativeSandbox() *NativeSandbox {
	return &NativeSandbox{}
}

func (s *NativeSandbox) Name() string {
	return "native"
}

func (s *NativeSandbox) IsAvailable() bool {
	return true
}

func (s *NativeSandbox) Execute(ctx context.Context, req ExecutionRequest, onChunk func(chunk []byte)) (*ExecutionResult, error) {
	timeout := req.Timeout
	if timeout <= 0 {
		timeout = 120 * time.Second
	}

	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(execCtx, "cmd.exe", "/c", req.CommandLine)
	} else {
		cmd = exec.CommandContext(execCtx, "sh", "-c", req.CommandLine)
	}

	if req.Directory != "" {
		cmd.Dir = req.Directory
	}
	if len(req.Env) > 0 {
		cmd.Env = append(cmd.Environ(), req.Env...)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open stderr pipe: %w", err)
	}

	start := time.Now()
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start command: %w", err)
	}

	var outputBuf strings.Builder
	var mu sync.Mutex

	streamReader := func(r io.Reader) {
		buf := make([]byte, 1024)
		for {
			n, readErr := r.Read(buf)
			if n > 0 {
				chunk := buf[:n]
				mu.Lock()
				outputBuf.Write(chunk)
				mu.Unlock()
				if onChunk != nil {
					onChunk(chunk)
				}
			}
			if readErr != nil {
				break
			}
		}
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); streamReader(stdoutPipe) }()
	go func() { defer wg.Done(); streamReader(stderrPipe) }()
	wg.Wait()

	waitErr := cmd.Wait()
	duration := time.Since(start)

	exitCode := 0
	errMsg := ""
	if waitErr != nil {
		if exitError, ok := waitErr.(*exec.ExitError); ok {
			exitCode = exitError.ExitCode()
		} else {
			exitCode = -1
		}
		errMsg = waitErr.Error()
	}

	return &ExecutionResult{
		ExitCode: exitCode,
		Output:   outputBuf.String(),
		Duration: duration,
		Error:    errMsg,
	}, nil
}
