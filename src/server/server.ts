import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { handleApiRequest, handleStaticRequest, RouterDeps } from './router.js';

export type ServerOptions = RouterDeps;

/**
 * Creates the STARN web adapter HTTP server: typed /api routes plus static
 * serving of the compiled React UI (web/dist). Pure factory — does not bind
 * a port, so tests can listen on an ephemeral one.
 */
export function createHttpServer(options: ServerOptions): http.Server {
  const webDistPath = options.webDistPath ?? defaultWebDistPath();

  return http.createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    if (urlPath.startsWith('/api/')) {
      void handleApiRequest(req, res, options);
      return;
    }
    handleStaticRequest(req, res, webDistPath);
  });
}

function defaultWebDistPath(): string {
  // src/server/server.ts -> <repo>/web/dist
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'web', 'dist');
}

export function getLocalNetworkAddresses(port: number): string[] {
  const urls: string[] = [`http://localhost:${port}`];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === 'win32'
    ? `start "" "${url}"`
    : platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => { /* best-effort */ });
}

export interface StartedServer {
  server: http.Server;
  port: number;
  urls: string[];
}

/**
 * Binds the server to the requested port, prints nothing (the caller owns
 * presentation), optionally opens the default browser, and returns the URLs.
 */
export async function startWebServer(
  options: ServerOptions & { port?: number; openBrowserOnStart?: boolean }
): Promise<StartedServer> {
  const port = options.port ?? 3000;
  const server = createHttpServer({ ...options, port });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });

  const urls = getLocalNetworkAddresses(port);
  if (options.openBrowserOnStart !== false) {
    openBrowser(`http://localhost:${port}`);
  }
  return { server, port, urls };
}
