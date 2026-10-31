//go:build !windows

package gateway

import (
	"bufio"
	"os"
	"runtime"
	"strconv"
	"strings"
)

var (
	prevTotalCPU uint64
	prevIdleCPU  uint64
	hasPrevCPU   bool
)

func collectHostStats() HostStats {
	var stats HostStats

	if runtime.GOOS == "linux" {
		// 1. RAM via /proc/meminfo
		if f, err := os.Open("/proc/meminfo"); err == nil {
			scanner := bufio.NewScanner(f)
			var totalKb, availKb int
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "MemTotal:") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						totalKb, _ = strconv.Atoi(fields[1])
					}
				} else if strings.HasPrefix(line, "MemAvailable:") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						availKb, _ = strconv.Atoi(fields[1])
					}
				}
			}
			_ = f.Close()
			if totalKb > 0 {
				stats.RAMTotalMb = totalKb / 1024
				stats.RAMUsedMb = (totalKb - availKb) / 1024
			}
		}

		// 2. CPU via /proc/stat
		if f, err := os.Open("/proc/stat"); err == nil {
			scanner := bufio.NewScanner(f)
			if scanner.Scan() {
				fields := strings.Fields(scanner.Text())
				if len(fields) >= 5 && fields[0] == "cpu" {
					var user, nice, system, idle, iowait, irq, softirq uint64
					user, _ = strconv.ParseUint(fields[1], 10, 64)
					nice, _ = strconv.ParseUint(fields[2], 10, 64)
					system, _ = strconv.ParseUint(fields[3], 10, 64)
					idle, _ = strconv.ParseUint(fields[4], 10, 64)
					if len(fields) > 5 {
						iowait, _ = strconv.ParseUint(fields[5], 10, 64)
					}
					if len(fields) > 6 {
						irq, _ = strconv.ParseUint(fields[6], 10, 64)
					}
					if len(fields) > 7 {
						softirq, _ = strconv.ParseUint(fields[7], 10, 64)
					}

					total := user + nice + system + idle + iowait + irq + softirq
					idleTotal := idle + iowait

					if hasPrevCPU {
						dTotal := total - prevTotalCPU
						dIdle := idleTotal - prevIdleCPU
						if dTotal > 0 && dTotal >= dIdle {
							stats.CPUPercent = int(float64(dTotal-dIdle)*100.0/float64(dTotal) + 0.5)
						}
					}
					prevTotalCPU = total
					prevIdleCPU = idleTotal
					hasPrevCPU = true
				}
			}
			_ = f.Close()
		}
	} else {
		// Fallback basique macOS
		stats.RAMTotalMb = 16384
		stats.RAMUsedMb = 8192
		stats.CPUPercent = 10
	}

	return stats
}
