package gateway

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// ArtifactResolutionResult contient le résultat de la résolution floue d'un artefact.
type ArtifactResolutionResult struct {
	CascadeID    string `json:"cascadeId"`
	OriginalName string `json:"originalName"`
	ResolvedPath string `json:"resolvedPath"`
	Exists       bool   `json:"exists"`
	IsDirectory  bool   `json:"isDirectory"`
	IsImage      bool   `json:"isImage"`
	SizeBytes    int64  `json:"sizeBytes"`
	ModTime      int64  `json:"modTime"`
}

var reFilename = regexp.MustCompile(`([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)`)
var reAlphaNumOnly = regexp.MustCompile(`[^a-z0-9]`)

// ResolveArtifactOnDisk localise un artefact dans le répertoire brain de la cascade.
func ResolveArtifactOnDisk(convoID, title string) *ArtifactResolutionResult {
	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		homeDir = os.Getenv("USERPROFILE")
	}

	result := &ArtifactResolutionResult{
		CascadeID:    convoID,
		OriginalName: title,
	}

	candidatesDirs := []string{
		filepath.Join(homeDir, ".gemini", "antigravity", "brain", convoID),
		filepath.Join(homeDir, ".gemini", "antigravity-ide", "brain", convoID),
	}

	var foundPath string

	for _, brainDir := range candidatesDirs {
		if fi, err := os.Stat(brainDir); err != nil || !fi.IsDir() {
			continue
		}

		// Si title est vide, on prend le dossier brain lui-même
		if strings.TrimSpace(title) == "" {
			foundPath = brainDir
			break
		}

		entries, err := os.ReadDir(brainDir)
		if err != nil {
			continue
		}

		var files []string
		for _, e := range entries {
			name := e.Name()
			if !strings.HasSuffix(name, ".metadata.json") {
				files = append(files, name)
			}
		}

		// 1. Passe 1 : Extraction regex du nom de fichier exact
		fnMatch := reFilename.FindString(title)
		if fnMatch != "" {
			for _, f := range files {
				if strings.EqualFold(f, fnMatch) {
					foundPath = filepath.Join(brainDir, f)
					break
				}
			}
		}

		// 2. Passe 2 : Normalisation alphanumérique exacte
		if foundPath == "" {
			normTitle := reAlphaNumOnly.ReplaceAllString(strings.ToLower(title), "")
			for _, f := range files {
				base := strings.TrimSuffix(f, filepath.Ext(f))
				normBase := reAlphaNumOnly.ReplaceAllString(strings.ToLower(base), "")
				if normBase == normTitle {
					foundPath = filepath.Join(brainDir, f)
					break
				}
			}
		}

		// 3. Passe 3 : Matching flou de sous-chaîne bidirectionnel
		if foundPath == "" {
			normTitle := reAlphaNumOnly.ReplaceAllString(strings.ToLower(title), "")
			if len(normTitle) >= 3 {
				for _, f := range files {
					base := strings.TrimSuffix(f, filepath.Ext(f))
					normBase := reAlphaNumOnly.ReplaceAllString(strings.ToLower(base), "")
					if len(normBase) >= 3 && (strings.HasPrefix(normBase, normTitle) ||
						strings.HasPrefix(normTitle, normBase) ||
						strings.Contains(normBase, normTitle) ||
						strings.Contains(normTitle, normBase)) {
						foundPath = filepath.Join(brainDir, f)
						break
					}
				}
			}
		}

		if foundPath != "" {
			break
		}
	}

	// Si aucun fichier précis n'a été trouvé mais que le dossier brain existe
	if foundPath == "" {
		for _, brainDir := range candidatesDirs {
			if fi, err := os.Stat(brainDir); err == nil && fi.IsDir() {
				foundPath = brainDir
				break
			}
		}
	}

	if foundPath == "" {
		return result
	}

	result.ResolvedPath = foundPath
	if fi, err := os.Stat(foundPath); err == nil {
		result.Exists = true
		result.IsDirectory = fi.IsDir()
		result.SizeBytes = fi.Size()
		result.ModTime = fi.ModTime().Unix()

		ext := strings.ToLower(filepath.Ext(foundPath))
		switch ext {
		case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico":
			result.IsImage = true
		}
	}

	return result
}

