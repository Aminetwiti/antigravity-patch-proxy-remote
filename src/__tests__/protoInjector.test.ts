import { describe, it, expect } from 'vitest';
import {
  injectCustomModelsIntoResponse,
  buildGrpcWebFrame,
  parseGrpcWebHeader,
} from '../proxy/protoInjector';
import { encodeProtoBuf, encodeVarint } from '../proxy/protobuf';
import type { CustomModel } from '../proxy/types';

describe('buildGrpcWebFrame', () => {
  it('builds a valid gRPC-Web frame', () => {
    const body = Buffer.from('hello');
    const frame = buildGrpcWebFrame(0, body);
    expect(frame.length).toBe(5 + body.length);
    expect(frame[0]).toBe(0);
    expect(frame.readUInt32BE(1)).toBe(body.length);
    expect(frame.subarray(5).toString()).toBe('hello');
  });

  it('preserves flags byte', () => {
    const frame = buildGrpcWebFrame(0x80, Buffer.alloc(0));
    expect(frame[0]).toBe(0x80);
  });

  it('handles empty body', () => {
    const frame = buildGrpcWebFrame(0, Buffer.alloc(0));
    expect(frame.length).toBe(5);
    expect(frame.readUInt32BE(1)).toBe(0);
  });

  it('handles large body', () => {
    const body = Buffer.alloc(10_000, 0x42);
    const frame = buildGrpcWebFrame(0, body);
    expect(frame.length).toBe(10_005);
    expect(frame.readUInt32BE(1)).toBe(10_000);
  });
});

describe('parseGrpcWebHeader', () => {
  it('parses a valid header', () => {
    const buf = Buffer.alloc(10);
    buf[0] = 0x42;
    buf.writeUInt32BE(123, 1);
    const result = parseGrpcWebHeader(buf);
    expect(result).toEqual({ flags: 0x42, msgLen: 123 });
  });

  it('returns null for buffer shorter than 5 bytes', () => {
    expect(parseGrpcWebHeader(Buffer.alloc(4))).toBeNull();
    expect(parseGrpcWebHeader(Buffer.alloc(0))).toBeNull();
  });

  it('handles 5-byte buffer', () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x05]);
    const result = parseGrpcWebHeader(buf);
    expect(result).toEqual({ flags: 0, msgLen: 5 });
  });

  it('round-trips with buildGrpcWebFrame', () => {
    const body = Buffer.from('test message');
    const frame = buildGrpcWebFrame(0x01, body);
    const parsed = parseGrpcWebHeader(frame);
    expect(parsed).toEqual({ flags: 0x01, msgLen: body.length });
    expect(frame.subarray(5).toString()).toBe('test message');
  });
});

describe('injectCustomModelsIntoResponse', () => {
  const baseModel: CustomModel = {
    name: 'models/gpt-4o',
    displayName: 'GPT-4o (OpenAI)',
    provider: 'openai',
    apiKey: 'sk-test',
    apiUrl: 'https://api.openai.com/v1',
    externalModelName: 'gpt-4o',
  };

  // Helper: build a valid gRPC-Web response with a single repeated model entry field
  function buildSampleResponse(): Buffer {
    // Build a message with field 3 (tag=0x1a) repeated 2 times with nested fields
    const entry1 = encodeProtoBuf([
      { tag: 0x0a, value: Buffer.from('gemini-pro') },
      { tag: 0x12, value: Buffer.from('Gemini Pro') },
    ]);
    const entry2 = encodeProtoBuf([
      { tag: 0x0a, value: Buffer.from('gemini-flash') },
      { tag: 0x12, value: Buffer.from('Gemini Flash') },
    ]);

    const msgBody = Buffer.concat([
      encodeVarint(0x1a),
      encodeVarint(entry1.length),
      entry1,
      encodeVarint(0x1a),
      encodeVarint(entry2.length),
      entry2,
    ]);

    return buildGrpcWebFrame(0, msgBody);
  }

  it('returns original buffer when no custom models', () => {
    const response = buildSampleResponse();
    const result = injectCustomModelsIntoResponse(response, []);
    expect(result.modified).toBe(false);
    expect(result.injectedCount).toBe(0);
    expect(result.buffer).toBe(response);
  });

  it('returns original buffer when response too small', () => {
    const response = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
    const result = injectCustomModelsIntoResponse(response, [baseModel]);
    expect(result.modified).toBe(false);
    expect(result.injectedCount).toBe(0);
  });

  it('injects a single custom model', () => {
    const response = buildSampleResponse();
    const result = injectCustomModelsIntoResponse(response, [baseModel]);
    expect(result.modified).toBe(true);
    expect(result.injectedCount).toBe(1);
    expect(result.buffer.length).toBeGreaterThan(response.length);
  });

  it('injects multiple custom models', () => {
    const response = buildSampleResponse();
    const models = [
      baseModel,
      { ...baseModel, name: 'models/claude', displayName: 'Claude' },
      { ...baseModel, name: 'models/llama', displayName: 'Llama' },
    ];
    const result = injectCustomModelsIntoResponse(response, models);
    expect(result.modified).toBe(true);
    expect(result.injectedCount).toBe(3);
  });

  it('preserves flags byte in modified buffer', () => {
    const response = buildSampleResponse();
    response[0] = 0x42;
    const result = injectCustomModelsIntoResponse(response, [baseModel]);
    expect(result.buffer[0]).toBe(0x42);
  });

  it('updates length header correctly', () => {
    const response = buildSampleResponse();
    const result = injectCustomModelsIntoResponse(response, [baseModel]);
    const newHeader = parseGrpcWebHeader(result.buffer);
    expect(newHeader).not.toBeNull();
    // Length should match the body that follows the header
    expect(newHeader!.msgLen).toBe(result.buffer.length - 5);
  });

  it('returns original buffer when msgLen exceeds buffer length', () => {
    const response = Buffer.alloc(10);
    response[0] = 0;
    response.writeUInt32BE(1000, 1); // Claim 1000 bytes but buffer is only 10
    const result = injectCustomModelsIntoResponse(response, [baseModel]);
    expect(result.modified).toBe(false);
  });

  it('returns original buffer when no repeated model field found', () => {
    // Build a message with only varint fields (no nested repeated entries)
    const msgBody = encodeProtoBuf([
      { tag: 0x08, value: encodeVarint(42) },
    ]);
    const response = buildGrpcWebFrame(0, msgBody);
    const result = injectCustomModelsIntoResponse(response, [baseModel]);
    expect(result.modified).toBe(false);
    expect(result.injectedCount).toBe(0);
  });
});
