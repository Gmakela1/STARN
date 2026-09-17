import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * File-backed logger. Writes structured, timestamped lines to
 * `<baseDir>/logs/starn-<YYYY-MM-DD>.log`. Survives process exit so
 * failures can be diagnosed after the fact.
 */
export class Logger {
  private logsDir: string;

  constructor(baseDir: string) {
    this.logsDir = path.join(baseDir, 'logs');
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private log(level: LogLevel, message: string): void {
    const date = new Date().toISOString().slice(0, 10);
    const timestamp = new Date().toISOString();
    const filename = `starn-${date}.log`;
    const line = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(path.join(this.logsDir, filename), line, 'utf-8');
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  warn(message: string): void {
    this.log('WARN', message);
  }

  error(message: string): void {
    this.log('ERROR', message);
  }
}
