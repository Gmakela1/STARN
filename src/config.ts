import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

export interface StarnConfig {
  apiKey: string;
  defaultModel: string;
  compactionModel?: string;
  compressionThreshold: number;
  keepRecentTokens: number;
  siteUrl: string;
  appName: string;
  globalDir: string;
  digitalTwinModel?: string;
  digitalTwinProvider?: 'openrouter' | 'local';
  digitalTwinBaseUrl?: string;
}

export interface UserConfigFile {
  apiKey?: string;
  defaultModel?: string;
  compactionModel?: string;
  compressionThreshold?: number;
  keepRecentTokens?: number;
  siteUrl?: string;
  appName?: string;
  digitalTwinModel?: string;
  digitalTwinProvider?: 'openrouter' | 'local';
  digitalTwinBaseUrl?: string;
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
  const defaultModel = process.env.OPENROUTER_MODEL || fileConfig.defaultModel || 'anthropic/claude-3.5-sonnet';
  const compactionModel = process.env.STARN_COMPACT_MODEL || fileConfig.compactionModel || '';
  const compressionThreshold = Number(process.env.STARN_COMPACT_THRESHOLD || fileConfig.compressionThreshold || 100000);
  const keepRecentTokens = Number(process.env.STARN_KEEP_RECENT_TOKENS || fileConfig.keepRecentTokens || 20000);
  const siteUrl = process.env.OPENROUTER_SITE_URL || fileConfig.siteUrl || 'https://github.com/makel/STARN';
  const appName = process.env.OPENROUTER_SITE_NAME || fileConfig.appName || 'STARN PM Agent';
  const digitalTwinModel = process.env.STARN_TWIN_MODEL || fileConfig.digitalTwinModel;
  const digitalTwinProvider = (process.env.STARN_TWIN_PROVIDER as 'openrouter' | 'local') || fileConfig.digitalTwinProvider;
  const digitalTwinBaseUrl = process.env.STARN_TWIN_BASE_URL || fileConfig.digitalTwinBaseUrl;

  return {
    apiKey,
    defaultModel,
    compactionModel,
    compressionThreshold,
    keepRecentTokens,
    siteUrl,
    appName,
    globalDir,
    digitalTwinModel,
    digitalTwinProvider,
    digitalTwinBaseUrl
  };
}
