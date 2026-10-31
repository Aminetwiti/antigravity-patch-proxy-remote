//go:build !windows

package notification

// sendWindowsToast is a no-op on non-Windows platforms.
// The runtime.GOOS switch in SendNotification already guards the call path,
// but the compiler still needs the symbol to exist.
func sendWindowsToast(_, _ string) {}
