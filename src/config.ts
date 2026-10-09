import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

export const OPENROUTER_PROVIDER_ID = 'openrouter';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export type ModelRole = 'drafting' | 'critic' | 'classifier' | 'compaction';
export const MODEL_ROLES: ModelRole[] = ['drafting', 'critic', 'classifier', 'compaction'];

/** A user-configured OpenAI-compatible provider. The built-in OpenRouter provider is never stored here. */
export interface ProviderConfig {
  id: string;
  name: string;
  /** API root, e.g. http://localhost:11434/v1 */
  baseUrl: string;
  apiKey?: string;
}

export interface RoleAssignment {
  providerId: string;
  model: string;
}

export type Assignments = Record<ModelRole, RoleAssignment>;

export interface StarnConfig {
  apiKey: string;
  /** Mirrors assignments.drafting.model (kept for legacy callers). */
  defaultModel: string;
  /** Mirrors assignments.compaction.model when compaction was explicitly configured; '' otherwise. */
  compactionModel?: string;
  compressionThreshold: number;
  keepRecentTokens: number;
  siteUrl: string;
  appName: string;
  globalDir: string;
  providers: ProviderConfig[];
  assignments: Assignments;
}

export interface UserConfigFile {
  apiKey?: string;
  defaultModel?: string;
  compactionModel?: string;
  compressionThreshold?: number;
  keepRecentTokens?: number;
  siteUrl?: string;
  appName?: string;
  providers?: ProviderConfig[];
  assignments?: Partial<Assignments>;
}

const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';

/**
 * Resolves per-role assignments from a config file, migrating legacy
 * defaultModel/compactionModel. Env model overrides apply only to roles
 * assigned to OpenRouter.
 */
export function resolveAssignments(file: UserConfigFile, env: NodeJS.ProcessEnv = process.env): Assignments {
  const legacyDefault = file.defaultModel || DEFAULT_MODEL;
  const legacyCompaction = file.compactionModel || legacyDefault;
  const explicit = file.assignments ?? {};
  const pick = (role: ModelRole, fallbackModel: string): RoleAssignment => {
    const e = explicit[role];
    return e ? { providerId: e.providerId, model: e.model } : { providerId: OPENROUTER_PROVIDER_ID, model: fallbackModel };
  };

  const a: Assignments = {
    drafting: pick('drafting', legacyDefault),
    critic: pick('critic', legacyDefault),
    classifier: pick('classifier', legacyDefault),
    compaction: pick('compaction', legacyCompaction)
  };

  const envModel = env.STARN_MODEL || env.OPENROUTER_MODEL;
  if (envModel) {
    for (const role of ['drafting', 'critic', 'classifier'] as ModelRole[]) {
      if (a[role].providerId === OPENROUTER_PROVIDER_ID) a[role].model = envModel;
    }
  }
  if (env.STARN_COMPACT_MODEL && a.compaction.providerId === OPENROUTER_PROVIDER_ID) {
    a.compaction.model = env.STARN_COMPACT_MODEL;
  }
  return a;
}

/** Throws when any role references a provider that is neither built-in nor configured. */
export function validateAssignments(a: Assignments, providers: ProviderConfig[]): void {
  const known = new Set([OPENROUTER_PROVIDER_ID, ...providers.map(p => p.id)]);
  for (const role of MODEL_ROLES) {
    const id = a[role]?.providerId;
    if (!known.has(id)) {
      throw new Error(`Config error: role "${role}" references unknown provider "${id}"`);
    }
  }
}

export function getGlobalStarnDir(): string {
  return path.join(os.homedir(), '.starn');
}

export function ensureStarnDirs(customGlobalDir?: string): void {
  const base = customGlobalDir || getGlobalStarnDir();
  const projectsDir = path.join(base, 'projects');
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }
}

export function getConfigFilePath(customGlobalDir?: string): string {
  const base = customGlobalDir || getGlobalStarnDir();
  return path.join(base, 'config.json');
}

export function saveUserConfig(updates: UserConfigFile, customGlobalDir?: string): void {
  ensureStarnDirs(customGlobalDir);
  const configFile = getConfigFilePath(customGlobalDir);
  let existing: UserConfigFile = {};

  if (fs.existsSync(configFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    } catch (_e) {
      existing = {};
    }
  }

  const merged: UserConfigFile = {
    ...existing,
    ...updates
  };

  fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf-8');
}

export function loadConfig(customGlobalDir?: string): StarnConfig {
  const globalDir = customGlobalDir || getGlobalStarnDir();
  const configFile = getConfigFilePath(globalDir);
  let fileConfig: UserConfigFile = {};

  if (fs.existsSync(configFile)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    } catch (_e) {
      fileConfig = {};
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY || fileConfig.apiKey || '';
  const providers = Array.isArray(fileConfig.providers) ? fileConfig.providers : [];
  const assignments = resolveAssignments(fileConfig);
  validateAssignments(assignments, providers);
  const compactionConfigured = Boolean(
    fileConfig.compactionModel || fileConfig.assignments?.compaction || process.env.STARN_COMPACT_MODEL
  );
  const compressionThreshold = Number(process.env.STARN_COMPACT_THRESHOLD || fileConfig.compressionThreshold || 100000);
  const keepRecentTokens = Number(process.env.STARN_KEEP_RECENT_TOKENS || fileConfig.keepRecentTokens || 20000);
  const siteUrl = process.env.OPENROUTER_SITE_URL || fileConfig.siteUrl || 'https://github.com/makel/STARN';
  const appName = process.env.OPENROUTER_SITE_NAME || fileConfig.appName || 'STARN PM Agent';

  return {
    apiKey,
    defaultModel: assignments.drafting.model,
    compactionModel: compactionConfigured ? assignments.compaction.model : '',
    compressionThreshold,
    keepRecentTokens,
    siteUrl,
    appName,
    globalDir,
    providers,
    assignments
  };
}
