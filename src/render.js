// Offline renderer: audio + avatar -> alpha-channel video for NLE compositing.
//
//   node src/render.js --audio assets/voice.wav --avatar assets/avatar.png
//
// Outputs (into out/):
//   avatar_alpha.mov  ProRes 4444, transparent background, silent -> drag into Resolve
//   preview.mp4       flattened over a dark checkerboard + audio, for eyeballing
import { spawn, spawnSync } from 'node:child_process';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, existsSync } from 'node:fs';
import { buildFrames } from './audio.js';
import { createVisualizer, STYLES, PRESETS } from './visual.js';

import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
// Values tuned in the browser and saved via `node src/serve.js`.
// Explicit CLI flags always win over the saved file.
let saved = {};
try { saved = JSON.parse(readFileSync(arg0('settings', 'settings.json'), 'utf8')); } catch {}
function arg0(k, d) { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; }
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return saved[k] != null ? saved[k] : d;
};
const flag = (k) => argv.includes(`--${k}`);

const AUDIO  = arg('audio', 'assets/voice.wav');
const AVATAR = arg('avatar', 'assets/avatar.png');
const OUTDIR = arg('outdir', 'out');
const FPS    = +arg('fps', 30);
const SIZE   = +arg('size', 512);
const GAIN   = +arg('gain', 1);
const HUE_A  = +arg('hueA', 190);
const HUE_B  = +arg('hueB', 285);
const CODEC  = arg('codec', 'prores');   // prores | hevc | png
const BOUNCE = +arg('bounce', 9) / 100;
const GLOW   = +arg('glow', 100) / 100;
const BLOB   = +arg('blob', 9) / 100;
const RANGE  = +arg('range', 13);
const STYLE  = arg('style', 'pulse');
const PRESET = arg('preset', null);
const COLOR_A = arg('colorA', null);
const COLOR_B = arg('colorB', null);
// Most NLEs (Resolve included) composite alpha as PREMULTIPLIED by default.
// Canvas2D produces STRAIGHT alpha, and handing straight data to a premultiplied
// compositor adds the full-brightness colour on top instead of scaling it, which
// blows soft glows out to white. So we premultiply on the way out by default.
const ALPHA  = arg('alpha', 'premultiplied');

if (!existsSync(AUDIO)) { console.error(`no such audio: ${AUDIO}`); process.exit(1); }
if (!STYLES[STYLE]) { console.error(`--style must be one of: ${Object.keys(STYLES).join(', ')}`); process.exit(1); }
if (PRESET && !PRESETS[PRESET]) { console.error(`--preset must be one of: ${Object.keys(PRESETS).join(', ')}`); process.exit(1); }
if (!['premultiplied', 'straight'].includes(ALPHA)) { console.error("--alpha must be 'premultiplied' or 'straight'"); process.exit(1); }
if (Object.keys(saved).length) console.log(`settings.json: ${JSON.stringify(saved)}`);
const palette = PRESET ? `preset=${PRESET}`
  : (COLOR_A || COLOR_B) ? `colorA=${COLOR_A || '-'} colorB=${COLOR_B || '-'}`
  : `hueA=${HUE_A} hueB=${HUE_B}`;
console.log(`config: ${SIZE}px ${FPS}fps codec=${CODEC} style=${STYLE} ${palette} `
          + `alpha=${ALPHA} bounce=${BOUNCE} glow=${GLOW} blob=${BLOB} range=${RANGE}`);
mkdirSync(OUTDIR, { recursive: true });

// ---- 1. decode audio to mono float32 PCM ----------------------------------
const SR = 48000;
console.log(`decoding ${AUDIO}...`);
const dec = spawnSync('ffmpeg', [
  '-v', 'error', '-i', AUDIO, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-',
], { maxBuffer: 1 << 30 });
if (dec.status !== 0) { console.error(dec.stderr.toString()); process.exit(1); }
const pcm = new Float32Array(dec.stdout.buffer, dec.stdout.byteOffset, dec.stdout.length / 4);
const duration = pcm.length / SR;
console.log(`  ${duration.toFixed(2)}s @ ${SR}Hz`);

