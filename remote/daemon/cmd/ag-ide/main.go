package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/ide"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	command := os.Args[1]

	switch command {
	case "instances", "status":
		handleInstances()
	case "workspaces", "ws":
		handleWorkspaces()
	case "sessions", "list":
		handleSessions()
	case "view", "show":
		if len(os.Args) < 3 {
			fmt.Println("Usage: ag-ide view <cascade-id>")
			os.Exit(1)
		}
		handleView(os.Args[2])
	case "focus", "open":
		if len(os.Args) < 3 {
			fmt.Println("Usage: ag-ide focus <cascade-id>")
			os.Exit(1)
		}
		handleFocus(os.Args[2])
	case "create", "new":
		wsPath := ""
		if len(os.Args) >= 3 {
			wsPath = os.Args[2]
		}
		model := "gemini-2.5-flash"
		if len(os.Args) >= 4 {
			model = os.Args[3]
		}
		handleCreate(wsPath, model)
	case "chat", "prompt":
		if len(os.Args) < 4 {
			fmt.Println("Usage: ag-ide chat <cascade-id> \"<prompt>\"")
			os.Exit(1)
		}
		cascadeID := os.Args[2]
		prompt := os.Args[3]
		handleChat(cascadeID, prompt)
	case "doctor", "health", "check":
		handleDoctor()
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Printf("Commande inconnue: %s\n\n", command)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("🛰️  ag-ide — Contrôleur CLI Universel pour Antigravity IDE")
	fmt.Println("\nUsage:")
	fmt.Println("  ag-ide doctor                    Diagnostiquer l'état complet (IDE, LS, Proxy, Daemon)")
	fmt.Println("  ag-ide instances                 Lister les instances Language Server actives et leurs ports")
	fmt.Println("  ag-ide workspaces                Lister les espaces de travail ouverts (storage.json)")
	fmt.Println("  ag-ide sessions                  Lister les sessions de chat et leurs métadonnées")
	fmt.Println("  ag-ide view <cascade-id>         Afficher l'historique et les étapes d'une session")
	fmt.Println("  ag-ide focus <cascade-id>        Ouvrir et afficher la session dans la fenêtre Antigravity IDE")
	fmt.Println("  ag-ide create [ws-path] [model]  Créer une nouvelle session de chat pour un projet")
	fmt.Println("  ag-ide chat <cascade-id> <text>  Envoyer un prompt et streamer la réponse en direct")
}

func handleDoctor() {
	fmt.Println("🩺 Exécution du diagnostic Antigravity IDE & Remote...")
	fmt.Println(strings.Repeat("─", 60))

	// 1. Détection Language Server
	instances, err := ide.DiscoverInstances()
	if err == nil && len(instances) > 0 {
		fmt.Printf("✅ Language Server : %d instance(s) active(s)\n", len(instances))
		for _, inst := range instances {
			fmt.Printf("   • PID: %d | Port ConnectRPC: :%d | AppDir: %s\n", inst.PID, inst.Port, inst.AppDataDir)
		}
	} else {
		fmt.Println("⚠️  Language Server : Aucune instance IDE active détectée")
	}

	// 2. Workspaces
	workspaces, err := ide.ListWorkspaces()
	if err == nil && len(workspaces) > 0 {
		fmt.Printf("✅ Workspaces : %d configuré(s)\n", len(workspaces))
		for _, ws := range workspaces {
			if ws.IsActive {
				fmt.Printf("   👉 Actif: %s (%s)\n", ws.Name, ws.Path)
			}
		}
	} else {
		fmt.Println("ℹ️  Workspaces : Aucun workspace ouvert")
	}

	// 3. Sessions SQLite
	sessions, err := ide.ListSessions()
	if err == nil {
		fmt.Printf("✅ Trajectoires SQLite : %d session(s) persistée(s)\n", len(sessions))
	} else {
		fmt.Printf("⚠️  Trajectoires SQLite : Erreur (%v)\n", err)
	}

	// 4. Test Connectivité Proxy Local :51074
	fmt.Print("🔍 Test Patch Proxy (:51074)... ")
	client := &http.Client{Timeout: 1 * time.Second}
	resp, err := client.Get("http://127.0.0.1:51074/metrics")
	if err == nil && resp.StatusCode == 200 {
		resp.Body.Close()
		fmt.Println("✅ En ligne (:51074)")
	} else {
		fmt.Println("ℹ️  Hors ligne ou non démarré (optionnel)")
	}

	fmt.Println(strings.Repeat("─", 60))
	fmt.Println("🎯 Diagnostic terminé.")
}

func handleInstances() {
	fmt.Println("🔍 Recherche des instances Antigravity IDE...")
	instances, err := ide.DiscoverInstances()
	if err != nil {
		fmt.Printf("❌ Erreur: %v\n", err)
		os.Exit(1)
	}
	if len(instances) == 0 {
		fmt.Println("ℹ️  Aucune instance active d'Antigravity IDE trouvée.")
		return
	}
	fmt.Printf("✅ %d instance(s) active(s) trouvée(s) :\n\n", len(instances))
	for i, inst := range instances {
		fmt.Printf("[%d] PID: %d | Port RPC: %d | AppDir: %s\n", i+1, inst.PID, inst.Port, inst.AppDataDir)
		fmt.Printf("    CSRF: %s\n", inst.CSRFToken)
		if inst.WorkspaceID != "" {
			fmt.Printf("    Workspace Hash: %s\n", inst.WorkspaceID)
		}
		fmt.Println()
	}
}

