package gateway

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestRunningTasksConcurrencyRace teste l'absence totale de data races et deadlocks
// lors d'accès hautement concurrents à runningTaskManager.
func TestRunningTasksConcurrencyRace(t *testing.T) {
	mgr := newRunningTaskManager()
	var broadcastCount int64
	mgr.onBroadcast = func(msg OutgoingMessage) {
		atomic.AddInt64(&broadcastCount, 1)
		// Simuler un léger délai de sérialisation / transport réseau
		time.Sleep(100 * time.Microsecond)
	}

	var wg sync.WaitGroup
	const numGoroutines = 50
	const numOps = 20

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(gID int) {
			defer wg.Done()
			taskID := fmt.Sprintf("task_%d", gID%10)

			for op := 0; op < numOps; op++ {
				switch op % 5 {
				case 0:
					mgr.startTask(taskID, "npm test", "casc-1", nil)
				case 1:
					mgr.appendOutput(taskID, fmt.Sprintf("chunk-%d-%d\n", gID, op))
				case 2:
					_ = mgr.listTasks(true)
					_ = mgr.listTasks(false)
				case 3:
					if op%2 == 0 {
						mgr.finishTask(taskID, "completed")
					} else {
						mgr.killTask(taskID)
					}
				case 4:
					mgr.startTask(taskID, "npm build", "casc-1", nil)
				}
			}
		}(i)
	}

	wg.Wait()

	// Vérifier que la mémoire reste bornée
	mgr.mu.RLock()
	totalTasks := len(mgr.tasks)
	mgr.mu.RUnlock()

	if totalTasks > 100 {
		t.Errorf("Fuite mémoire détectée : %d tâches en mémoire", totalTasks)
	}
}

// TestRunningTasksIdempotence vérifie que startTask répété ne réinitialise pas la tâche
// et n'émet pas de messages task_started en boucle.
func TestRunningTasksIdempotence(t *testing.T) {
	mgr := newRunningTaskManager()
	var startedEvents int64
	mgr.onBroadcast = func(msg OutgoingMessage) {
		if msg.Type == "task_started" {
			atomic.AddInt64(&startedEvents, 1)
		}
	}

	task1, created1 := mgr.startTask("task-A", "git status", "casc-1", nil)
	if !created1 {
		t.Fatalf("Attendu created=true pour le premier appel")
	}

	// Deuxième appel avec le même ID pendant que la tâche tourne
	task2, created2 := mgr.startTask("task-A", "git status", "casc-1", nil)
	if created2 {
		t.Errorf("startTask ne doit pas recréer une tâche active existante")
	}
	if task1 != task2 {
		t.Errorf("Attendu même pointeur de tâche")
	}
	if startedEvents != 1 {
		t.Errorf("Attendu 1 seul événement task_started, reçu: %d", startedEvents)
	}
}

// TestRunningTasksKillProtection vérifie qu'une tâche tuée (killed) ne peut pas être
// écrasée par un finishTask tardif ni recevoir d'appendOutput post-mortem.
func TestRunningTasksKillProtection(t *testing.T) {
	mgr := newRunningTaskManager()
	var cancelled atomic.Bool
	cancelFunc := func() {
		cancelled.Store(true)
	}

	mgr.startTask("task-B", "python run.py", "casc-2", cancelFunc)

	// Tuer la tâche
	ok := mgr.killTask("task-B")
	if !ok {
		t.Fatalf("killTask a échoué")
	}
	if !cancelled.Load() {
		t.Errorf("Le cancelFunc n'a pas été appelé lors du killTask")
	}

	// Tentative d'appendOutput après kill -> doit être ignoré
	mgr.appendOutput("task-B", "output post mortem")

	// Tentative de finishTask après kill -> ne doit pas écraser le statut "killed"
	mgr.finishTask("task-B", "completed")

	tasks := mgr.listTasks(false)
	var found *RunningTaskInfo
	for _, t := range tasks {
		if t.ID == "task-B" {
			tCopy := t
			found = &tCopy
			break
		}
	}

	if found == nil {
		t.Fatalf("Tâche introuvable")
	}
	if found.Status != "killed" {
		t.Errorf("Le statut 'killed' a été écrasé par '%s'", found.Status)
	}
	if found.Output != "" {
		t.Errorf("Output post-mortem non ignoré: %q", found.Output)
	}
}

// TestRunningTasksFifoEviction vérifie que les anciennes tâches terminées sont purgées.
func TestRunningTasksFifoEviction(t *testing.T) {
	mgr := newRunningTaskManager()
	mgr.maxFinished = 5

	for i := 0; i < 15; i++ {
		id := fmt.Sprintf("task-%d", i)
		mgr.startTask(id, "echo hello", "casc-1", nil)
		mgr.finishTask(id, "completed")
	}

	all := mgr.listTasks(false)
	if len(all) > 5 {
		t.Errorf("Rétention dépassée : %d tâches présentes (max 5)", len(all))
	}
}

// TestRunningTasksCascadeIsolation vérifie que listTasksForCascade isole strictement
// les tâches actives par session (cascadeId).
func TestRunningTasksCascadeIsolation(t *testing.T) {
	mgr := newRunningTaskManager()

	mgr.startTask("task-1", "npm test", "session-A", nil)
	mgr.startTask("task-2", "go build", "session-A", nil)
	mgr.startTask("task-3", "python script.py", "session-B", nil)

	tasksA := mgr.listTasksForCascade("session-A", true)
	if len(tasksA) != 2 {
		t.Fatalf("Attendu 2 tâches pour session-A, obtenu %d", len(tasksA))
	}
	for _, task := range tasksA {
		if task.CascadeID != "session-A" {
			t.Errorf("Tâche de cascade incorrecte dans session-A: %s", task.CascadeID)
		}
	}

	tasksB := mgr.listTasksForCascade("session-B", true)
	if len(tasksB) != 1 {
		t.Fatalf("Attendu 1 tâche pour session-B, obtenu %d", len(tasksB))
	}
	if tasksB[0].ID != "task-3" {
		t.Errorf("Tâche inattendue pour session-B: %s", tasksB[0].ID)
	}

	tasksC := mgr.listTasksForCascade("session-C", true)
	if len(tasksC) != 0 {
		t.Fatalf("Attendu 0 tâche pour session-C, obtenu %d", len(tasksC))
	}
}

