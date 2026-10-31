package gateway

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// Scheduler est un moteur cron minimaliste, stdlib-only (aucune dÃ©pendance
// externe â€” rÃ¨gle AGENTS.md). Il parcourt les ScheduledTask enregistrÃ©es par
// le daemon toutes les tickInterval et dÃ©clenche celles dont l'expression
// cron correspond Ã  l'instant courant.
//
// ponytail: horizon bornÃ© volontairement â€” pas de rattrapage de runs manquÃ©s
// pendant que le daemon Ã©tait Ã©teint (un daemon qui redÃ©marre ne rejoue pas
// les crons passÃ©s, il repart sur le prochain tick). Upgrade path: persister
// lastRunAt + timezone par tÃ¢che si le rattrapage devient un besoin rÃ©el.
// quotaPushInterval : cadence de push des quotas vers les clients mobiles.
// AlignÃ© sur l'ancien timer mobile de 60 s â€” le daemon pousse dÃ©sormais Ã  la
// place du polling (1 appel LS/min max, et seulement si des clients sont lÃ ).
type Scheduler struct {
	server        *Server
	tickInterval  time.Duration
	lastQuotaPush time.Time
	stopCh        chan struct{}
	doneCh        chan struct{}
}

// NewScheduler crÃ©e un scheduler liÃ© au serveur. Ne dÃ©marre rien tant que
// Start() n'est pas appelÃ©.
func NewScheduler(server *Server) *Scheduler {
	return &Scheduler{
		server:       server,
		tickInterval: 30 * time.Second,
		stopCh:       make(chan struct{}),
		doneCh:       make(chan struct{}),
	}
}

// Start lance la boucle de tick en arriÃ¨re-plan.
func (sc *Scheduler) Start() {
	go func() {
		defer close(sc.doneCh)
		ticker := time.NewTicker(sc.tickInterval)
		defer ticker.Stop()
		for {
			select {
			case <-sc.stopCh:
				return
			case now := <-ticker.C:
				sc.tick(now)
			}
		}
	}()
}

// Stop arrÃªte la boucle de tick (bloquant jusqu'Ã  la sortie de la goroutine).
func (sc *Scheduler) Stop() {
	close(sc.stopCh)
	<-sc.doneCh
}

// tick examine toutes les tÃ¢ches une fois par tick. Les tÃ¢ches dÃ©sactivÃ©es ou
// invalides sont ignorÃ©es silencieusement ; une tÃ¢che Ã©ligible est exÃ©cutÃ©e en
// arriÃ¨re-plan (goroutine) pour ne jamais bloquer le tick suivant.
func (sc *Scheduler) tick(now time.Time) {
	sc.maybePushQuota(now)

	nowMinute := now.Unix() / 60
	sc.server.mu.Lock()
	tasks := make([]*ScheduledTask, 0, len(sc.server.scheduledTasks))
	for _, t := range sc.server.scheduledTasks {
		tasks = append(tasks, t)
	}
	sc.server.mu.Unlock()

	for _, task := range tasks {
		if task == nil || !task.IsEnabled {
			continue
		}
		if task.LastRunMinute == nowMinute {
			continue
		}
		if !cronMatches(task.CronExpression, now) {
			continue
		}
		task.LastRunMinute = nowMinute
		logJSON.Info("scheduled_task_fire", "taskId", task.ID, "cron", task.CronExpression)
		go sc.server.runScheduledTask(task.ID)
	}
}

// maybePushQuota diffuse les quotas aux clients connectÃ©s au plus toutes les
// quotaPushInterval. Sans client, on ne martÃ¨le pas le LS. tick est appelÃ©
// depuis la goroutine unique du scheduler â†’ pas de course sur lastQuotaPush.
func (sc *Scheduler) maybePushQuota(now time.Time) {
	if now.Sub(sc.lastQuotaPush) < quotaPushInterval {
		return
	}
	sc.lastQuotaPush = now
	sc.server.mu.Lock()
	clients := len(sc.server.clients)
	sc.server.mu.Unlock()
	if clients == 0 {
		return
	}
	go sc.server.pushQuotaUpdate()
}

