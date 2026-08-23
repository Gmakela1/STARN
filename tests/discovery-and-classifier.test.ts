import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runDiscovery } from '../src/core/discovery.js';
import { classifyRequest } from '../src/core/classifier.js';
import { ProjectStateManager } from '../src/workspace/state.js';
import { OpenRouterClient } from '../src/openrouter/client.js';

describe('Discovery & Classifier', () => {
  let tempDir: string;
  let stateMgr: ProjectStateManager;
  let mockClient: OpenRouterClient;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'starn-disc-test-' + Date.now());
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs', 'README.md'), '# Shed Dimensions\n12ft by 10ft roof', 'utf-8');
    stateMgr = new ProjectStateManager(tempDir);
    stateMgr.getOrCreateState('p1', 'Solar Shed');
    mockClient = new OpenRouterClient({ apiKey: 'mock' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('discovery scans project files and updates project state', async () => {
    const summary = await runDiscovery(tempDir, stateMgr);
    expect(summary.existingFiles).toContain('docs/README.md');
    expect(summary.discoveryText).toContain('docs/README.md');
    const state = stateMgr.getState();
    expect(state.discovery.lastScanned).toBeDefined();
  });

  it('classifier routes physical breakdown requests to wbs', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId": "wbs", "reason": "User requested work breakdown"}',
      raw: {}
    });

    const specialistId = await classifyRequest('Create a detailed WBS for the solar shed electrical wiring', mockClient, 'test-model');
    expect(specialistId).toBe('wbs');
  });

  it('classifier routes general questions to general', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId": "general", "reason": "General inquiry"}',
      raw: {}
    });

    const specialistId = await classifyRequest('What are the key constraints we saved earlier?', mockClient, 'test-model');
    expect(specialistId).toBe('general');
  });

  it('classifier falls back to keyword matching if LLM fails', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockRejectedValue(new Error('Network error'));

    const specialistId = await classifyRequest('Draft the CONOPS document', mockClient, 'test-model');
    expect(specialistId).toBe('conops');
  });
});