// ResolveLatestUploadedMedia trouve le fichier média le plus récent dans .user_uploaded.
func ResolveLatestUploadedMedia(convoID string) *ArtifactResolutionResult {
	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		homeDir = os.Getenv("USERPROFILE")
	}

	candidates := []string{
		filepath.Join(homeDir, ".gemini", "antigravity", "brain", convoID, ".user_uploaded"),
		filepath.Join(homeDir, ".gemini", "antigravity-ide", "brain", convoID, ".user_uploaded"),
	}

	for _, mediaDir := range candidates {
		entries, err := os.ReadDir(mediaDir)
		if err != nil || len(entries) == 0 {
			continue
		}

		type mediaEntry struct {
			path    string
			modTime int64
			size    int64
		}
		var list []mediaEntry
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			fp := filepath.Join(mediaDir, e.Name())
			fi, err := os.Stat(fp)
			if err == nil {
				list = append(list, mediaEntry{
					path:    fp,
					modTime: fi.ModTime().UnixNano(),
					size:    fi.Size(),
				})
			}
		}

		if len(list) > 0 {
			sort.Slice(list, func(i, j int) bool {
				return list[i].modTime > list[j].modTime
			})
			latest := list[0]
			return &ArtifactResolutionResult{
				CascadeID:    convoID,
				OriginalName: filepath.Base(latest.path),
				ResolvedPath: latest.path,
				Exists:       true,
				IsDirectory:  false,
				IsImage:      true,
				SizeBytes:    latest.size,
				ModTime:      latest.modTime / int64(time.Second),
			}
		}
	}

	return &ArtifactResolutionResult{
		CascadeID: convoID,
		Exists:    false,
	}
}

// RevealPathInExplorer ouvre le fichier ou dossier dans le gestionnaire de fichiers OS.
func RevealPathInExplorer(targetPath string) error {
	cleanPath := filepath.Clean(targetPath)
	fi, err := os.Stat(cleanPath)
	if err != nil {
		dir := filepath.Dir(cleanPath)
		if fiDir, errDir := os.Stat(dir); errDir == nil && fiDir.IsDir() {
			cleanPath = dir
			fi = fiDir
		} else {
			return fmt.Errorf("chemin introuvable: %s", targetPath)
		}
	}

	switch runtime.GOOS {
	case "windows":
		var cmd *exec.Cmd
		if fi.IsDir() {
			cmd = exec.Command("explorer.exe", cleanPath)
		} else {
			cmd = exec.Command("explorer.exe", fmt.Sprintf(`/select,"%s"`, cleanPath))
		}
		hideWindow(cmd)
		return cmd.Start()
	case "darwin":
		if fi.IsDir() {
			return exec.Command("open", cleanPath).Start()
		}
		return exec.Command("open", "-R", cleanPath).Start()
	default: // Linux
		if fi.IsDir() {
			return exec.Command("xdg-open", cleanPath).Start()
		}
		return exec.Command("xdg-open", filepath.Dir(cleanPath)).Start()
	}
}

// CopyImageFileToClipboard copie une image bitmap dans le presse-papiers Windows.
func CopyImageFileToClipboard(imagePath string) error {
	cleanPath := filepath.Clean(imagePath)
	if _, err := os.Stat(cleanPath); err != nil {
		return fmt.Errorf("image introuvable: %s", cleanPath)
	}

	switch runtime.GOOS {
	case "windows":
		escaped := strings.ReplaceAll(cleanPath, `'`, `''`)
		psCmd := fmt.Sprintf(`& { Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('%s')) }`, escaped)
		cmd := exec.Command("powershell", "-Sta", "-NoProfile", "-Command", psCmd)
		hideWindow(cmd)
		return cmd.Run()
	case "darwin":
		applescript := fmt.Sprintf(`set the clipboard to (read (POSIX file "%s") as TIFF picture)`, cleanPath)
		return exec.Command("osascript", "-e", applescript).Run()
	default:
		if path, err := exec.LookPath("xclip"); err == nil {
			cmd := exec.Command(path, "-selection", "clipboard", "-t", "image/png", "-i", cleanPath)
			return cmd.Run()
		}
		return fmt.Errorf("copie image non supportée sous cet OS")
	}
}

