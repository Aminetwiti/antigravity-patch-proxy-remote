/**
 * Manual protobuf encoding — no library (AGENTS.md: no protobuf dependency).
 * Wire format: varint fields (key = (fieldNum << 3) | wireType).
 * wireType 0 = varint, 2 = length-delimited.
 */

export class ProtoWriter {
  private bytes: number[] = [];

  private writeVarint(value: number): void {
    let v = value >>> 0;
    while (v >= 0x80) {
      this.bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.bytes.push(v);
  }

  varintField(fieldNum: number, value: number): this {
    this.writeVarint((fieldNum << 3) | 0);
    this.writeVarint(value >>> 0);
    return this;
  }

  stringField(fieldNum: number, value: string): this {
    const data = Buffer.from(value, 'utf8');
    this.writeVarint((fieldNum << 3) | 2);
    this.writeVarint(data.length);
    for (const b of data) this.bytes.push(b);
    return this;
  }

  bytesField(fieldNum: number, data: Uint8Array): this {
    this.writeVarint((fieldNum << 3) | 2);
    this.writeVarint(data.length);
    for (const b of data) this.bytes.push(b);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}

/** Decode a single varint at `offset`. Returns { value, nextOffset }. */
export function readVarint(buf: Buffer, offset: number): { value: number; nextOffset: number } {
  let result = 0;
  let shift = 0;
  while (true) {
    const byte = buf[offset];
    result |= (byte & 0x7f) << shift;
    offset++;
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 28) throw new Error('varint too long');
  }
  return { value: result >>> 0, nextOffset: offset };
}

export interface ProtoField {
  fieldNum: number;
  wireType: number;
  value: number | Uint8Array;
  offset: number;
}

/** Minimal decoder: iterate top-level fields. */
export function decodeFields(buf: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    const { value: key, nextOffset } = readVarint(buf, offset);
    offset = nextOffset;
    const fieldNum = key >>> 3;
    const wireType = key & 7;
    if (wireType === 0) {
      const { value, nextOffset: n } = readVarint(buf, offset);
      fields.push({ fieldNum, wireType, value, offset: start });
      offset = n;
    } else if (wireType === 2) {
      const { value: len, nextOffset: n } = readVarint(buf, offset);
      offset = n;
      const data = buf.subarray(offset, offset + len);
      fields.push({ fieldNum, wireType, value: data, offset: start });
      offset += len;
    } else {
      throw new Error(`unsupported wireType ${wireType} at offset ${start}`);
    }
  }
  return fields;
}
