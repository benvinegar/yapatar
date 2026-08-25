// Tiny preview server. Unlike `python3 -m http.server` it can also persist the
// settings you tune in the browser, so an agent can read them back and render
// with exactly those values.
//
//   node src/serve.js [--port 8777]
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = +arg('port', 8777);
const ROOT = process.cwd();
const SETTINGS = join(ROOT, 'settings.json');

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.png':'image/png', '.jpg':'image/jpeg', '.wav':'audio/wav', '.mp4':'video/mp4' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/settings' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const parsed = JSON.parse(body);          // validate before writing
      await writeFile(SETTINGS, JSON.stringify(parsed, null, 2) + '\n');
      console.log('saved settings.json:', JSON.stringify(parsed));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: SETTINGS }));
    } catch (e) {
      res.writeHead(400).end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (url.pathname === '/settings' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(await readFile(SETTINGS, 'utf8'));
    } catch { res.writeHead(404).end('{}'); }
    return;
  }

  // static, confined to the project directory
  const rel = url.pathname === '/' ? '/preview.html' : url.pathname;
  const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const buf = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404).end('not found'); }
});

server.listen(PORT, () => {
  console.log(`preview:  http://localhost:${PORT}/preview.html`);
  console.log(`settings: ${SETTINGS} (written when you press "Save settings")`);
});