// ---- 2. analyse into per-frame features -----------------------------------
console.log(`analysing ${Math.ceil(duration * FPS)} frames...`);
const frames = buildFrames(pcm, SR, FPS, { gain: GAIN, range: RANGE });

// ---- 3. render + encode ----------------------------------------------------
const avatar = existsSync(AVATAR) ? await loadImage(AVATAR) : null;
if (!avatar) console.warn(`  (no avatar at ${AVATAR}, using solid fill)`);
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');
const viz = createVisualizer({
  size: SIZE, hueA: HUE_A, hueB: HUE_B,
  bounce: BOUNCE, glow: GLOW, blobAmount: BLOB,
  style: STYLE, preset: PRESET,
  ...(COLOR_A ? { colorA: COLOR_A } : {}), ...(COLOR_B ? { colorB: COLOR_B } : {}),
});

// Alpha-capable encoders. All three carry real transparency into an NLE;
// they trade file size against fidelity and app compatibility.
const CODECS = {
  // Safest, highest quality, biggest. Universally supported (Resolve, Premiere, FCP).
  prores: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le',
           '-alpha_bits', '16', '-vendor', 'ap4h'],
  // Apple HEVC-with-alpha: ~20x smaller. Reads fine on macOS NLEs; 8-bit alpha, 4:2:0 colour.
  hevc:   ['-c:v', 'hevc_videotoolbox', '-allow_sw', '1', '-alpha_quality', '0.9',
           '-q:v', '60', '-pix_fmt', 'bgra', '-tag:v', 'hvc1'],
  // Lossless RGBA in a .mov. Middle ground, slowest to decode.
  png:    ['-c:v', 'png', '-pix_fmt', 'rgba'],
};
if (!CODECS[CODEC]) { console.error(`--codec must be one of: ${Object.keys(CODECS).join(', ')}`); process.exit(1); }

const MOV = `${OUTDIR}/avatar_alpha.mov`;
const ff = spawn('ffmpeg', [
  '-y', '-v', 'error',
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${SIZE}x${SIZE}`, '-r', String(FPS), '-i', '-',
  ...CODECS[CODEC],
  MOV,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const write = (buf) => new Promise((res, rej) => {
  ff.stdin.write(buf, (e) => e ? rej(e) : res());
});

console.log('rendering...');
for (const f of frames) {
  viz.draw(ctx, f, avatar);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;   // straight RGBA from Canvas2D
  if (ALPHA === 'premultiplied') {
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a === 255) continue;
      if (a === 0) { px[i] = px[i + 1] = px[i + 2] = 0; continue; }
      const m = a / 255;
      px[i] *= m; px[i + 1] *= m; px[i + 2] *= m;
    }
  }
  await write(Buffer.from(px.buffer));
  if (f.i % Math.max(1, Math.floor(frames.length / 10)) === 0) {
    process.stdout.write(`\r  ${Math.round(f.i / frames.length * 100)}%  (${f.i}/${frames.length})   `);
  }
}
ff.stdin.end();
await new Promise((res, rej) => ff.on('close', (c) => c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`))));
console.log(`\rwrote ${MOV} (${CODEC})            `);

// ---- 4. flattened preview with audio ---------------------------------------
if (!flag('no-preview')) {
  const PREVIEW = `${OUTDIR}/preview.mp4`;
  const r = spawnSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=0x11141c:s=${SIZE}x${SIZE}:r=${FPS}`,
    '-i', MOV, '-i', AUDIO,
    // ffmpeg's overlay expects straight alpha, so undo the premultiply first,
    // otherwise the preview double-multiplies and the glow comes out too dark.
    '-filter_complex', ALPHA === 'premultiplied'
      ? '[1:v]unpremultiply=inplace=1[fg];[0:v][fg]overlay=shortest=1,format=yuv420p[v]'
      : '[0:v][1:v]overlay=shortest=1,format=yuv420p[v]',
    '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '160k', '-shortest', PREVIEW,
  ]);
  if (r.status !== 0) console.error(r.stderr.toString());
  else console.log(`wrote ${PREVIEW}`);
}
