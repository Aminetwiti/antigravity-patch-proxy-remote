package gateway

import (
	"testing"
)

func TestBufferPool_AcquireRelease(t *testing.T) {
	// 1. History buffer pool
	buf1 := AcquireHistoryBuffer()
	if buf1 == nil || len(*buf1) != 10*1024*1024 {
		t.Fatalf("Expected 10MB history buffer, got %v", buf1)
	}
	(*buf1)[0] = 0x42
	ReleaseHistoryBuffer(buf1)

	buf2 := AcquireHistoryBuffer()
	if buf2 == nil || len(*buf2) != 10*1024*1024 {
		t.Fatalf("Expected 10MB history buffer on second acquire, got %v", buf2)
	}
	ReleaseHistoryBuffer(buf2)

	// 2. RPC frame buffer pool
	frame1 := AcquireRPCFrameBuffer()
	if frame1 == nil || len(*frame1) != 32768 {
		t.Fatalf("Expected 32KB RPC frame buffer, got %v", frame1)
	}
	ReleaseRPCFrameBuffer(frame1)

	frame2 := AcquireRPCFrameBuffer()
	if frame2 == nil || len(*frame2) != 32768 {
		t.Fatalf("Expected 32KB RPC frame buffer on second acquire, got %v", frame2)
	}
	ReleaseRPCFrameBuffer(frame2)
}