// cronMatches Ã©value une expression cron 5 champs (minute heure jour-mois
// mois jour-semaine) Ã  l'instant donnÃ©, UTC. `?` est acceptÃ© comme alias de
// `*` (compatibilitÃ© Quartz, trÃ¨s rÃ©pandue dans les UI de cron).
func cronMatches(expr string, now time.Time) bool {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return false
	}
	ok := cronField(fields[0], now.Minute(), 0, 59) &&
		cronField(fields[1], now.Hour(), 0, 23) &&
		cronField(fields[2], now.Day(), 1, 31) &&
		cronField(fields[3], int(now.Month()), 1, 12) &&
		cronField(fields[4], int(now.Weekday()), 0, 6)
	return ok
}

// cronField teste si la valeur v appartient au champ cron (liste, plage,
// step, * ou ?).
func cronField(field string, v, min, max int) bool {
	field = strings.TrimSpace(field)
	if field == "" || field == "*" || field == "?" {
		return true
	}
	for _, part := range strings.Split(field, ",") {
		if cronPart(part, v, min, max) {
			return true
		}
	}
	return false
}

// cronPart teste une seule composante : "n", "a-b", "*/n" ou "a-b/n".
func cronPart(part string, v, min, max int) bool {
	step := 1
	if i := strings.Index(part, "/"); i >= 0 {
		s, err := strconv.Atoi(part[i+1:])
		if err != nil || s <= 0 {
			return false
		}
		step = s
		part = part[:i]
	}
	lo, hi := min, max
	if part != "*" {
		if i := strings.Index(part, "-"); i >= 0 {
			a, errA := strconv.Atoi(part[:i])
			b, errB := strconv.Atoi(part[i+1:])
			if errA != nil || errB != nil || a < min || b > max || a > b {
				return false
			}
			lo, hi = a, b
		} else {
			n, err := strconv.Atoi(part)
			if err != nil || n < min || n > max {
				return false
			}
			lo, hi = n, n
		}
	}
	if v < lo || v > hi {
		return false
	}
	return (v-lo)%step == 0
}

