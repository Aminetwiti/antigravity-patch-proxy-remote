package gateway

import (
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// Flux réactif StreamReactiveUpdates — source secondaire de fiabilité (P1,
// cf. implémentation plan §4.5) : le LS pousse l'état des cascades au fil de
// l'eau. Le chemin principal (parsing des frames de réponse dans le send_prompt)
// reste inchangé ; ce flux ne fait que :
//  1. marquer la cascade "waiting for input" (statut IDLE + interaction
//     demandée) — détection instantanée que le parseur de frames rate parfois ;
//  2. poser l'approbation en attente (MarkApprovalPending) quand une demande
//     d'interaction arrive — même mécanique que l'événement approval_required
//     du flux binaire, donc expiration fonctionne aussi sur ce chemin.
//
// Les frames sont purement informatives : aucune donnée mobile n'en dépend
// directement, et le flux ne réordonne JAMAIS les stream_delta (sync_session /
// StepRecovery restent alimentés uniquement par le chemin principal).

// reactiveBackoff plafonne le délai de reconnexion après un échec du stream
// réactif (le LS peut être en cours de redémarrage — même logique que jetbox).
const reactiveBackoff = 30 * time.Second

// reactiveNotFoundBackoff temporise 5 minutes si le LS répond 404 (endpoint non implémenté).
var reactiveNotFoundBackoff = 5 * time.Minute

// ReactiveStreamer est la portion minimale du client LS nécessaire au flux
// réactif. Interface étroite : les tests injectent un faux sans réimplémenter
// RPCClient (même pattern que JetboxStreamer).
type ReactiveStreamer interface {
	RunReactiveSubscription(onUpdate func(updates map[string]connectrpc.ReactiveUpdate)) error
}

// RunReactiveSubscription démarre la boucle long-vivante du stream
// StreamReactiveUpdates. Reconnecte en boucle avec backoff — goroutine
// autonome, ne bloque jamais le démarrage du serveur. Une seule goroutine
// pour tout le daemon (le stream est global, pas par client).
func (s *Server) RunReactiveSubscription(rpc ReactiveStreamer) {
	go func() {
		backoff := 2 * time.Second
		warned404 := false
		for {
			err := rpc.RunReactiveSubscription(s.reactiveSyncUpdates)
			is404 := err != nil && (strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "unimplemented"))
			if is404 {
				if !warned404 {
					logJSON.Info("reactive_stream_unavailable", "reason", "endpoint not supported by current IDE version, backed off", "retry_in", reactiveNotFoundBackoff)
					warned404 = true
				} else {
					logJSON.Debug("reactive_stream_end", "err", err, "retry_in", reactiveNotFoundBackoff)
				}
				time.Sleep(reactiveNotFoundBackoff)
				continue
			}
			warned404 = false
			logJSON.Warn("reactive_stream_end", "err", err, "retry_in", backoff)
			time.Sleep(backoff)
			if backoff < reactiveBackoff {
				backoff *= 2
			}
		}
	}()
}

