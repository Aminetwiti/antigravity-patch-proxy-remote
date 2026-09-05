/**
 * Protobuf encoding/decoding utilities for the GetAvailableModels proxy handler.
 * Google Cloud Code uses gRPC-Web which wraps protobuf messages with a 5-byte header:
 *   - byte 0: flags (usually 0)
 *   - bytes 1-4: message length (big-endian uint32)
 *   - bytes 5+: protobuf-encoded message
 */

export interface ProtoField {
  /** Full tag (field_number << 3 | wire_type). */
  tag: number;
  /** Wire type (0=varint, 1=64-bit, 2=length-delimited, 5=32-bit). */
  wireType: number;
  /** Field number extracted from tag. */
  fieldNum: number;
  /** Decoded value: number, Buffer, or nested ProtoField array. */
  value: number | Buffer | ProtoField[];
  /** Start offset in source buffer. */
  start: number;
  /** End offset in source buffer (exclusive). */
  end: number;
}

export type ProtoFieldType = 'string' | 'varint' | 'bytes';

/**
 * Reads a varint from a buffer at the given offset.
 * @returns The decoded value and the number of bytes consumed.
 */
export function readVarint(buf: Buffer, offset: number): { value: number; bytes: number } {
  let result = 0;
  let shift = 0;
  let bytes = 0;
  while (offset + bytes < buf.length) {
    const byte = buf[offset + bytes];
    result |= (byte & 0x7f) << shift;
    bytes++;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return { value: result >>> 0, bytes };
}

/**
 * Encodes a number as a varint.
 */
export function encodeVarint(value: number): Buffer {
  const parts: number[] = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    parts.push(b);
  } while (v !== 0);
  return Buffer.from(parts);
}

/**
 * Parses a protobuf message into a tree of ProtoField nodes.
 */
export function parseProto(buf: Buffer, offset: number, end: number): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = offset;
  while (pos < end) {
    const start = pos;
    const tagVarint = readVarint(buf, pos);
    const tag = tagVarint.value;
    const wireType = tag & 0x07;
    const fieldNum = tag >>> 3;
    pos += tagVarint.bytes;

    if (wireType === 0) {
      const v = readVarint(buf, pos);
      fields.push({ tag, wireType, fieldNum, value: v.value, start, end: pos + v.bytes });
      pos += v.bytes;
    } else if (wireType === 2) {
      const lenVarint = readVarint(buf, pos);
      pos += lenVarint.bytes;
      const len = lenVarint.value;
      const children = parseProto(buf, pos, pos + len);
      const hasChildren = children.length > 0;
      fields.push({
        tag,
        wireType,
        fieldNum,
        value: hasChildren ? children : buf.subarray(pos, pos + len),
        start,
        end: pos + len,
      });
      pos += len;
    } else if (wireType === 1) {
      fields.push({ tag, wireType, fieldNum, value: buf.subarray(pos, pos + 8), start, end: pos + 8 });
      pos += 8;
    } else if (wireType === 5) {
      fields.push({ tag, wireType, fieldNum, value: buf.subarray(pos, pos + 4), start, end: pos + 4 });
      pos += 4;
    } else {
      break;
    }
  }
  return fields;
}

/**
 * Encodes a list of (tag, value) pairs as a length-delimited protobuf message.
 */
export function encodeProtoBuf(fields: { tag: number; value: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const tagBuf = encodeVarint(field.tag);
    const data = field.value;
    const lenBuf = encodeVarint(data.length);
    parts.push(tagBuf, lenBuf, data);
  }
  return Buffer.concat(parts);
}

/**
 * Finds the most likely "model entry" field tag in a parsed protobuf message.
 * Heuristic: the tag with the most repeated length-delimited fields that contain
 * nested messages is probably the repeated model entry field.
 */
export function findModelEntryFieldTag(fields: ProtoField[]): number | null {
  const tagCounts = new Map<number, number>();
  for (const f of fields) {
    if (f.wireType === 2) {
      tagCounts.set(f.tag, (tagCounts.get(f.tag) || 0) + 1);
    }
  }
  let bestTag: number | null = null;
  let bestCount = 0;
  for (const [tag, count] of tagCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestTag = tag;
    }
  }
  if (bestTag !== null && bestCount >= 2) {
    // Verify it has nested messages
    const sample = fields.find((f) => f.tag === bestTag && Array.isArray(f.value));
    if (sample) return bestTag;
  }
  return bestTag;
}

/**
 * Extracts the field type mapping from a sample model entry.
 * Used to encode new entries with the same schema as the upstream response.
 */
export function extractFieldMapping(entry: ProtoField[]): Map<number, ProtoFieldType> {
  const mapping = new Map<number, ProtoFieldType>();
  for (const f of entry) {
    if (f.wireType === 2 && Buffer.isBuffer(f.value)) {
      mapping.set(f.fieldNum, 'string');
    } else if (f.wireType === 0) {
      mapping.set(f.fieldNum, 'varint');
    } else if (f.wireType === 2 && Array.isArray(f.value)) {
      mapping.set(f.fieldNum, 'bytes');
    }
  }
  return mapping;
}

/**
 * Encodes a single model entry for the GetAvailableModels response.
 * Field 1 = name, Field 2 = displayName (by convention).
 */
