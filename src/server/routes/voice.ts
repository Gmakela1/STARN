import { readJsonBody, ok, fail, parseMultipartBoundary, parseMultipartBody, RouteModule } from './kit.js';

export const voiceModule: RouteModule = {
  name: 'voice',
  match: (url, segments) => segments[1] === 'transcribe',
  handle: async (deps, req, res, url, segments) => {
    const method = (req.method ?? 'GET').toUpperCase();
    // ── Voice transcription ───────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/api/transcribe') {
      if (!deps.session) return fail(res, 503, 'Agent session unavailable');

      try {
        const boundary = parseMultipartBoundary(req.headers['content-type'] ?? '');
        if (!boundary) return fail(res, 400, 'Missing multipart boundary');

        const { files } = await parseMultipartBody(req, boundary);
        const audioFile = files['audio'];
        if (!audioFile) return fail(res, 400, 'Missing audio field');

        const text = await deps.session.transcribeAudio(audioFile.buffer, audioFile.filename);
        return ok(res, { text });
      } catch (err: any) {
        return fail(res, 500, err?.message ?? 'Transcription failed');
      }
    }
  }
};