// reactiveSyncUpdates est le callback du flux : chaque frame d'état est
// traduite en actions concrètes (approbation en attente + broadcast).
// Ne panique jamais : une frame inattendue est ignorée.
func (s *Server) reactiveSyncUpdates(updates map[string]connectrpc.ReactiveUpdate) {
	for id, u := range updates {
		if u.WaitingForInput && u.RequestedInteraction != connectrpc.InteractionNone {
			// Demande d'interaction détectée : même mécanique que l'événement
			// approval_required du flux binaire (expiration incluse). Seules
			// les demandes d'approbation outil posent une carte mobile : les
			// autres types (ask_question, select…) restent gérés par le
			// chemin principal.
			switch u.RequestedInteraction {
			case connectrpc.InteractionApproval,
				connectrpc.InteractionRunCommand,
				connectrpc.InteractionFilePermission,
				connectrpc.InteractionPermission,
				connectrpc.InteractionOpenBrowserURL,
				connectrpc.InteractionReadUrlContent,
				connectrpc.InteractionMcp,
				connectrpc.InteractionDeploy,
				connectrpc.InteractionSendCommandInput,
				connectrpc.InteractionInvokeSubagent,
				connectrpc.InteractionDeleteDirectory,
				connectrpc.InteractionCloudSQL,
				connectrpc.InteractionRunExtensionCode,
				connectrpc.InteractionBrowserAction,
				connectrpc.InteractionExecuteBrowserJS,
				connectrpc.InteractionCaptureScreenshot,
				connectrpc.InteractionClickPixel,
				connectrpc.InteractionOpenBrowserSetup,
				connectrpc.InteractionConfirmBrowserSetup,
				connectrpc.InteractionElicitation,
				connectrpc.InteractionAskQuestion:
				tool := interactionToolName(u.RequestedInteraction)
				// Même garde que le chemin binaire (websocket.go) : une
				// auto-approbation de session déjà traitée ne doit ni poser
				// de carte ni diffuser.
				if s.hasSessionApproval(id, tool) {
					continue
				}
				ev := connectrpc.StreamEvent{
					CallID:         u.CallID,
					TrajectoryID:   u.TrajectoryID,
					StepIndex:      u.StepIndex,
					Tool:           tool,
					InteractionNum: u.RequestedInteraction,
				}
				s.MarkApprovalPending(id, ev)
				// C7-B : idle détection hôte — même champ que le push
				// approval_pending du flux binaire.
				pending := s.pendingApprovalInfo(id)
				if pending == nil {
					continue
				}
				pending["hostActive"] = hostActiveSince(hostActiveWindow)
				s.broadcast(OutgoingMessage{
					Type:      "approval_pending",
					CascadeID: id,
					Data:      pending,
				})
			}
		} else if !u.WaitingForInput && s.hasPendingApproval(id) {
			// L'utilisateur a validé ou refusé l'approbation directement sur l'IDE PC :
			// on nettoie l'approbation locale et on notifie immédiatement le mobile.
			if p, ok := s.approvalFor(id); ok {
				s.markApprovalResolved(p.callID)
			}
			s.clearApproval(id)
			s.broadcast(OutgoingMessage{
				Type:      "approval_resolved",
				CascadeID: id,
				Data: map[string]interface{}{
					"cascadeId": id,
					"source":    "desktop",
				},
			})
			s.broadcast(OutgoingMessage{
				Type: "sessions_updated",
				Data: s.sessionsFromSummaries(s.snapshotSummaries()),
			})
		}
	}
}

// interactionToolName mappe le type d'interaction réactif vers le nom d'outil
// historique du daemon (utilisé par buildApprovalPayload pour choisir le
// oneof member exact — champ 56, verrou critique du plan).
func interactionToolName(t int) string {
	switch t {
	case connectrpc.InteractionRunCommand:
		return "run_command"
	case connectrpc.InteractionFilePermission:
		return "file_permission"
	case connectrpc.InteractionPermission:
		return "permission"
	case connectrpc.InteractionOpenBrowserURL:
		return "open_browser_url"
	case connectrpc.InteractionReadUrlContent:
		return "read_url_content"
	case connectrpc.InteractionMcp:
		return "mcp_tool"
	case connectrpc.InteractionDeploy:
		return "deploy"
	case connectrpc.InteractionSendCommandInput:
		return "send_command_input"
	case connectrpc.InteractionInvokeSubagent:
		return "invoke_subagent"
	case connectrpc.InteractionDeleteDirectory:
		return "delete_directory"
	case connectrpc.InteractionCloudSQL:
		return "cloudsql"
	case connectrpc.InteractionRunExtensionCode:
		return "run_extension_code"
	case connectrpc.InteractionBrowserAction,
		connectrpc.InteractionExecuteBrowserJS,
		connectrpc.InteractionCaptureScreenshot,
		connectrpc.InteractionClickPixel,
		connectrpc.InteractionOpenBrowserSetup,
		connectrpc.InteractionConfirmBrowserSetup:
		return "browser_action"
	case connectrpc.InteractionElicitation:
		return "elicitation"
	case connectrpc.InteractionAskQuestion:
		return "ask_question"
	default:
		return "approval"
	}
}
