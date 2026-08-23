import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProjectRecord, RegistryData } from './types.js';

export class ProjectRegistry {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureFile();
  }

  private ensureFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      const initial: RegistryData = {
        activeProjectId: null,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        projects: []
      };
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf-8');
    }
  }

  public read(): RegistryData {
    this.ensureFile();
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    return JSON.parse(raw) as RegistryData;
  }

  public write(data: RegistryData): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  public registerProject(name: string, targetPath: string): ProjectRecord {
    const resolvedPath = path.resolve(targetPath);
    const data = this.read();
    const existing = data.projects.find(p => p.path === resolvedPath);
    if (existing) {
      existing.name = name;
      existing.lastActiveAt = new Date().toISOString();
      this.write(data);
      return existing;
    }

    const id = 'proj_' + crypto.randomBytes(4).toString('hex');
    const now = new Date().toISOString();
    const newRecord: ProjectRecord = {
      id,
      name,
      path: resolvedPath,
      createdAt: now,
      lastActiveAt: now
    };

    data.projects.push(newRecord);
    data.activeProjectId = id;
    this.write(data);
    return newRecord;
  }

  public listProjects(): ProjectRecord[] {
    return this.read().projects;
  }

  public getActiveProject(): ProjectRecord | null {
    const data = this.read();
    if (!data.activeProjectId) return null;
    return data.projects.find(p => p.id === data.activeProjectId) || null;
  }

  public setActiveProject(id: string): void {
    const data = this.read();
    if (data.projects.some(p => p.id === id)) {
      data.activeProjectId = id;
      this.write(data);
    }
  }

  public setDefaultModel(model: string): void {
    const data = this.read();
    data.defaultModel = model;
    this.write(data);
  }
}
