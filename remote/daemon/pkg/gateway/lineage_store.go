package gateway

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	LineageVersion    = 1
	DefaultMaxLinks   = 2048
)

type SessionLink struct {
	SourceSessionID    string `json:"sourceSessionId"`
	TargetSessionID    string `json:"targetSessionId"`
	LinkType           string `json:"linkType"`
	TransferredContext string `json:"transferredContext,omitempty"`
	CreatedAt          string `json:"createdAt"`
}

type lineageStorageFormat struct {
	Version int            `json:"version"`
	Links   []*SessionLink `json:"links"`
}

type SessionLineageStore struct {
	mu       sync.Mutex
	stateDir string
	filePath string
	links    []*SessionLink
	loaded   bool
}

func NewSessionLineageStore(stateDir string) *SessionLineageStore {
	if stateDir == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			stateDir = filepath.Join(home, ".gemini", "antigravity-remote")
		} else {
			stateDir = "."
		}
	}
	return &SessionLineageStore{
		stateDir: stateDir,
		filePath: filepath.Join(stateDir, "session-links.json"),
		links:    make([]*SessionLink, 0),
	}
}

func (s *SessionLineageStore) loadLocked() {
	if s.loaded {
		return
	}
	s.loaded = true

	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return
	}
	var storage lineageStorageFormat
	if err := json.Unmarshal(data, &storage); err == nil && storage.Version == LineageVersion {
		s.links = storage.Links
	}
}

func (s *SessionLineageStore) persistLocked() error {
	if err := os.MkdirAll(s.stateDir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(lineageStorageFormat{
		Version: LineageVersion,
		Links:   s.links,
	}, "", "  ")
	if err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.%d.tmp", s.filePath, time.Now().UnixNano())
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.filePath)
}

func (s *SessionLineageStore) AddLink(sourceID, targetID, linkType, transferredContext string) (*SessionLink, error) {
	if sourceID == "" || targetID == "" {
		return nil, fmt.Errorf("sourceID et targetID sont obligatoires")
	}
	if linkType == "" {
		linkType = "handoff"
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.loadLocked()

	link := &SessionLink{
		SourceSessionID:    sourceID,
		TargetSessionID:    targetID,
		LinkType:           linkType,
		TransferredContext: transferredContext,
		CreatedAt:          time.Now().UTC().Format(time.RFC3339),
	}

	s.links = append(s.links, link)
	if len(s.links) > DefaultMaxLinks {
		s.links = s.links[len(s.links)-DefaultMaxLinks:]
	}

	_ = s.persistLocked()
	return link, nil
}

func (s *SessionLineageStore) ListLinksFor(sessionID string) []*SessionLink {
	if sessionID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	s.loadLocked()
	var matching []*SessionLink
	for _, link := range s.links {
		if link.SourceSessionID == sessionID || link.TargetSessionID == sessionID {
			matching = append(matching, link)
		}
	}
	return matching
}
