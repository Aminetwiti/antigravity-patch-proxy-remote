import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const {
  removeSandboxedPreloadLocalImports,
} = require('../../scripts/lib/patch-2-3-source');

describe('removeSandboxedPreloadLocalImports', () => {
  it('removes local proxy requires and embeds the required pure helpers', () => {
    const source = `"use strict";
const electron_1 = require("electron");
const idGenerator_1 = require("./proxy/idGenerator");
const errorClassifier_1 = require("./proxy/errorClassifier");
const id = (0, idGenerator_1.generateModelPlaceholderId)(model);
const slug = (0, idGenerator_1.toSlug)(model);
const diagnostic = (0, errorClassifier_1.classifyError)(status, null, body);`;

    const patched = removeSandboxedPreloadLocalImports(source);

    expect(patched).not.toContain('require("./proxy/idGenerator")');
    expect(patched).not.toContain('require("./proxy/errorClassifier")');
    expect(patched).toContain('function generateModelPlaceholderId(model)');
    expect(patched).toContain('function toSlug(model)');
    expect(patched).toContain('function classifyError(status, errorObj, responseBody, provider)');
    expect(patched).toContain('generateModelPlaceholderId(model)');
    expect(patched).toContain('toSlug(model)');
    expect(patched).toContain('classifyError(status, null, body)');
    expect(removeSandboxedPreloadLocalImports(patched)).toBe(patched);
  });

  it('patches the current compiled preload without local proxy requires', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../dist/preload.js'), 'utf8');
    const patched = removeSandboxedPreloadLocalImports(source);

    expect(patched).not.toMatch(/require\(["']\.\/proxy\//);
    expect(patched).not.toContain('idGenerator_1.');
    expect(patched).not.toContain('errorClassifier_1.');
  });
});
