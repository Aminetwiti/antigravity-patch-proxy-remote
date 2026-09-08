package sandbox

import (
	"context"
	"fmt"
	"io"
	"log"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// DockerSandboxConfig holds options for the container sandbox.
type DockerSandboxConfig struct {
	Image       string
	MemoryLimit string // e.g. "512m", "1g"
	CPULimit    string // e.g. "1.0", "2.0"
	NetworkMode string // e.g. "bridge", "none" (defaults to "none")
	Mode        Mode   // ModeStrict, ModePreferred, ModeNative
}

// DockerSandbox executes commands inside isolated Docker containers.
type DockerSandbox struct {
	cfg      DockerSandboxConfig
	fallback *NativeSandbox
}

func NewDockerSandbox(cfg DockerSandboxConfig) *DockerSandbox {
	if cfg.Image == "" {
		cfg.Image = "alpine:latest"
	}
	if cfg.MemoryLimit == "" {
		cfg.MemoryLimit = "512m"
	}
	if cfg.NetworkMode == "" {
		cfg.NetworkMode = "none"
	}
	if cfg.Mode == "" {
		cfg.Mode = ModeStrict
	}
	return &DockerSandbox{
		cfg:      cfg,
		fallback: NewNativeSandbox(),
	}
}

func (s *DockerSandbox) Name() string {
	return "docker"
}

// IsAvailable checks if the Docker CLI is installed and the Docker daemon is responding.
func (s *DockerSandbox) IsAvailable() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "docker", "version", "--format", "{{.Server.Version}}")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

func (s *DockerSandbox) Execute(ctx context.Context, req ExecutionRequest, onChunk func(chunk []byte)) (*ExecutionResult, error) {
	if !s.IsAvailable() {
		switch s.cfg.Mode {
		case ModePreferred:
			log.Printf("[DockerSandbox] WARNING: Docker daemon is unavailable, fallback to host permitted by ModePreferred for workspace %s", req.WorkspaceID)
			return s.fallback.Execute(ctx, req, onChunk)
		case ModeNative:
			return s.fallback.Execute(ctx, req, onChunk)
		default: // ModeStrict -> FAIL CLOSED
			return nil, fmt.Errorf("%w: docker daemon not available or not running", ErrSandboxUnavailable)
		}
	}

	timeout := req.Timeout
	if timeout <= 0 {
		timeout = 120 * time.Second
	}

	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	absDir, err := filepath.Abs(req.Directory)
	if err != nil {
		absDir = req.Directory
	}

	// docker run --rm -i --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=256 --tmpfs /tmp:rw,noexec,nosuid,size=64m -v <host_path>:/workspace -w /workspace -m <mem> <image> sh -c <command>
	args := []string{
		"run", "--rm", "-i",
		"--read-only",
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges",
		"--pids-limit=256",
		"--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
		"-v", fmt.Sprintf("%s:/workspace", absDir),
		"-w", "/workspace",
	}

	if s.cfg.MemoryLimit != "" {
		args = append(args, "-m", s.cfg.MemoryLimit)
	}
	if s.cfg.CPULimit != "" {
		args = append(args, "--cpus", s.cfg.CPULimit)
	}
	if s.cfg.NetworkMode != "" {
		args = append(args, "--network", s.cfg.NetworkMode)
	}

	// Forward environment variables
	for _, envVar := range req.Env {
		args = append(args, "-e", envVar)
	}

	args = append(args, s.cfg.Image, "sh", "-c", req.CommandLine)

	cmd := exec.CommandContext(execCtx, "docker", args...)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open docker stdout: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open docker stderr: %w", err)
	}

	start := time.Now()
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start docker command: %w", err)
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