export function encodeModelEntryForGetModels(
  name: string,
  displayName: string,
  mapping: Map<number, ProtoFieldType>,
  supportsImages: boolean = true,
): Buffer {
  const fields: { tag: number; value: Buffer }[] = [];
  for (const [fieldNum, protoType] of mapping) {
    if (protoType === 'string') {
      const tag = (fieldNum << 3) | 2;
      if (fieldNum === 1) {
        fields.push({ tag, value: Buffer.from(name, 'utf-8') });
      } else if (fieldNum === 2) {
        fields.push({ tag, value: Buffer.from(displayName, 'utf-8') });
      } else {
        fields.push({ tag, value: Buffer.alloc(0) });
      }
    } else if (protoType === 'varint') {
      const tag = (fieldNum << 3) | 0;
      if (fieldNum === 2 && supportsImages) {
        fields.push({ tag, value: encodeVarint(1) });
      } else if (fieldNum === 6) {
        fields.push({ tag, value: encodeVarint(1) });
      } else {
        fields.push({ tag, value: encodeVarint(0) });
      }
    } else {
      const tag = (fieldNum << 3) | 2;
      fields.push({ tag, value: Buffer.alloc(0) });
    }
  }
  return encodeProtoBuf(fields);
}

// ─── Raw Protobuf Utilities (used by GetUserStatus injection) ─────────────

export interface RawProtoField {
  tag: number;
  wireType: number;
  fieldNum: number;
  value?: number;
  raw?: Buffer;
  start: number;
  end: number;
}

/**
 * Parses protobuf fields at a single level without recursively assuming
 * length-delimited bytes are submessages. This avoids corrupting strings.
 */
export function parseProtoRaw(buf: Buffer, offset: number = 0, end: number = buf.length): RawProtoField[] {
  const fields: RawProtoField[] = [];
  let pos = offset;
  while (pos < end) {
    const start = pos;
    const tagVarint = readVarint(buf, pos);
    const tag = tagVarint.value;
    const wireType = tag & 0x07;
    const fieldNum = tag >>> 3;
    pos += tagVarint.bytes;

    if (wireType === 0) {
      const v = readVarint(buf, pos);
      fields.push({ tag, wireType, fieldNum, value: v.value, start, end: pos + v.bytes });
      pos += v.bytes;
    } else if (wireType === 2) {
      const lenVarint = readVarint(buf, pos);
      pos += lenVarint.bytes;
      const len = lenVarint.value;
      fields.push({ tag, wireType, fieldNum, raw: buf.subarray(pos, pos + len), start, end: pos + len });
      pos += len;
    } else if (wireType === 1) {
      fields.push({ tag, wireType, fieldNum, raw: buf.subarray(pos, pos + 8), start, end: pos + 8 });
      pos += 8;
    } else if (wireType === 5) {
      fields.push({ tag, wireType, fieldNum, raw: buf.subarray(pos, pos + 4), start, end: pos + 4 });
      pos += 4;
    } else {
      break;
    }
  }
  return fields;
}

export function encodeStringField(fieldNum: number, str: string): Buffer {
  const tagBuf = encodeVarint((fieldNum << 3) | 2);
  const strBuf = Buffer.from(str, 'utf8');
  const lenBuf = encodeVarint(strBuf.length);
  return Buffer.concat([tagBuf, lenBuf, strBuf]);
}

export function encodeVarintField(fieldNum: number, val: number): Buffer {
  const tagBuf = encodeVarint((fieldNum << 3) | 0);
  const valBuf = encodeVarint(val);
  return Buffer.concat([tagBuf, valBuf]);
}

export function encodeMessageField(fieldNum: number, msgBuf: Buffer): Buffer {
  const tagBuf = encodeVarint((fieldNum << 3) | 2);
  const lenBuf = encodeVarint(msgBuf.length);
  return Buffer.concat([tagBuf, lenBuf, msgBuf]);
}

const COMMON_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Encodes a ClientModelConfig protobuf message for Antigravity 2.5+ / 2.12+.
 */
export function encodeClientModelConfig(
  label: string,
  modelEnum: number,
  modelId: string,
  supportsImages: boolean,
  supportsThought: boolean,
): Buffer {
  const parts: Buffer[] = [];
  // field 1: label
  parts.push(encodeStringField(1, label));
  // field 2: model_or_alias -> field 1: model
  parts.push(encodeMessageField(2, encodeVarintField(1, modelEnum)));
  // field 5: supports_images
  if (supportsImages) {
    parts.push(encodeVarintField(5, 1));
  }
  // field 11: is_recommended
  parts.push(encodeVarintField(11, 1));
  // field 12: allowed_tiers (all tiers)
  parts.push(encodeMessageField(12, Buffer.from([0x02, 0x01, 0x05, 0x03, 0x04, 0x08])));
  // field 18: supported_mime_types (when images supported)
  if (supportsImages) {
    for (const mime of COMMON_IMAGE_MIMES) {
      const entry = Buffer.concat([encodeStringField(1, mime), encodeVarintField(2, 1)]);
      parts.push(encodeMessageField(18, entry));
    }
  }
  // field 19: supports_thought_circulation
  if (supportsThought) {
    parts.push(encodeVarintField(19, 1));
  }
  // field 21: model_id
  parts.push(encodeStringField(21, modelId));
  return Buffer.concat(parts);
}

