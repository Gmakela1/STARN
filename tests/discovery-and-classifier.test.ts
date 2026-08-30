import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runDiscovery } from '../src/core/discovery.js';
import {
  classifyRequest,
  detectPhaseSwitchRequest,
  isInformationalQuery
} from '../src/core/classifier.js';
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

  it('identifies informational queries vs authoring requests', () => {
    expect(isInformationalQuery("Tell me about the test project's CONOPS and what the end goal was")).toBe(true);
    expect(isInformationalQuery('What are the key requirements we decided on?')).toBe(true);
    expect(isInformationalQuery('Summarize the current WBS status')).toBe(true);
    expect(isInformationalQuery('Explain how the battery voltage was selected')).toBe(true);

    expect(isInformationalQuery('Draft the CONOPS document')).toBe(false);
    expect(isInformationalQuery('Update the requirements to add 120V charging')).toBe(false);
    expect(isInformationalQuery('Create a WBS for the electrical wiring')).toBe(false);
  });

  it('routes informational questions about CONOPS to general instead of rewriting CONOPS', async () => {
    const specialistId = await classifyRequest(
      "Tell me about the test project's CONOPS and what the end goal was",
      mockClient,
      'test-model',
      'conops'
    );
    expect(specialistId).toBe('general');
  });

  it('classifier routes architecture requests to architecture', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId": "architecture", "reason": "User requested system architecture"}',
      raw: {}
    });

    const specialistId = await classifyRequest('Create a system architecture for the tractor conversion', mockClient, 'test-model');
    expect(specialistId).toBe('architecture');
  });

  it('classifier routes general questions to general', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId": "general", "reason": "General inquiry"}',
      raw: {}
    });

    const specialistId = await classifyRequest('What are the key constraints we saved earlier?', mockClient, 'test-model');
    expect(specialistId).toBe('general');
  });

  it('classifier anchors refinements to activePhase when in progress', async () => {
    vi.spyOn(mockClient, 'chatCompletion').mockResolvedValue({
      content: '{"specialistId": "conops", "reason": "Refining active CONOPS"}',
      raw: {}
    });

    const specialistId = await classifyRequest(
      'Update charging parameters and add 120V AC specs to the document',
      mockClient,
      'test-model',
      'conops'
    );
    expect(specialistId).toBe('conops');
  });

  it('detects explicit user phase switch requests', () => {
    expect(detectPhaseSwitchRequest('I want to redo the CONOPS document')).toBe('conops');
    expect(detectPhaseSwitchRequest('/goto requirements')).toBe('requirements');
    expect(detectPhaseSwitchRequest('Switch to architecture phase')).toBe('architecture');
    expect(detectPhaseSwitchRequest('Just checking the status')).toBeNull();
  });
});
