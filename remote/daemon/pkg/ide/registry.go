package ide

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type StorageJSON struct {
	BackupWorkspaces struct {
		Folders []struct {
			FolderURI string `json:"folderUri"`
		} `json:"folders"`
	} `json:"backupWorkspaces"`
	ProfileAssociations struct {
		Workspaces map[string]string `json:"workspaces"`
	} `json:"profileAssociations"`
	WindowsState struct {
		LastActiveWindow struct {
			Folder string `json:"folder"`
		} `json:"lastActiveWindow"`
	} `json:"windowsState"`
}

// GetStoragePath retourne le chemin du fichier storage.json d'Antigravity IDE.
func GetStoragePath() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		home, _ := os.UserHomeDir()
		appData = filepath.Join(home, "AppData", "Roaming")
	}
	return filepath.Join(appData, "Antigravity IDE", "User", "globalStorage", "storage.json")
}

// ListWorkspaces extrait tous les espaces de travail configurés dans Antigravity IDE.
func ListWorkspaces() ([]Workspace, error) {
	storagePath := GetStoragePath()
	data, err := os.ReadFile(storagePath)
	if err != nil {
		return nil, err
	}

	var storage StorageJSON
	if err := json.Unmarshal(data, &storage); err != nil {
		return nil, err
	}

	activeFolder := storage.WindowsState.LastActiveWindow.Folder

	seen := make(map[string]bool)
	var workspaces []Workspace

	addWS := func(uri string, profile string) {
		if uri == "" || seen[uri] {
			return
		}
		seen[uri] = true

		decodedPath := DecodeURI(uri)
		name := filepath.Base(decodedPath)
		isActive := (uri == activeFolder || decodedPath == DecodeURI(activeFolder))

		workspaces = append(workspaces, Workspace{
			URI:      uri,
			Path:     decodedPath,
			Name:     name,
			IsActive: isActive,
			Profile:  profile,
		})
	}

	// 1. Ajouter depuis backupWorkspaces
	for _, f := range storage.BackupWorkspaces.Folders {
		prof := storage.ProfileAssociations.Workspaces[f.FolderURI]
		addWS(f.FolderURI, prof)
	}

	// 2. Ajouter depuis profileAssociations
	for uri, prof := range storage.ProfileAssociations.Workspaces {
		addWS(uri, prof)
	}

	return workspaces, nil
}

// DecodeURI transforme une URI de type "file:///c%3A/Users/..." en chemin système standard.
func DecodeURI(rawURI string) string {
	if rawURI == "" {
		return ""
	}
	u, err := url.Parse(rawURI)
	if err != nil {
		return rawURI
	}
	path := u.Path
	if unescaped, err := url.PathUnescape(path); err == nil {
		path = unescaped
	}
	// Normalisation Windows
	path = strings.TrimPrefix(path, "/")
	path = filepath.FromSlash(path)
	return path
}
