// Pure validation shared by the CLI and the HTTP server, kept separate so it
// can be tested without spawning anything.
import { STYLES, PRESETS } from './visual.js';

export const CODECS = ['prores', 'hevc', 'png'];
export const ALPHAS = ['premultiplied', 'straight'];

// Bounds for every numeric knob: [min, max].
export const NUMERIC = {
  hueA: [0, 360], hueB: [0, 360], bounce: [0, 30], glow: [0, 200],
  blob: [0, 30], range: [6, 30], fps: [1, 120], size: [64, 2048], gain: [0, 10],
};

export function clampNumber(value, [lo, hi]) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Turn an untrusted request body into a render.js argv array.
 * Every value is either matched against an allowlist or coerced to a bounded
 * number, so nothing user-supplied can be interpreted as anything but data.
 *
 * @param body          parsed JSON from the client
 * @param resolveUpload (id) => absolute path | undefined
 */
export function buildRenderArgs(body, resolveUpload) {
  if (!body || typeof body !== 'object') throw new Error('invalid request body');

  const audio = resolveUpload(body.audioId);
  if (!audio) throw new Error('no audio uploaded');
  const avatar = resolveUpload(body.avatarId);

  const args = ['--audio', audio];
  if (avatar) args.push('--avatar', avatar);

  if (body.style != null) {
    if (!Object.hasOwn(STYLES, body.style)) throw new Error(`unknown style: ${body.style}`);
    args.push('--style', body.style);
  }
  if (body.preset != null && body.preset !== '') {
    if (!Object.hasOwn(PRESETS, body.preset)) throw new Error(`unknown preset: ${body.preset}`);
    args.push('--preset', body.preset);
  }
  if (body.codec != null && !CODECS.includes(body.codec)) throw new Error(`unknown codec: ${body.codec}`);
  if (body.alpha != null && !ALPHAS.includes(body.alpha)) throw new Error(`unknown alpha mode: ${body.alpha}`);
  args.push('--codec', body.codec || 'hevc');
  if (body.alpha) args.push('--alpha', body.alpha);
  if (body.noAudio === true) args.push('--no-audio');

  for (const [key, bounds] of Object.entries(NUMERIC)) {
    if (body[key] == null) continue;
    const n = clampNumber(body[key], bounds);
    if (n === null) continue;              // non-numeric junk is dropped, not passed through
    args.push(`--${key}`, String(n));
  }
  return args;
}
