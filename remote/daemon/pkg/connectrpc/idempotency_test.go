package connectrpc

import (
	"fmt"
	"sync"
	"testing"
)

// ─── Tests de concurrence (le daemon route des requêtes simultanées) ───

// TestBuilders_ConcurrentSafety : tous les builders protobuf + Frame doivent
// être sûrs en concurrence (ils n'utilisent pas d'état global partagé).
// Lancement avec détection de course :  go test -race ./pkg/connectrpc/
func TestBuilders_ConcurrentSafety(t *testing.T) {
	if testing.Short() {
		t.Skip("test de concurrence, sauté en mode -short")
	}

	var wg sync.WaitGroup
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 2000; i++ {
				cascID := fmt.Sprintf("casc-%d-%d", g, i)
				msg := fmt.Sprintf("message %d goroutine %d — accents éèà", i, g)

				b1 := BuildStartCascade("file:///C:/proj", "", "", 190)
				b2 := BuildSendMessage(cascID, msg, "k", "s", "", 0)
				b3 := BuildHandleCascadeUserInteraction(cascID, "traj-1", 2, InteractionRunCommand, BuildRunCommandInteraction(true, "ls", ""))
				_ = Frame(b1)
				_ = Frame(b2)
				_ = Frame(b3)

				if len(DecodeFields(b2)) < 4 {
					t.Errorf("goroutine %d: BuildSendMessage a produit %d champs", g, len(DecodeFields(b2)))
				}
			}
		}(g)
	}
	wg.Wait()
}

// TestSplitFrames_ConcurrentSafety : splitFrames ne doit pas partager d'état
// mutable entre goroutines.
func TestSplitFrames_ConcurrentSafety(t *testing.T) {
	if testing.Short() {
		t.Skip("test de concurrence, sauté en mode -short")
	}

	payload := make([]byte, 100)
	stream := append(Frame(payload), Frame(payload)...)

	var wg sync.WaitGroup
	errs := make(chan error, 32)
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 5000; i++ {
				frames, rest := splitFrames(stream)
				if len(frames) != 2 || len(rest) != 0 {
					errs <- fmt.Errorf("attendu 2 frames + 0 rest, reçu %d + %d", len(frames), len(rest))
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

// TestDecodeFields_ConcurrentSafety : le décodage ne doit pas corrompre
// les buffers partagés entre goroutines (Bytes pointe dans l'entrée).
func TestDecodeFields_ConcurrentSafety(t *testing.T) {
	if testing.Short() {
		t.Skip("test de concurrence, sauté en mode -short")
	}

	msg := BuildSendMessage("casc-race", "texte partagé", "k", "s", "gemini-3.0-flash-high", 0)
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 3000; i++ {
				fields := DecodeFields(msg)
				if len(fields) < 4 {
					t.Errorf("attendu au moins 4 champs, reçu %d", len(fields))
				}
			}
		}()
	}
	wg.Wait()
}
