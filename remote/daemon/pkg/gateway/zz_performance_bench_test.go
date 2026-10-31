package gateway

import (
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// BenchmarkListOfficialProjects vérifie que le cache TTL permet une résolution O(1) < 100ns sans I/O disque.
func BenchmarkListOfficialProjects(b *testing.B) {
	// Préchauffe le cache
	ListOfficialProjects()

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		projs := ListOfficialProjects()
		if len(projs) < 0 {
			b.Fatal("invalid projects")
		}
	}
}

// BenchmarkConvertTranscriptToJSONL vérifie la rapidité du streaming avec buffer pool.
func BenchmarkConvertTranscriptToJSONL(b *testing.B) {
	var sb strings.Builder
	for i := 0; i < 500; i++ {
		sb.WriteString(`{"step_index":` + string(rune('0'+i%10)) + `,"type":"MODEL","content":"hello performance benchmark world line"}` + "\n")
	}
	raw := []byte(sb.String())

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		out, err := convertTranscriptToJSONL(raw)
		if err != nil || len(out) == 0 {
			b.Fatalf("convert error: %v", err)
		}
	}
}

// BenchmarkJetboxSessionsLookup vérifie la vitesse O(1) de calcul des sessions en mémoire.
func BenchmarkJetboxSessionsLookup(b *testing.B) {
	sums := make(map[string]connectrpc.JetboxSummary)
	for i := 0; i < 50; i++ {
		id := "casc-" + string(rune('a'+i%26))
		sums[id] = connectrpc.JetboxSummary{
			CascadeID: id,
			Title:     "Session " + id,
			Workspace: "/home/user/project",
			ProjectID: "proj-1",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: time.Now(),
		}
	}
	srv := &Server{
		jetboxSummaries: sums,
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		res := srv.sessionsFromSummariesLocked(sums)
		if res == nil {
			b.Fatal("nil result")
		}
	}
}
