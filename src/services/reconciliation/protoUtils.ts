export interface ParsedAnnotation {
  id: string;
  title?: string;
  archived: boolean;
  pinned: boolean;
  archivalSeconds?: number;
  archivalNanos?: number;
  viewSeconds?: number;
  viewNanos?: number;
}

export function encodeVarint(val: bigint | number): Buffer {
  let v = BigInt(val);
  const bytes: number[] = [];
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

export function readVarint(buf: Buffer, offset: number): { val: bigint; bytesRead: number } {
  let val = 0n;
  let shift = 0n;
  let bytesRead = 0;
  while (offset < buf.length) {
    const b = BigInt(buf[offset]);
    bytesRead++;
    val |= (b & 0x7fn) << shift;
    offset++;
    if ((b & 0x80n) === 0n) break;
    shift += 7n;
  }
  return { val, bytesRead };
}

export function encodeLengthDelimited(fieldNum: number, buf: Buffer): Buffer {
  const tag = encodeVarint((fieldNum << 3) | 2);
  const len = encodeVarint(buf.length);
  return Buffer.concat([tag, len, buf]);
}

export function encodeTimestamp(seconds: number, nanos?: number): Buffer {
  const parts: Buffer[] = [];
  if (seconds) {
    const secTag = encodeVarint((1 << 3) | 0);
    parts.push(Buffer.concat([secTag, encodeVarint(seconds)]));
  }
  if (nanos) {
    const nanoTag = encodeVarint((2 << 3) | 0);
    parts.push(Buffer.concat([nanoTag, encodeVarint(nanos)]));
  }
  return Buffer.concat(parts);
}

export function parsePbtxt(pbtxtContent: string, id: string): ParsedAnnotation {
  const res: ParsedAnnotation = {
    id,
    archived: /archived:\s*true/.test(pbtxtContent),
    pinned: /pinned:\s*true/.test(pbtxtContent),
  };
  const tm = pbtxtContent.match(/title:\s*"((?:\\.|[^"\\])*)"/);
  if (tm) res.title = tm[1];

  const am = pbtxtContent.match(/archival_status_timestamp:\s*\{\s*seconds:\s*(\d+)(?:\s+nanos:\s*(\d+))?\s*\}/);
  if (am) {
    res.archivalSeconds = Number(am[1]);
    res.archivalNanos = am[2] ? Number(am[2]) : 0;
  }

  const vm = pbtxtContent.match(/last_user_view_time:\s*\{\s*seconds:\s*(\d+)(?:\s+nanos:\s*(\d+))?\s*\}/);
  if (vm) {
    res.viewSeconds = Number(vm[1]);
    res.viewNanos = vm[2] ? Number(vm[2]) : 0;
  }

  return res;
}

export function encodeAnnotationsField(parsed: ParsedAnnotation): Buffer {
  const parts: Buffer[] = [];
  if (parsed.title) {
    parts.push(encodeLengthDelimited(1, Buffer.from(parsed.title, 'utf8')));
  }
  if (parsed.archived) {
    const tag = encodeVarint((4 << 3) | 0);
    parts.push(Buffer.concat([tag, Buffer.from([1])]));
  }
  if (parsed.archivalSeconds) {
    const tsBuf = encodeTimestamp(parsed.archivalSeconds, parsed.archivalNanos);
    parts.push(encodeLengthDelimited(5, tsBuf));
  }
  if (parsed.viewSeconds) {
    const tsBuf = encodeTimestamp(parsed.viewSeconds, parsed.viewNanos);
    parts.push(encodeLengthDelimited(7, tsBuf));
  }
  if (parsed.pinned) {
    const tag = encodeVarint((12 << 3) | 0);
    parts.push(Buffer.concat([tag, Buffer.from([1])]));
  }
  return encodeLengthDelimited(15, Buffer.concat(parts));
}

export function stripProtobufField(buf: Buffer, fieldNumberToStrip: number): Buffer {
  let offset = 0;
  const retainedChunks: Buffer[] = [];
  while (offset < buf.length) {
    const startOffset = offset;
    const { val: tag, bytesRead: tagBytes } = readVarint(buf, offset);
    offset += tagBytes;
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);

    let fieldEnd = offset;
    if (wireType === 0) {
      const { bytesRead: vBytes } = readVarint(buf, offset);
      offset += vBytes;
      fieldEnd = offset;
    } else if (wireType === 1) {
      offset += 8;
      fieldEnd = offset;
    } else if (wireType === 2) {
      const { val: len, bytesRead: lBytes } = readVarint(buf, offset);
      offset += lBytes + Number(len);
      fieldEnd = offset;
    } else if (wireType === 5) {
      offset += 4;
      fieldEnd = offset;
    } else {
      return buf;
    }

    if (fieldNum !== fieldNumberToStrip) {
      retainedChunks.push(buf.subarray(startOffset, fieldEnd));
    }
  }
  return Buffer.concat(retainedChunks);
}