// handleArtifactMessage traite les requêtes WebSocket d'artefacts et actions OS hôtes.
func (s *Server) handleArtifactMessage(conn *websocket.Conn, msg IncomingMessage) {
	switch msg.Type {
	case "resolve_artifact", "artifact.resolve":
		convoID := msg.CascadeID
		title := ""
		if msg.Data != nil {
			if t, ok := msg.Data["title"].(string); ok {
				title = t
			}
			if c, ok := msg.Data["cascadeId"].(string); ok && convoID == "" {
				convoID = c
			}
		}

		var res *ArtifactResolutionResult
		if strings.HasPrefix(strings.ToUpper(title), "MEDIA:") || strings.ToUpper(title) == "LATEST_MEDIA" {
			res = ResolveLatestUploadedMedia(convoID)
		} else {
			res = ResolveArtifactOnDisk(convoID, title)
		}

		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"result":  res,
				"success": res.Exists,
			},
		})

	case "reveal_in_explorer", "system.reveal_path":
		targetPath := msg.FilePath
		if targetPath == "" && msg.Data != nil {
			if p, ok := msg.Data["path"].(string); ok {
				targetPath = p
			}
			if targetPath == "" {
				title, _ := msg.Data["title"].(string)
				cascadeID, _ := msg.Data["cascadeId"].(string)
				if cascadeID == "" {
					cascadeID = msg.CascadeID
				}
				res := ResolveArtifactOnDisk(cascadeID, title)
				targetPath = res.ResolvedPath
			}
		}

		if targetPath == "" {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     "aucun chemin fourni pour reveal_in_explorer",
			})
			return
		}

		if err := RevealPathInExplorer(targetPath); err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("échec ouverture explorateur: %v", err),
			})
			return
		}

		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"status":  "revealed",
				"path":    targetPath,
				"success": true,
			},
		})

	case "clipboard_copy_image", "clipboard.copy_image":
		targetPath := msg.FilePath
		if targetPath == "" && msg.Data != nil {
			if p, ok := msg.Data["path"].(string); ok {
				targetPath = p
			}
			if targetPath == "" {
				title, _ := msg.Data["title"].(string)
				cascadeID, _ := msg.Data["cascadeId"].(string)
				if cascadeID == "" {
					cascadeID = msg.CascadeID
				}
				res := ResolveArtifactOnDisk(cascadeID, title)
				targetPath = res.ResolvedPath
			}
		}

		if targetPath == "" {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     "aucun chemin d'image fourni",
			})
			return
		}

		if err := CopyImageFileToClipboard(targetPath); err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("échec copie image dans le presse-papiers: %v", err),
			})
			return
		}

		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"status":  "copied",
				"path":    targetPath,
				"success": true,
			},
		})

	case "get_artifact_content", "artifact.get_content":
		convoID := msg.CascadeID
		title := ""
		if msg.Data != nil {
			if t, ok := msg.Data["title"].(string); ok {
				title = t
			}
			if c, ok := msg.Data["cascadeId"].(string); ok && convoID == "" {
				convoID = c
			}
		}

		res := ResolveArtifactOnDisk(convoID, title)
		if !res.Exists || res.IsDirectory {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     "artefact introuvable ou est un dossier",
			})
			return
		}

		// Limite à 10 Mo pour éviter l'épuisement mémoire
		if res.SizeBytes > 10*1024*1024 {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     "artefact trop volumineux (> 10MB)",
			})
			return
		}

		content, err := os.ReadFile(res.ResolvedPath)
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("erreur lecture fichier: %v", err),
			})
			return
		}

		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"result":     res,
				"base64Data": base64.StdEncoding.EncodeToString(content),
				"success":    true,
			},
		})
	}
}