// runScheduledTask exÃ©cute une tÃ¢che : crÃ©e une cascade sur le workspace de la
// tÃ¢che, y envoie le prompt (streaming best-effort), puis journalise un
// Ã©vÃ©nement scheduled_task_event diffusÃ© Ã  tous les clients (le mobile met Ã 
// jour son historique). Le prompt est exÃ©cutÃ© avec l'auto-approbation de la
// tÃ¢che quand celle-ci le demande â€” voir runScheduledTaskApproval.
func (s *Server) runScheduledTask(taskID string) {
	s.mu.Lock()
	task, exists := s.scheduledTasks[taskID]
	if !exists || !task.IsEnabled {
		s.mu.Unlock()
		return
	}
	taskCopy := *task
	s.mu.Unlock()

	start := time.Now()
	event := ScheduledTaskEvent{
		ID:        fmt.Sprintf("evt_%d", time.Now().UnixMilli()),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	// ponytail: les tÃ¢ches headless (IsDaemon=true, exÃ©cutÃ©es par le cron
	// sans client) ne peuvent pas attendre une approbation â€” on les auto-approuve.
	if err := s.executeTaskPrompt(taskCopy); err != nil {
		event.Outcome = "error"
		event.Message = err.Error()
	} else {
		event.Outcome = "done"
		event.Message = "exÃ©cutÃ© par le scheduler"
	}
	event.DurationMs = int(time.Since(start).Milliseconds())

	s.mu.Lock()
	if current, still := s.scheduledTasks[taskID]; still {
		current.IterationsRun++
		current.NextRunAt = nextRunAt(current.CronExpression)
		current.Events = append(current.Events, event)
		current.Status = "Running"
	}
	taskRef := s.scheduledTasks[taskID]
	s.mu.Unlock()
	// Persistance best-effort : sans ce Save, IterationsRun/NextRunAt/Events
	// restent en mÃ©moire seule et l'historique disparaÃ®t au redÃ©marrage du
	// daemon (le mobile afficherait 0 exÃ©cution aprÃ¨s reboot).
	if err := s.SaveScheduledTasks(); err != nil {
		logJSON.Warn("scheduled_tasks_save_failed", "taskId", taskID, "error", err.Error())
	}
	if taskRef != nil {
		data := map[string]interface{}{"task": taskRef, "event": event}
		// P1 : le mobile notifie Â« TÃ¢che dÃ©marrÃ©e Â» pour les exÃ©cutions
		// planifiÃ©es â€” le taskStarted=true permet au mobile de ne notifier que
		// les Ã©vÃ©nements rÃ©ellement dÃ©clenchÃ©s par le cron/trigger.
		data["taskStarted"] = true
		s.broadcast(OutgoingMessage{
			Type: "scheduled_task_event",
			Data: data,
		})
	}
}

// executeTaskPrompt crÃ©e la cascade et envoie le prompt (best-effort). En cas
// d'Ã©chec de crÃ©ation de cascade, l'Ã©vÃ©nement porte l'erreur.
//
// La cascade crÃ©Ã©e est enregistrÃ©e dans activeCancels : une suppression de
// cascade (delete_cascade â†’ purgeCascadeState) ou un CancelGeneration doit
// pouvoir interrompre le stream de la tÃ¢che, sinon la goroutine reste bloquÃ©e
// jusqu'au timeout rÃ©seau (120 s) â€” goroutine fantÃ´me.
func (s *Server) executeTaskPrompt(task ScheduledTask) error {
	if strings.TrimSpace(task.Prompt) == "" {
		return fmt.Errorf("prompt vide pour la tâche %s", task.ID)
	}
	uri := toWorkspaceURI(task.WorkspaceName)
	projectID, _ := s.cachedProjectID(uri)
	raw, err := s.RPCClient.CreateCascade(uri, projectID, "", connectrpcDefaultModelEnum())
	if err != nil {
		return err
	}
	cascadeID := extractCascadeID(raw)
	if cascadeID == "" {
		return fmt.Errorf("cascadeID vide dans la rÃ©ponse CreateCascade")
	}

	// ctx annulable : purgeCascadeState / CancelGeneration / daemon stop
	// peuvent couper le stream headless immÃ©diatement au lieu d'attendre 120 s.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	schedReqID := "scheduled:" + task.ID
	s.mu.Lock()
	if s.activeCancels[cascadeID] == nil {
		s.activeCancels[cascadeID] = make(map[string]context.CancelFunc)
	}
	s.activeCancels[cascadeID][schedReqID] = cancel
	s.activeRequestIDs[cascadeID] = schedReqID
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if m, ok := s.activeCancels[cascadeID]; ok {
			delete(m, schedReqID)
			if len(m) == 0 {
				delete(s.activeCancels, cascadeID)
			}
		}
		if s.activeRequestIDs[cascadeID] == schedReqID {
			delete(s.activeRequestIDs, cascadeID)
		}
		s.mu.Unlock()
	}()

	err = s.RPCClient.SendMessageStream(cascadeID, task.Prompt, func([]byte) error {
		select {
		case <-ctx.Done():
			return fmt.Errorf("generation cancelled")
		default:
			return nil
		}
	})
	if err != nil {
		return err
	}
	return nil
}

// nextRunAt calcule la prochaine occurrence de l'expression cron dans les 48h
// (bornÃ© â€” on ne simule jamais un an de ticks). Vide si l'expression est
// invalide ou sans occurrence dans l'horizon.
func nextRunAt(expr string) string {
	now := time.Now().UTC().Truncate(time.Minute).Add(time.Minute)
	for i := 0; i < 48*60; i++ {
		candidate := now.Add(time.Duration(i) * time.Minute)
		if cronMatches(expr, candidate) {
			return candidate.Format(time.RFC3339)
		}
	}
	return ""
}

// extractCascadeID décode l'ID de cascade depuis la réponse protobuf brute de
// CreateCascade. Best-effort : champ #1 length-delimited = l'ID textuel.
func extractCascadeID(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	body := raw
	// Frame gRPC-Web : 1 octet de flags + 4 octets de longueur big-endian.
	if len(body) > 5 && (body[0] == 0 || body[0]&0x80 != 0) {
		body = body[5:]
	}
	fields := connectrpc.DecodeFields(body)
	for _, f := range fields {
		if f.Num == 1 && f.WireType == 2 && len(f.Bytes) > 0 {
			return string(f.Bytes)
		}
	}
	return ""
}

// connectrpcDefaultModelEnum est le repli du modèle par défaut quand le
// scheduler exécute une tâche sans sélection explicite de modèle.
func connectrpcDefaultModelEnum() uint64 {
	return connectrpc.DefaultModelEnum
}
