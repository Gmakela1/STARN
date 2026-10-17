import path from 'node:path';
import { ProjectRecord } from './types.js';
import { ProjectRegistry } from './registry.js';
import { ProjectStateManager } from './state.js';
import { Logger } from '../util/logger.js';

export type SwitchListener = (newRecord: ProjectRecord) => void;

/**
 * Headless ProjectContext that holds the active project record, state manager,
 * and logger. Supports switching projects at runtime and notifies listeners.
 */
export class ProjectContext {
  private _registry: ProjectRegistry;
  private _record: ProjectRecord;
  private _stateManager: ProjectStateManager;
  private _logger: Logger;
  private listeners: Set<SwitchListener> = new Set();

  constructor(registry: ProjectRegistry, initialRecord: ProjectRecord) {
    this._registry = registry;
    this._record = initialRecord;
    this._stateManager = new ProjectStateManager(initialRecord.path);
    this._stateManager.getOrCreateState(initialRecord.id, initialRecord.name);
    this._logger = new Logger(path.join(initialRecord.path, '.starn'));
  }

  get registry(): ProjectRegistry {
    return this._registry;
  }

  get record(): ProjectRecord {
    return this._record;
  }

  get path(): string {
    return this._record.path;
  }

  get stateManager(): ProjectStateManager {
    return this._stateManager;
  }

  get logger(): Logger {
    return this._logger;
  }

  /**
   * Switches the active project to the given record.
   * Recreates the state manager and logger, updates registry active project,
   * and notifies all listeners.
   */
  switchTo(record: ProjectRecord): void {
    this._record = record;
    this._registry.setActiveProject(record.id);

    this._stateManager = new ProjectStateManager(record.path);
    this._stateManager.getOrCreateState(record.id, record.name);
    this._logger = new Logger(path.join(record.path, '.starn'));

    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // Listener errors shouldn't prevent project switch
      }
    }
  }

  /**
   * Registers or resolves a project by directory path, then switches to it.
   */
  switchToPath(targetPath: string, name?: string): ProjectRecord {
    const resolved = path.resolve(targetPath);
    const projectName = name?.trim() || path.basename(resolved);
    const record = this._registry.registerProject(projectName, resolved);
    this.switchTo(record);
    return record;
  }

  /**
   * Subscribes to project switch events. Returns an unsubscribe function.
   */
  onSwitch(listener: SwitchListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
