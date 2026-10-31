package adb

import (
	"context"
	"strings"
	"testing"
)

type mockRunner struct {
	lastArgs []string
	output   []byte
	err      error
}

func (m *mockRunner) Run(ctx context.Context, args ...string) ([]byte, error) {
	m.lastArgs = args
	return m.output, m.err
}

func TestSanitizePath(t *testing.T) {
	tests := []struct {
		input   string
		valid   bool
		contain string
	}{
		{"/sdcard/DCIM/Camera", true, "/sdcard/DCIM/Camera"},
		{"sdcard/Download/file.pdf", true, "/sdcard/Download/file.pdf"},
		{"/sdcard/test; rm -rf /", false, "caractère interdit"},
		{"/sdcard/test | cat /etc/passwd", false, "caractère interdit"},
		{"/sdcard/test`whoami`", false, "caractère interdit"},
		{"/sdcard/test$PATH", false, "caractère interdit"},
		{"", false, "chemin distant vide"},
	}

	for _, tt := range tests {
		clean, err := sanitizePath(tt.input)
		if tt.valid && err != nil {
			t.Errorf("sanitizePath(%q) unexpected error: %v", tt.input, err)
		}
		if !tt.valid && err == nil {
			t.Errorf("sanitizePath(%q) expected error, got nil (%q)", tt.input, clean)
		}
		if !tt.valid && err != nil && !strings.Contains(err.Error(), tt.contain) {
			t.Errorf("sanitizePath(%q) error %q does not contain %q", tt.input, err.Error(), tt.contain)
		}
	}
}

func TestParseDevicesOutput(t *testing.T) {
	sample := `List of devices attached
RFCT123456X            device product:r8qxxx model:SM_G781B device:r8q transport_id:1
emulator-5554          offline transport_id:2
`
	devs := ParseDevicesOutput([]byte(sample))
	if len(devs) != 2 {
		t.Fatalf("expected 2 devices, got %d", len(devs))
	}
	if devs[0].ID != "RFCT123456X" || devs[0].State != "device" || devs[0].Model != "SM_G781B" {
		t.Errorf("unexpected dev 0: %+v", devs[0])
	}
	if devs[1].ID != "emulator-5554" || devs[1].State != "offline" {
		t.Errorf("unexpected dev 1: %+v", devs[1])
	}
}

func TestParseLsOutput(t *testing.T) {
	sample := `total 16
drwxrwx--x  4 root sdcard_rw 4096 2026-08-16 12:00 DCIM
drwxrwx--x  2 root sdcard_rw 4096 2026-08-16 12:00 Download
-rw-rw----  1 u0_a123 sdcard_rw 1048576 2026-08-16 12:00 document.pdf
lrwxrwxrwx  1 root root 11 2026-08-16 12:00 shortcut -> /sdcard/DCIM
`
	entries := ParseLsOutput("/sdcard", []byte(sample))
	if len(entries) != 4 {
		t.Fatalf("expected 4 entries, got %d", len(entries))
	}
	if entries[0].Name != "DCIM" || !entries[0].IsDir || entries[0].Path != "/sdcard/DCIM" {
		t.Errorf("unexpected entry 0: %+v", entries[0])
	}
	if entries[2].Name != "document.pdf" || entries[2].IsDir || entries[2].Size != 1048576 {
		t.Errorf("unexpected entry 2: %+v", entries[2])
	}
	if entries[3].Name != "shortcut" || entries[3].Path != "/sdcard/shortcut" {
		t.Errorf("unexpected entry 3: %+v", entries[3])
	}
}

func TestServiceOperations(t *testing.T) {
	mock := &mockRunner{
		output: []byte("RFCT123456X device model:SM_G781B transport_id:1\n"),
	}
	svc := NewService(mock)
	ctx := context.Background()

	devs, err := svc.ListDevices(ctx)
	if err != nil || len(devs) != 1 {
		t.Fatalf("ListDevices failed: %v, devs=%+v", err, devs)
	}

	// Pull file command verification
	mock.output = []byte("1 file pulled")
	err = svc.PullFile(ctx, "RFCT123456X", "/sdcard/DCIM/photo.jpg", "C:/tmp/photo.jpg")
	if err != nil {
		t.Fatalf("PullFile failed: %v", err)
	}
	joinedArgs := strings.Join(mock.lastArgs, " ")
	if joinedArgs != "-s RFCT123456X pull /sdcard/DCIM/photo.jpg C:\\tmp\\photo.jpg" &&
		joinedArgs != "-s RFCT123456X pull /sdcard/DCIM/photo.jpg C:/tmp/photo.jpg" {
		t.Errorf("Last args mismatch: got %q", joinedArgs)
	}
}
