// Local preview + render server.
//
//   node src/serve.js [--port 8777]
//
// Serves the preview page, persists tuned settings, and runs renders on
// demand so the browser can drive the whole thing without touching a shell.
//
// This process starts subprocesses, so it is deliberately locked down:
//   - binds to 127.0.0.1 only, never the network
//   - rejects requests carrying a foreign Origin, so another site you happen
//     to have open cannot POST to it
//   - never passes user input through a shell: render.js is spawned with an
//     argv array, and every value is validated against an allowlist or coerced
//     to a bounded number
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, basename } from 'node:path';
import { STYLES, PRESETS } from './visual.js';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = +arg('port', 8777);
const ROOT = process.cwd();
const UPLOADS = join(ROOT, '.uploads');
const SETTINGS = join(ROOT, 'settings.json');
const MAX_UPLOAD = 600 * 1024 * 1024;      // 600 MB, ~90 min of 48k mono wav

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif',
                '.wav':'audio/wav', '.mp4':'video/mp4', '.mov':'video/quicktime' };

const CODECS = ['prores', 'hevc', 'png'];
const ALPHAS = ['premultiplied', 'straight'];
const jobs = new Map();      // jobId -> { state, pct, output, error, log }
const uploads = new Map();   // uploadId -> absolute path

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

// --- validation -------------------------------------------------------------

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Build render.js argv from untrusted JSON. Anything unrecognised is dropped. */
function buildArgs(body) {
  const audio = uploads.get(body.audioId);
  const avatar = uploads.get(body.avatarId);
  if (!audio) throw new Error('no audio uploaded');

  const out = ['--audio', audio];
  if (avatar) out.push('--avatar', avatar);

  if (body.style && !STYLES[body.style]) throw new Error(`unknown style: ${body.style}`);
  if (body.preset && !PRESETS[body.preset]) throw new Error(`unknown preset: ${body.preset}`);
  if (body.codec && !CODECS.includes(body.codec)) throw new Error(`unknown codec: ${body.codec}`);
  if (body.alpha && !ALPHAS.includes(body.alpha)) throw new Error(`unknown alpha mode: ${body.alpha}`);
  if (body.alpha) out.push('--alpha', body.alpha);
  if (body.noAudio === true) out.push('--no-audio');
  if (body.style) out.push('--style', body.style);
  if (body.preset) out.push('--preset', body.preset);
  out.push('--codec', body.codec || 'hevc');

  for (const [k, lo, hi] of [['hueA',0,360], ['hueB',0,360], ['bounce',0,30],
                             ['glow',0,200], ['blob',0,30], ['range',6,30],
                             ['fps',1,120], ['size',64,2048]]) {
    if (body[k] != null) out.push(`--${k}`, String(num(body[k], lo, hi, 0)));
  }
  return out;
}

// --- server -----------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Reject cross-site requests. A GET with no Origin is a normal navigation.
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return json(res, 403, { error: 'cross-origin requests are not accepted' });
  }

  try {
    // ---- settings ----
    if (url.pathname === '/settings' && req.method === 'POST') {
      let body = '';
      for await (const c of req) { body += c; if (body.length > 1e6) throw new Error('too large'); }
      const parsed = JSON.parse(body);
      await writeFile(SETTINGS, JSON.stringify(parsed, null, 2) + '\n');
      return json(res, 200, { ok: true, path: SETTINGS });
    }
    if (url.pathname === '/settings' && req.method === 'GET') {
      try { return json(res, 200, JSON.parse(await readFile(SETTINGS, 'utf8'))); }
      catch { return json(res, 404, {}); }
    }

    // ---- upload: raw body, filename only used for its extension ----
    if (url.pathname === '/upload' && req.method === 'POST') {
      const len = +(req.headers['content-length'] || 0);
      if (len > MAX_UPLOAD) return json(res, 413, { error: 'file too large' });
      await mkdir(UPLOADS, { recursive: true });
      const id = randomUUID();
      const ext = extname(basename(url.searchParams.get('name') || '')).slice(0, 8).replace(/[^.\w]/g, '');
      const path = join(UPLOADS, id + (ext || '.bin'));
      let bytes = 0;
      req.on('data', (c) => { bytes += c.length; if (bytes > MAX_UPLOAD) req.destroy(); });
      await pipeline(req, createWriteStream(path));
      uploads.set(id, path);
      return json(res, 200, { id, bytes });
    }

    // ---- render ----
    if (url.pathname === '/render' && req.method === 'POST') {
      let body = '';
      for await (const c of req) { body += c; if (body.length > 1e6) throw new Error('too large'); }
      const parsed = JSON.parse(body);
      const jobId = randomUUID();
      const outdir = join(ROOT, 'out', 'web', jobId);
      const args = [...buildArgs(parsed), '--outdir', outdir, '--no-preview'];

      const job = { state: 'running', pct: 0, output: null, error: null, log: '' };
      jobs.set(jobId, job);

      // argv array, no shell: nothing here is ever parsed as a command
      const child = spawn(process.execPath, [join(ROOT, 'src', 'render.js'), ...args], { cwd: ROOT });
      const onOut = (d) => {
        const s = d.toString();
        job.log = (job.log + s).slice(-4000);
        const m = [...s.matchAll(/(\d+)%/g)].pop();
        if (m) job.pct = +m[1];
      };
      child.stdout.on('data', onOut);
      child.stderr.on('data', onOut);
      child.on('close', (code) => {
        if (code === 0) { job.state = 'done'; job.pct = 100; job.output = `/out/web/${jobId}/avatar_alpha.mov`; }
        else { job.state = 'error'; job.error = `render exited ${code}`; }
      });
      return json(res, 200, { jobId });
    }

    if (url.pathname.startsWith('/job/') && req.method === 'GET') {
      const job = jobs.get(url.pathname.slice(5));
      return job ? json(res, 200, job) : json(res, 404, { error: 'no such job' });
    }

    // ---- static, confined to the project directory ----
    const rel = url.pathname === '/' ? '/preview.html' : decodeURIComponent(url.pathname);
    const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(ROOT + '/') && path !== ROOT) return json(res, 403, { error: 'forbidden' });
    const info = await stat(path).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
      'content-length': info.size,
      ...(extname(path) === '.mov' ? { 'content-disposition': 'attachment' } : {}),
    });
    await pipeline((await import('node:fs')).createReadStream(path), res);
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`preview:  http://localhost:${PORT}/preview.html`);
  console.log(`bound to 127.0.0.1 only - not reachable from the network`);
});
