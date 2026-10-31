package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
)

// protodump — dump one step_payload blob (or raw bytes file) as a protobuf
// tree, hex-dumping opaque leaves so we can identify EXACTLY which bytes the
// IDE's step decoder expects to be able to parse.

func main() {
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: protodump [-start N] <file|hex> [<file|hex>...]\n")
	}
	flag.Parse()
	for _, arg := range flag.Args() {
		dumpFile(arg)
	}
}

func dumpFile(arg string) {
	var b []byte
	if data, err := os.ReadFile(arg); err == nil {
		b = data
	} else if hexStr, err := hex.DecodeString(strings.TrimSpace(arg)); err == nil {
		b = hexStr
	} else {
		fmt.Fprintf(os.Stderr, "cannot read %s: %v\n", arg, err)
		os.Exit(1)
	}
	fmt.Printf("===== %s (%d bytes) =====\n", arg, len(b))
	walk(b, 0, 8, 1<<20)
}

func readVarint(b []byte, i int) (uint64, int, bool) {
	var val uint64
	var shift uint
	for {
		if i >= len(b) {
			return 0, i, false
		}
		x := b[i]
		i++
		val |= uint64(x&0x7f) << shift
		if x&0x80 == 0 {
			return val, i, true
		}
		shift += 7
		if shift > 63 {
			return 0, i, false
		}
	}
}

func walk(b []byte, indent, maxdepth, limit int) {
	j := 0
	n := 0
	for j < len(b) && n < 200 {
		tag, j2, ok := readVarint(b, j)
		if !ok {
			break
		}
		j = j2
		fnum := tag >> 3
		wt := tag & 7
		n++
		switch wt {
		case 0:
			v, j3, ok := readVarint(b, j)
			if !ok {
				return
			}
			j = j3
			fmt.Printf("%s f%d varint=%d\n", strings.Repeat("  ", indent), fnum, v)
		case 1:
			if j+8 > len(b) {
				return
			}
			fmt.Printf("%s f%d fixed64=0x%x\n", strings.Repeat("  ", indent), fnum, b[j:j+8])
			j += 8
		case 2:
			l2, j3, ok := readVarint(b, j)
			if !ok {
				return
			}
			j = j3
			if uint64(j)+l2 > uint64(len(b)) {
				return
			}
			chunk := b[j : j+int(l2)]
			printable := len(chunk) > 2 && isPrintable(chunk)
			if printable && len(chunk) < 600 {
				fmt.Printf("%s f%d str len=%d: %q\n", strings.Repeat("  ", indent), fnum, l2, string(chunk))
			} else if indent < maxdepth && len(chunk) < limit && !printable && looksProtobuf(chunk) {
				fmt.Printf("%s f%d msg len=%d\n", strings.Repeat("  ", indent), fnum, l2)
				walk(chunk, indent+1, maxdepth, limit)
			} else {
				fmt.Printf("%s f%d bytes len=%d hex=%s\n", strings.Repeat("  ", indent), fnum, l2, hex.EncodeToString(chunk[:min(len(chunk), 48)]))
			}
			j += int(l2)
		case 5:
			if j+4 > len(b) {
				return
			}
			fmt.Printf("%s f%d fixed32=0x%x\n", strings.Repeat("  ", indent), fnum, b[j:j+4])
			j += 4
		default:
			fmt.Printf("%s f%d wt=%d at %d\n", strings.Repeat("  ", indent), fnum, wt, j)
			return
		}
	}
	// trailing bytes
	if j < len(b) {
		fmt.Printf("%s [trailing %d bytes] hex=%s\n", strings.Repeat("  ", indent), len(b)-j, hex.EncodeToString(b[j:min(len(b), j+32)]))
	}
	_ = sort.Ints
}

func isPrintable(b []byte) bool {
	for _, c := range b {
		if c < 32 && c != 9 && c != 10 && c != 13 {
			return false
		}
	}
	return true
}

// looksProtobuf: first byte is a plausible field tag (field 1..15, wt 0 or 2)
// and the length prefix is consistent with the buffer.
func looksProtobuf(b []byte) bool {
	if len(b) < 2 {
		return false
	}
	tag := b[0]
	fnum := tag >> 3
	wt := tag & 7
	if fnum == 0 || fnum > 15 || (wt != 0 && wt != 2) {
		return false
	}
	_, _, ok := readVarint(b, 1)
	return ok
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
