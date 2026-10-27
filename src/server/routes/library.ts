import { saveReference, listLibrary, removeLibraryFile, MAX_FILE_SIZE } from '../../workspace/project-files.js';
import { readJsonBody, ok, fail, RouteModule } from './kit.js';

export const libraryModule: RouteModule = {
  name: 'library',
  match: (url, segments) => ['references', 'library'].includes(segments[1]),
  handle: async (deps, req, res, url, segments) => {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'POST' && url.pathname === '/api/references') {
      const body = await readJsonBody(req);
      const filename = String(body.filename ?? '').trim();
      const contentBase64 = String(body.contentBase64 ?? '').trim();
      if (!filename || !contentBase64) {
        return fail(res, 400, 'filename and contentBase64 are required');
      }

      const buffer = Buffer.from(contentBase64, 'base64');
      if (buffer.length > MAX_FILE_SIZE) {
        return fail(res, 413, 'File exceeds maximum 10MB limit');
      }

      try {
        const saved = await saveReference(deps.projectPath, filename, buffer);
        return ok(res, { path: saved.savedPath, filename: saved.filename });
      } catch (err: any) {
        return fail(res, 400, err?.message ?? 'Failed to save reference');
      }
    }

    if (method === 'GET' && url.pathname === '/api/library') {
      try {
        const lib = listLibrary(deps.projectPath);
        return ok(res, lib);
      } catch (err: any) {
        return fail(res, 500, err?.message ?? 'Failed to list library');
      }
    }

    if (method === 'DELETE' && segments[0] === 'api' && segments[1] === 'library' && segments[2] === 'references' && segments[3]) {
      const name = decodeURIComponent(segments[3]);
      try {
        removeLibraryFile(deps.projectPath, { kind: 'reference', name });
        return ok(res, { success: true });
      } catch (err: any) {
        return fail(res, 400, err?.message ?? 'Failed to remove reference');
      }
    }

    if (method === 'DELETE' && segments[0] === 'api' && segments[1] === 'library' && segments[2] === 'examples' && segments[3] && segments[4]) {
      const specialistId = decodeURIComponent(segments[3]);
      const name = decodeURIComponent(segments[4]);
      try {
        removeLibraryFile(deps.projectPath, { kind: 'example', specialistId, name });
        return ok(res, { success: true });
      } catch (err: any) {
        return fail(res, 400, err?.message ?? 'Failed to remove example');
      }
    }
  }
};