func handleWorkspaces() {
	fmt.Println("📁 Lecture des espaces de travail d'Antigravity IDE...")
	workspaces, err := ide.ListWorkspaces()
	if err != nil {
		fmt.Printf("❌ Erreur: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✅ %d workspace(s) trouvé(s) :\n\n", len(workspaces))
	for _, ws := range workspaces {
		tag := " "
		if ws.IsActive {
			tag = "👉 [ACTIF]"
		}
		fmt.Printf("%s %-25s (%s)\n", tag, ws.Name, ws.Path)
	}
}

func handleSessions() {
	fmt.Println("💬 Lecture des sessions Antigravity IDE...")
	sessions, err := ide.ListSessions()
	if err != nil {
		fmt.Printf("❌ Erreur: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✅ %d session(s) trouvée(s) :\n\n", len(sessions))
	for i, s := range sessions {
		if i >= 15 {
			fmt.Printf("... et %d autres sessions antérieures\n", len(sessions)-15)
			break
		}
		fmt.Printf("• %s | Étapes: %-2d | %s\n", s.CascadeID, s.StepCount, s.LastModified.Format("02/01 15:04"))
		fmt.Printf("  Titre: %s\n", s.Title)
		if s.WorkspacePath != "" {
			fmt.Printf("  Projet: %s\n", s.WorkspacePath)
		}
		fmt.Println()
	}
}

func handleView(cascadeID string) {
	fmt.Printf("📖 Chargement des étapes de la session %s...\n\n", cascadeID)
	steps, err := ide.ReadSessionSteps(cascadeID)
	if err != nil {
		fmt.Printf("❌ Erreur lecture transcript: %v\n", err)
		os.Exit(1)
	}
	if len(steps) == 0 {
		fmt.Println("ℹ️  Aucune étape enregistrée dans cette session.")
		return
	}
	for _, st := range steps {
		icon := "🤖"
		if st.Source == "USER_EXPLICIT" || st.Type == "USER_INPUT" {
			icon = "👤"
		} else if st.Type == "CHECKPOINT" {
			icon = "📌"
		} else if st.Type == "TOOL_CALL" {
			icon = "🔧"
		}
		fmt.Printf("%s [Step %d] %s (%s)\n", icon, st.Index, st.Type, st.CreatedAt.Format("15:04:05"))
		content := st.Content
		if len(content) > 300 {
			content = content[:297] + "..."
		}
		fmt.Printf("   %s\n\n", strings.ReplaceAll(content, "\n", "\n   "))
	}
}

func handleFocus(cascadeID string) {
	client, err := ide.NewAutoClient()
	if err != nil {
		fmt.Printf("❌ Erreur de connexion: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("🎯 Envoi de la commande de focus pour la session %s...\n", cascadeID)
	if err := client.SetFocus(cascadeID); err != nil {
		fmt.Printf("❌ Échec focus: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("✅ Session ouverte avec succès dans la fenêtre Antigravity IDE !")
}

func handleCreate(wsPath, model string) {
	client, err := ide.NewAutoClient()
	if err != nil {
		fmt.Printf("❌ Erreur de connexion: %v\n", err)
		os.Exit(1)
	}
	if wsPath == "" {
		wsPath, _ = os.Getwd()
	}
	fmt.Printf("🚀 Création d'une nouvelle session pour %s (Modèle: %s)...\n", wsPath, model)
	cascadeID, err := client.CreateSession(wsPath, model)
	if err != nil {
		fmt.Printf("❌ Échec création session: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✅ Session créée avec succès ! ID: %s\n", cascadeID)
	_ = client.SetFocus(cascadeID)
	fmt.Println("👉 Session sélectionnée dans l'interface Antigravity IDE.")
}

func handleChat(cascadeID, prompt string) {
	client, err := ide.NewAutoClient()
	if err != nil {
		fmt.Printf("❌ Erreur de connexion: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("📤 [START] Envoi du prompt vers la session %s...\n", cascadeID)
	fmt.Printf("💬 Prompt: %q\n\n", prompt)
	fmt.Println("--- Réponse en Streaming (Temps Réel) ---")

	start := time.Now()
	err = client.SendMessageStream(cascadeID, prompt, func(ev connectrpc.StreamEvent) {
		if ev.Kind == connectrpc.EventKindThinking && ev.Delta != "" {
			fmt.Print("💭 ", ev.Delta)
		} else if ev.Kind == connectrpc.EventKindText && ev.Delta != "" {
			fmt.Print(ev.Delta)
		} else if ev.Delta != "" {
			fmt.Print(ev.Delta)
		}
	})

	fmt.Println("\n-----------------------------------------")
	if err != nil {
		fmt.Printf("⚠️ Note streaming: %v\n", err)
	}
	fmt.Printf("⏱️ Exécution terminée en %v\n", time.Since(start))
	_ = client.SetFocus(cascadeID)
}
