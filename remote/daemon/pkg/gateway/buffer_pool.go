package gateway

import "sync"

// bufferPools encapsule les pools de réutilisation mémoire pour éliminer les allocations massives sur le heap.
var (
	// historyBufferPool recycle les grands buffers de 10 Mo pour le parsing des gros transcripts JSONL.
	historyBufferPool = sync.Pool{
		New: func() interface{} {
			b := make([]byte, 10*1024*1024)
			return &b
		},
	}

	// rpcFramePool recycle les buffers de 32 Ko pour les frames réseau gRPC-Web et WebSocket.
	rpcFramePool = sync.Pool{
		New: func() interface{} {
			b := make([]byte, 32768)
			return &b
		},
	}
)

// AcquireHistoryBuffer obtient un buffer de 10 Mo réutilisable du pool.
func AcquireHistoryBuffer() *[]byte {
	return historyBufferPool.Get().(*[]byte)
}

// ReleaseHistoryBuffer remet le buffer dans le pool pour les futures requêtes.
func ReleaseHistoryBuffer(buf *[]byte) {
	if buf != nil {
		historyBufferPool.Put(buf)
	}
}

// AcquireRPCFrameBuffer obtient un buffer de 32 Ko réutilisable du pool.
func AcquireRPCFrameBuffer() *[]byte {
	return rpcFramePool.Get().(*[]byte)
}

// ReleaseRPCFrameBuffer remet le buffer de 32 Ko dans le pool.
func ReleaseRPCFrameBuffer(buf *[]byte) {
	if buf != nil {
		rpcFramePool.Put(buf)
	}
}
