/**
 * Protobuf injection logic for the GetAvailableModels response.
 * Pure functions — no I/O, no side effects, fully testable.
 */

import {
  parseProto,
  encodeVarint,
  findModelEntryFieldTag,
  extractFieldMapping,
  encodeModelEntryForGetModels,
  parseProtoRaw,
  encodeStringField,
  encodeVarintField,
  encodeMessageField,
  encodeClientModelConfig,
} from './protobuf';
import { generateModelPlaceholderId } from './idGenerator';
import log from 'electron-log';
import type { CustomModel } from './types';
import { isRecentModel } from './recentModelsStore';
import type { ModelHealthResult } from './modelHealthChecker';
import { expandModelsWithEffort } from './effortExpander';
import { detectModelCapabilities } from './modelUtils';

/**
 * Result of injecting custom models into a GetAvailableModels protobuf response.
 */
export interface InjectionResult {
  /** The modified buffer (may be the same as input if no injection occurred). */
  buffer: Buffer;
  /** Number of models that were injected. */
  injectedCount: number;
  /** Whether the buffer was modified. */
  modified: boolean;
}

export function buildGrpcWebFrame(flags: number, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header[0] = flags;
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

export function parseGrpcWebHeader(buf: Buffer): { flags: number; msgLen: number } | null {
  if (buf.length < 5) return null;
  return { flags: buf[0], msgLen: buf.readUInt32BE(1) };
}

/**
 * Formats a model's display name with Status Dot, Latency, and Favorite Star.
 */
export function formatModelDisplayName(m: CustomModel, health?: ModelHealthResult): string {
  const isFav = isRecentModel(m.name) || isRecentModel(m.displayName);
  const star = isFav ? '⭐ ' : '';
  const name = m.displayName || m.name;

  if (!health) {
    return `${star}🟢 | ${name}`;
  }

  if (health.status === 'unhealthy') {
    const errNotice = health.error ? ` [${health.error}]` : ' [Offline]';
    return `${star}🔴${errNotice} | ${name}`;
  }

  if (health.status === 'slow') {
    return `${star}🟡 ⚡ ${health.latencyMs}ms | ${name}`;
  }

  return `${star}🟢 ⚡ ${health.latencyMs}ms | ${name}`;
}

/**
 * Injects custom models into a Google GetAvailableModels protobuf response.
 *
 * @param responseBuf Raw gRPC-Web response buffer
 * @param customModels Custom models to inject
 * @param healthMap Optional health status map for custom models
 * @returns Injection result with modified buffer and metadata
 */
export function injectCustomModelsIntoResponse(
  responseBuf: Buffer,
  customModels: CustomModel[],
  healthMap?: Map<string, ModelHealthResult>,
): InjectionResult {
  // No injection if no custom models or buffer too small to contain header + body
  if (customModels.length === 0 || responseBuf.length <= 6) {
    return { buffer: responseBuf, injectedCount: 0, modified: false };
  }

  try {
    const flags = responseBuf[0];
    const msgLen = responseBuf.readUInt32BE(1);
    if (5 + msgLen > responseBuf.length) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const msgBody = responseBuf.subarray(5, 5 + msgLen);
    const parsed = parseProto(msgBody, 0, msgBody.length);
    const modelTag = findModelEntryFieldTag(parsed);

    if (modelTag === null) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const sampleEntry = parsed.find((f) => f.tag === modelTag && Array.isArray(f.value));
    if (!sampleEntry || !Array.isArray(sampleEntry.value)) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const fieldMapping = extractFieldMapping(sampleEntry.value);
    const newParts: Buffer[] = [msgBody];

    let injectedCount = 0;

    const expandedModels = expandModelsWithEffort(customModels);

    for (const m of expandedModels) {
      const health = healthMap?.get(m.name);
      
      // Unhealthy models are still injected (with red dot status) so the user knows they are loaded.
      // Removed the filter that was skipping them.

      const placeholderId = generateModelPlaceholderId(m);
      const formattedName = formatModelDisplayName(m, health);
      const entry = encodeModelEntryForGetModels(
        `models/${placeholderId}`,
        formattedName,
        fieldMapping,
      );
      const tagBuf = encodeVarint(modelTag);
      const lenBuf = encodeVarint(entry.length);
      newParts.push(tagBuf, lenBuf, entry);
      injectedCount++;
    }

    if (injectedCount === 0) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const newMsgBody = Buffer.concat(newParts);
    const newHeader = Buffer.alloc(5);
    newHeader[0] = flags;
    newHeader.writeUInt32BE(newMsgBody.length, 1);
    const modifiedBuf = Buffer.concat([newHeader, newMsgBody]);

    return { buffer: modifiedBuf, injectedCount, modified: true };
  } catch (err) {
    log.warn('[ProtoInjector] Injection failed, returning original buffer:', (err as Error).message);
    return { buffer: responseBuf, injectedCount: 0, modified: false };
  }
}

function injectCustomModelsIntoUserStatusJson(
  responseBuf: Buffer,
  flags: number,
  trailers: Buffer,
  bodyStr: string,
  jsonStart: number,
  customModels: CustomModel[],
  healthMap?: Map<string, ModelHealthResult>,
): InjectionResult {
  try {
    let jsonEnd = bodyStr.lastIndexOf('}');
    let parsed: any = null;
    while (jsonEnd > jsonStart) {
      try {
        parsed = JSON.parse(bodyStr.slice(jsonStart, jsonEnd + 1));
        break;
      } catch {
        jsonEnd = bodyStr.lastIndexOf('}', jsonEnd - 1);
      }
    }

    if (!parsed || !parsed.userStatus) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    if (!parsed.userStatus.cascadeModelConfigData) {
      parsed.userStatus.cascadeModelConfigData = {
        clientModelConfigs: [],
        clientModelSorts: [{ name: 'Recommended', groups: [{ modelLabels: [] }] }],
      };
    }

    const cascade = parsed.userStatus.cascadeModelConfigData;
    if (!Array.isArray(cascade.clientModelConfigs)) {
      cascade.clientModelConfigs = [];
    }
    if (!Array.isArray(cascade.clientModelSorts) || cascade.clientModelSorts.length === 0) {
      cascade.clientModelSorts = [{ name: 'Recommended', groups: [{ modelLabels: [] }] }];
    }
    if (!cascade.clientModelSorts[0].groups || !Array.isArray(cascade.clientModelSorts[0].groups) || cascade.clientModelSorts[0].groups.length === 0) {
      cascade.clientModelSorts[0].groups = [{ modelLabels: [] }];
    }
    const sortGroup = cascade.clientModelSorts[0].groups[0];
    if (!Array.isArray(sortGroup.modelLabels)) {
      sortGroup.modelLabels = [];
    }

    const existingLabels = new Set<string>(cascade.clientModelConfigs.map((c: any) => c.label));
    const expandedModels = expandModelsWithEffort(customModels);
    let injectedCount = 0;

    for (const m of expandedModels) {
      const health = healthMap?.get(m.name);
      const placeholderId = generateModelPlaceholderId(m);
      const label = formatModelDisplayName(m, health);

      if (existingLabels.has(label)) continue;
      existingLabels.add(label);

      const cap = detectModelCapabilities(m);

      cascade.clientModelConfigs.push({
        label,
        modelOrAlias: {
          model: placeholderId,
        },
        supportsImages: cap.supportsImages,
        isRecommended: false,
        allowedTiers: [
          'TEAMS_TIER_PRO',
          'TEAMS_TIER_TEAMS',
          'TEAMS_TIER_ENTERPRISE_SELF_HOSTED',
          'TEAMS_TIER_ENTERPRISE_SAAS',
          'TEAMS_TIER_HYBRID',
          'TEAMS_TIER_PRO_ULTIMATE',
        ],
        tagTitle: m.provider ? m.provider.charAt(0).toUpperCase() + m.provider.slice(1) : 'Custom',
        quotaInfo: {
          remainingFraction: 1,
          resetTime: '2099-01-01T00:00:00Z',
        },
        modelId: placeholderId,
      });

      sortGroup.modelLabels.push(label);
      injectedCount++;
    }

    if (injectedCount === 0) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const newJsonBuf = Buffer.from(JSON.stringify(parsed), 'utf8');
    const newHeader = Buffer.alloc(5);
    newHeader[0] = flags;
    newHeader.writeUInt32BE(newJsonBuf.length, 1);
    const modifiedBuf = Buffer.concat([newHeader, newJsonBuf, trailers]);

    log.info(`[ProtoInjector] Injected ${injectedCount} custom models into UserStatus JSON`);
    return { buffer: modifiedBuf, injectedCount, modified: true };
  } catch (err) {
    log.warn('[ProtoInjector] JSON injection failed, returning original buffer:', (err as Error).message);
    return { buffer: responseBuf, injectedCount: 0, modified: false };
  }
}

/**
 * Injects custom models into a LanguageServerService/GetUserStatus protobuf response (for Antigravity 2.5+ / 2.12+).
 * Populates client_model_configs and adds model labels to client_model_sorts.
 *
 * @param responseBuf Raw gRPC-Web response buffer
 * @param customModels Custom models to inject
 * @param healthMap Optional health status map
 * @returns Injection result with modified buffer and metadata
 */
export function injectCustomModelsIntoUserStatus(
  responseBuf: Buffer,
  customModels: CustomModel[],
  healthMap?: Map<string, ModelHealthResult>,
): InjectionResult {
  if (customModels.length === 0 || responseBuf.length <= 5) {
    return { buffer: responseBuf, injectedCount: 0, modified: false };
  }

  try {
    const flags = responseBuf[0];
    const msgLen = responseBuf.readUInt32BE(1);
    if (5 + msgLen > responseBuf.length) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const msgBody = responseBuf.subarray(5, 5 + msgLen);
    const trailers = responseBuf.subarray(5 + msgLen);

    // Check if the payload is JSON (Connect-JSON protocol used in Antigravity 2.12+)
    const bodyStr = msgBody.toString('utf8');
    const jsonStart = bodyStr.indexOf('{"userStatus"');
    if (jsonStart !== -1) {
      return injectCustomModelsIntoUserStatusJson(responseBuf, flags, trailers, bodyStr, jsonStart, customModels, healthMap);
    }

    const topFields = parseProtoRaw(msgBody, 0, msgBody.length);
    const usField = topFields.find((f) => f.fieldNum === 1 && f.raw);
    if (!usField || !usField.raw) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const usFields = parseProtoRaw(usField.raw, 0, usField.raw.length);
    const cascadeField = usFields.find((f) => f.fieldNum === 33 && f.raw);
    if (!cascadeField || !cascadeField.raw) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    const cascadeFields = parseProtoRaw(cascadeField.raw, 0, cascadeField.raw.length);

    const expandedModels = expandModelsWithEffort(customModels);
    const newModels: Array<{
      label: string;
      modelEnum: number;
      modelId: string;
      supportsImages: boolean;
      supportsThought: boolean;
    }> = [];

    const existingLabels = new Set<string>();
    for (const cf of cascadeFields) {
      if (cf.fieldNum === 1 && cf.raw) {
        const sub = parseProtoRaw(cf.raw, 0, cf.raw.length);
        const lField = sub.find((f) => f.fieldNum === 1 && f.raw);
        if (lField && lField.raw) {
          existingLabels.add(lField.raw.toString('utf8'));
        }
      }
    }

    for (const m of expandedModels) {
      const health = healthMap?.get(m.name);
      const placeholderId = generateModelPlaceholderId(m);
      const match = placeholderId.match(/_M(\d+)$/);
      const num = match ? parseInt(match[1], 10) : 400;
      const modelEnum = 1000 + num;
      const label = formatModelDisplayName(m, health);

      if (existingLabels.has(label)) continue;
      existingLabels.add(label);

      const cap = detectModelCapabilities(m);
      newModels.push({
        label,
        modelEnum,
        modelId: placeholderId,
        supportsImages: cap.supportsImages,
        supportsThought: cap.isThinking,
      });
    }

    if (newModels.length === 0) {
      return { buffer: responseBuf, injectedCount: 0, modified: false };
    }

    // Build new CascadeModelConfigData
    const newCascadeParts: Buffer[] = [];

    // 1. Keep existing client_model_configs
    for (const f of cascadeFields) {
      if (f.fieldNum === 1 && f.raw) {
        newCascadeParts.push(encodeMessageField(1, f.raw));
      }
    }

    // 2. Append new client_model_configs
    for (const nm of newModels) {
      const cfgBuf = encodeClientModelConfig(
        nm.label,
        nm.modelEnum,
        nm.modelId,
        nm.supportsImages,
        nm.supportsThought,
      );
      newCascadeParts.push(encodeMessageField(1, cfgBuf));
    }

    // 3. Update client_model_sorts to include the new labels
    let sortsFound = false;
    for (const f of cascadeFields) {
      if (f.fieldNum === 2 && f.raw) {
        sortsFound = true;
        const sortFields = parseProtoRaw(f.raw, 0, f.raw.length);
        const newSortParts: Buffer[] = [];
        for (const sf of sortFields) {
          if (sf.fieldNum === 1 && sf.raw) {
            newSortParts.push(encodeStringField(1, sf.raw.toString('utf8')));
          } else if (sf.fieldNum === 2 && sf.raw) {
            const groupFields = parseProtoRaw(sf.raw, 0, sf.raw.length);
            const newGroupParts: Buffer[] = [];
            for (const gf of groupFields) {
              if (gf.fieldNum === 1 && gf.raw) {
                newGroupParts.push(encodeStringField(1, gf.raw.toString('utf8')));
              } else if (gf.fieldNum === 2 && gf.raw) {
                newGroupParts.push(encodeStringField(2, gf.raw.toString('utf8')));
              }
            }
            for (const nm of newModels) {
              newGroupParts.push(encodeStringField(2, nm.label));
            }
            newSortParts.push(encodeMessageField(2, Buffer.concat(newGroupParts)));
          } else if (sf.wireType === 2 && sf.raw) {
            newSortParts.push(encodeMessageField(sf.fieldNum, sf.raw));
          } else if (sf.wireType === 0 && sf.value !== undefined) {
            newSortParts.push(encodeVarintField(sf.fieldNum, sf.value));
          }
        }
        newCascadeParts.push(encodeMessageField(2, Buffer.concat(newSortParts)));
      } else if (f.fieldNum !== 1) {
        if (f.wireType === 2 && f.raw) {
          newCascadeParts.push(encodeMessageField(f.fieldNum, f.raw));
        } else if (f.wireType === 0 && f.value !== undefined) {
          newCascadeParts.push(encodeVarintField(f.fieldNum, f.value));
        }
      }
    }

    if (!sortsFound) {
      const groupParts = [encodeStringField(1, '')];
      for (const nm of newModels) {
        groupParts.push(encodeStringField(2, nm.label));
      }
      const sortParts = [
        encodeStringField(1, 'Recommended'),
        encodeMessageField(2, Buffer.concat(groupParts)),
      ];
      newCascadeParts.push(encodeMessageField(2, Buffer.concat(sortParts)));
    }

    const newCascadeBuf = Buffer.concat(newCascadeParts);

    // Build new UserStatus
    const newUsParts: Buffer[] = [];
    for (const f of usFields) {
      if (f.fieldNum === 33) {
        newUsParts.push(encodeMessageField(33, newCascadeBuf));
      } else if (f.wireType === 2 && f.raw) {
        newUsParts.push(encodeMessageField(f.fieldNum, f.raw));
      } else if (f.wireType === 0 && f.value !== undefined) {
        newUsParts.push(encodeVarintField(f.fieldNum, f.value));
      }
    }
    const newUsBuf = Buffer.concat(newUsParts);

    // Build new Top Message
    const newTopParts: Buffer[] = [];
    for (const f of topFields) {
      if (f.fieldNum === 1) {
        newTopParts.push(encodeMessageField(1, newUsBuf));
      } else if (f.wireType === 2 && f.raw) {
        newTopParts.push(encodeMessageField(f.fieldNum, f.raw));
      } else if (f.wireType === 0 && f.value !== undefined) {
        newTopParts.push(encodeVarintField(f.fieldNum, f.value));
      }
    }
    const newMsgBody = Buffer.concat(newTopParts);

    const newHeader = Buffer.alloc(5);
    newHeader[0] = flags;
    newHeader.writeUInt32BE(newMsgBody.length, 1);
    const modifiedBuf = Buffer.concat([newHeader, newMsgBody, trailers]);

    return { buffer: modifiedBuf, injectedCount: newModels.length, modified: true };
  } catch (err) {
    log.warn('[ProtoInjector] GetUserStatus injection failed, returning original buffer:', (err as Error).message);
    return { buffer: responseBuf, injectedCount: 0, modified: false };
  }
}

