import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRegistry } from '../src/workspace/registry.js';
import { ProjectContext } from '../src/workspace/project-context.js';

describe('ProjectContext', () => {
  let tmpA: string;
  let tmpB: string;
  let regPath: string;
  let registry: ProjectRegistry;

  beforeEach(() => {
    tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-a-'));
    tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-b-'));
    regPath = path.join(tmpA, 'registry.json');
    registry = new ProjectRegistry(regPath);
  });

  afterEach(() => {
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  });

  it('initializes with given record, path, stateManager and logger', () => {
    const recA = registry.registerProject('Project A', tmpA);
    const ctx = new ProjectContext(registry, recA);

    expect(ctx.record.id).toBe(recA.id);
    expect(ctx.path).toBe(recA.path);
    expect(ctx.stateManager).toBeDefined();
    expect(ctx.stateManager.getState().name).toBe('Project A');
    expect(ctx.logger).toBeDefined();
  });

  it('switchTo updates project, recreates stateManager and logger, notifies listeners and updates registry', () => {
    const recA = registry.registerProject('Project A', tmpA);
    const recB = registry.registerProject('Project B', tmpB);
    const ctx = new ProjectContext(registry, recA);

    const listener = vi.fn();
    const unsub = ctx.onSwitch(listener);

    ctx.switchTo(recB);

    expect(ctx.record.id).toBe(recB.id);
    expect(ctx.path).toBe(recB.path);
    expect(ctx.stateManager.getState().name).toBe('Project B');
    expect(registry.getActiveProject()?.id).toBe(recB.id);
    expect(listener).toHaveBeenCalledWith(recB);

    unsub();
    ctx.switchTo(recA);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('switchToPath registers a new directory and switches to it', () => {
    const recA = registry.registerProject('Project A', tmpA);
    const ctx = new ProjectContext(registry, recA);

    const newRec = ctx.switchToPath(tmpB, 'Custom Project B');
    expect(newRec.name).toBe('Custom Project B');
    expect(ctx.record.id).toBe(newRec.id);
    expect(ctx.path).toBe(path.resolve(tmpB));
    expect(ctx.stateManager.getState().name).toBe('Custom Project B');
  });
});
