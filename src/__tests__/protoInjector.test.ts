import { describe, it, expect } from 'vitest';
import {
  injectCustomModelsIntoResponse,
  injectCustomModelsIntoUserStatus,
  buildGrpcWebFrame,
  parseGrpcWebHeader,
} from '../proxy/protoInjector';
import {
  encodeProtoBuf,
  encodeVarint,
  parseProtoRaw,
  encodeMessageField,
  encodeStringField,
  encodeClientModelConfig,
} from '../proxy/protobuf';
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

describe('injectCustomModelsIntoUserStatus', () => {
  const baseModel: CustomModel = {
    name: 'custom-model-test',
    displayName: 'My Custom Model',
    provider: 'openai',
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    externalModelName: 'gpt-4o',
    supportsImages: true,
    thinking: true,
  };

  function buildSampleUserStatusResponse(): Buffer {
    // 1. client_model_config for a stock model
    const stockConfig = encodeClientModelConfig(
      'Stock Model 1',
      1001,
      'stock-model-1',
      false,
      false,
    );

    // 2. client_model_sorts
    const groupParts = [
      encodeStringField(1, ''),
      encodeStringField(2, 'Stock Model 1'),
    ];
    const sortParts = [
      encodeStringField(1, 'Recommended'),
      encodeMessageField(2, Buffer.concat(groupParts)),
    ];
    const stockSort = Buffer.concat(sortParts);

    // 3. cascade_model_config_data (field 33)
    const cascadeBody = Buffer.concat([
      encodeMessageField(1, stockConfig),
      encodeMessageField(2, stockSort),
    ]);

    // 4. user_status (field 1)
    const userStatusBody = Buffer.concat([
      encodeStringField(3, 'Test User'),
      encodeMessageField(33, cascadeBody),
    ]);

    // 5. top-level response
    const msgBody = encodeMessageField(1, userStatusBody);
    return buildGrpcWebFrame(0, msgBody);
  }

  it('returns original buffer when customModels is empty', () => {
    const response = buildSampleUserStatusResponse();
    const result = injectCustomModelsIntoUserStatus(response, []);
    expect(result.modified).toBe(false);
    expect(result.injectedCount).toBe(0);
  });

  it('returns original buffer for invalid or too short response', () => {
    const result = injectCustomModelsIntoUserStatus(Buffer.from([0, 1]), [baseModel]);
    expect(result.modified).toBe(false);
  });

  it('injects custom model into client_model_configs and sorts', () => {
    const response = buildSampleUserStatusResponse();
    const result = injectCustomModelsIntoUserStatus(response, [baseModel]);

    expect(result.modified).toBe(true);
    expect(result.injectedCount).toBe(1);

    // Parse the injected buffer to verify correctness
    const msgLen = result.buffer.readUInt32BE(1);
    const msgBody = result.buffer.subarray(5, 5 + msgLen);

    const topFields = parseProtoRaw(msgBody);
    const usField = topFields.find((f) => f.fieldNum === 1);
    expect(usField).toBeDefined();

    const usFields = parseProtoRaw(usField!.raw!);
    // Verify user name preserved
    const nameField = usFields.find((f) => f.fieldNum === 3);
    expect(nameField?.raw?.toString('utf8')).toBe('Test User');

    // Verify cascade data
    const cascadeField = usFields.find((f) => f.fieldNum === 33);
    expect(cascadeField).toBeDefined();

    const cascadeFields = parseProtoRaw(cascadeField!.raw!);
    const configs = cascadeFields.filter((f) => f.fieldNum === 1);
    expect(configs.length).toBe(2); // 1 stock + 1 custom

    // Check custom model config
    const customCfg = parseProtoRaw(configs[1].raw!);
    const labelField = customCfg.find((f) => f.fieldNum === 1);
    expect(labelField?.raw?.toString('utf8')).toContain('My Custom Model');

    const modelIdField = customCfg.find((f) => f.fieldNum === 21);
    expect(modelIdField?.raw?.toString('utf8')).toMatch(/^MODEL_PLACEHOLDER_M\d+$/);

    const imagesField = customCfg.find((f) => f.fieldNum === 5);
    expect(imagesField?.value).toBe(1);

    const thoughtField = customCfg.find((f) => f.fieldNum === 19);
    expect(thoughtField?.value).toBe(1);

    // Check sort labels
    const sorts = cascadeFields.filter((f) => f.fieldNum === 2);
    expect(sorts.length).toBe(1);
    const sortFields = parseProtoRaw(sorts[0].raw!);
    const groupField = sortFields.find((f) => f.fieldNum === 2);
    const groupSub = parseProtoRaw(groupField!.raw!);
    const labels = groupSub.filter((f) => f.fieldNum === 2).map((f) => f.raw?.toString('utf8'));
    expect(labels).toContain('Stock Model 1');
    expect(labels.some((l) => l?.includes('My Custom Model'))).toBe(true);
  });

  it('injects custom models into Connect-JSON userStatus response (Antigravity 2.12+)', () => {
    const jsonPayload = {
      userStatus: {
        name: 'Test User',
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              label: 'Stock Model 1',
              modelOrAlias: { model: 'MODEL_PLACEHOLDER_M100' },
              supportsImages: true,
            },
          ],
          clientModelSorts: [
            {
              name: 'Recommended',
              groups: [{ modelLabels: ['Stock Model 1'] }],
            },
          ],
        },
      },
    };

    const jsonBuf = Buffer.from(JSON.stringify(jsonPayload), 'utf8');
    const header = Buffer.alloc(5);
    header[0] = 0;
    header.writeUInt32BE(jsonBuf.length, 1);
    const framedBuf = Buffer.concat([header, jsonBuf]);

    const customModels: CustomModel[] = [
      {
        name: 'test-custom-model',
        displayName: 'My Custom Model',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        externalModelName: 'gpt-4o',
      },
    ];

    const result = injectCustomModelsIntoUserStatus(framedBuf, customModels);
    expect(result.modified).toBe(true);
    expect(result.injectedCount).toBe(1);

    const bodyLen = result.buffer.readUInt32BE(1);
    const parsed = JSON.parse(result.buffer.subarray(5, 5 + bodyLen).toString('utf8'));
    const configs = parsed.userStatus.cascadeModelConfigData.clientModelConfigs;
    expect(configs.length).toBe(2);
    expect(configs[1].label).toContain('My Custom Model');
    expect(configs[1].modelOrAlias.model).toMatch(/^MODEL_PLACEHOLDER_M\d+$/);

    const sortLabels = parsed.userStatus.cascadeModelConfigData.clientModelSorts[0].groups[0].modelLabels;
    expect(sortLabels.length).toBe(2);
    expect(sortLabels[0]).toBe('Stock Model 1');
    expect(sortLabels[1]).toContain('My Custom Model');
  });
});
