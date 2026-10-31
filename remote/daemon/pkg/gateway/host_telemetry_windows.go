//go:build windows

package gateway

import (
	"syscall"
	"unsafe"
)

var (
	modkernel32               = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMemoryStatusEx  = modkernel32.NewProc("GlobalMemoryStatusEx")
	procGetSystemTimes        = modkernel32.NewProc("GetSystemTimes")

	prevIdleTime   uint64
	prevKernelTime uint64
	prevUserTime   uint64
	hasPrevTimes   bool
)

type memorystatusex struct {
	cbSize                  uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

func fileTimeToUint64(ft *syscall.Filetime) uint64 {
	return (uint64(ft.HighDateTime) << 32) | uint64(ft.LowDateTime)
}

func collectHostStats() HostStats {
	var stats HostStats

	// 1. RAM via GlobalMemoryStatusEx
	var mem memorystatusex
	mem.cbSize = uint32(unsafe.Sizeof(mem))
	r1, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&mem)))
	if r1 != 0 {
		stats.RAMTotalMb = int(mem.ullTotalPhys / (1024 * 1024))
		availMb := int(mem.ullAvailPhys / (1024 * 1024))
		stats.RAMUsedMb = stats.RAMTotalMb - availMb
		if stats.RAMUsedMb < 0 {
			stats.RAMUsedMb = 0
		}
	}

	// 2. CPU via GetSystemTimes
	var idleTime, kernelTime, userTime syscall.Filetime
	r2, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleTime)),
		uintptr(unsafe.Pointer(&kernelTime)),
		uintptr(unsafe.Pointer(&userTime)),
	)
	if r2 != 0 {
		idle := fileTimeToUint64(&idleTime)
		kernel := fileTimeToUint64(&kernelTime)
		user := fileTimeToUint64(&userTime)

		if hasPrevTimes {
			dIdle := idle - prevIdleTime
			dKernel := kernel - prevKernelTime
			dUser := user - prevUserTime
			dTotal := dKernel + dUser

			if dTotal > 0 && dTotal >= dIdle {
				cpuPercent := float64(dTotal-dIdle) * 100.0 / float64(dTotal)
				stats.CPUPercent = int(cpuPercent + 0.5)
				if stats.CPUPercent > 100 {
					stats.CPUPercent = 100
				}
				if stats.CPUPercent < 0 {
					stats.CPUPercent = 0
				}
			}
		}

		prevIdleTime = idle
		prevKernelTime = kernel
		prevUserTime = user
		hasPrevTimes = true
	}

	return stats
}
