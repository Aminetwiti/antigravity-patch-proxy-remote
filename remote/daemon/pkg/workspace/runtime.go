package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ProjectRuntimeInfo contient la cartographie technologique auto-détectée d'un projet.
type ProjectRuntimeInfo struct {
	Language       string   `json:"language"`       // "nodejs", "python", "go", "rust", "php", "docker", "unknown"
	PackageManager string   `json:"packageManager"` // "npm", "pnpm", "yarn", "bun", "pip", "poetry", "cargo", "composer"
	Framework      string   `json:"framework"`      // "nextjs", "react", "vue", "fastapi", "django", "gin", etc.
	HasTests       bool     `json:"hasTests"`
	TestCommand    string   `json:"testCommand"`
	BuildCommand   string   `json:"buildCommand"`
	KeyFiles       []string `json:"keyFiles"`
}

// DetectRuntime inspecte la racine d'un workspace pour identifier la pile technique sans aucune configuration.
func (m *Manager) DetectRuntime(workspaceID string) (*ProjectRuntimeInfo, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	info := &ProjectRuntimeInfo{
		Language: "unknown",
		KeyFiles: make([]string, 0),
	}

	// 1. Détection Node.js / TypeScript
	pkgPath := filepath.Join(ws.Root, "package.json")
	if pkgBytes, err := os.ReadFile(pkgPath); err == nil {
		info.Language = "nodejs"
		info.PackageManager = "npm"
		info.KeyFiles = append(info.KeyFiles, "package.json")

		// Détecter package manager par lockfile
		if _, err := os.Stat(filepath.Join(ws.Root, "pnpm-lock.yaml")); err == nil {
			info.PackageManager = "pnpm"
			info.KeyFiles = append(info.KeyFiles, "pnpm-lock.yaml")
		} else if _, err := os.Stat(filepath.Join(ws.Root, "yarn.lock")); err == nil {
			info.PackageManager = "yarn"
			info.KeyFiles = append(info.KeyFiles, "yarn.lock")
		} else if _, err := os.Stat(filepath.Join(ws.Root, "bun.lockb")); err == nil {
			info.PackageManager = "bun"
			info.KeyFiles = append(info.KeyFiles, "bun.lockb")
		}

		// Analyser package.json pour scripts et framework
		var pkg struct {
			Scripts      map[string]string      `json:"scripts"`
			Dependencies map[string]interface{} `json:"dependencies"`
		}
		if json.Unmarshal(pkgBytes, &pkg) == nil {
			if _, ok := pkg.Dependencies["next"]; ok {
				info.Framework = "nextjs"
			} else if _, ok := pkg.Dependencies["react"]; ok {
				info.Framework = "react"
			} else if _, ok := pkg.Dependencies["vue"]; ok {
				info.Framework = "vue"
			}

			if _, ok := pkg.Scripts["test"]; ok {
				info.HasTests = true
				info.TestCommand = info.PackageManager + " test"
			}
			if _, ok := pkg.Scripts["build"]; ok {
				info.BuildCommand = info.PackageManager + " run build"
			}
		}
		return info, nil
	}

	// 2. Détection Python
	if _, err := os.Stat(filepath.Join(ws.Root, "requirements.txt")); err == nil {
		info.Language = "python"
		info.PackageManager = "pip"
		info.TestCommand = "pytest"
		info.KeyFiles = append(info.KeyFiles, "requirements.txt")
		return info, nil
	}
	if _, err := os.Stat(filepath.Join(ws.Root, "pyproject.toml")); err == nil {
		info.Language = "python"
		info.PackageManager = "poetry"
		info.TestCommand = "poetry run pytest"
		info.KeyFiles = append(info.KeyFiles, "pyproject.toml")
		return info, nil
	}

	// 3. Détection Go
	if _, err := os.Stat(filepath.Join(ws.Root, "go.mod")); err == nil {
		info.Language = "go"
		info.PackageManager = "go"
		info.HasTests = true
		info.TestCommand = "go test ./..."
		info.BuildCommand = "go build ./..."
		info.KeyFiles = append(info.KeyFiles, "go.mod")
		return info, nil
	}

	// 4. Détection Rust
	if _, err := os.Stat(filepath.Join(ws.Root, "Cargo.toml")); err == nil {
		info.Language = "rust"
		info.PackageManager = "cargo"
		info.HasTests = true
		info.TestCommand = "cargo test"
		info.BuildCommand = "cargo build"
		info.KeyFiles = append(info.KeyFiles, "Cargo.toml")
		return info, nil
	}

	return info, nil
}
