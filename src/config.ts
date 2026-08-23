import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

export interface StarnConfig {
  apiKey: string;
  defaultModel: string;
  siteUrl: string;
  appName: string;
  globalDir: string;
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

export function loadConfig(): StarnConfig {
  const globalDir = getGlobalStarnDir();
  return {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    defaultModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',
    siteUrl: process.env.OPENROUTER_SITE_URL || 'https://github.com/makel/STARN',
    appName: process.env.OPENROUTER_SITE_NAME || 'STARN PM Agent',
    globalDir
  };
}
