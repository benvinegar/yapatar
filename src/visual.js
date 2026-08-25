// Shared, environment-agnostic visual engine.
// Uses only Canvas2D APIs so it runs identically in the browser preview
// and in the headless offline renderer (@napi-rs/canvas).
import * as fx from './effects.js';

export const DEFAULTS = {
  size: 512,          // square output, transparent background
  avatarRadius: 0.21, // fraction of size (leaves room for glow+rings inside the frame)
  ringCount: 4,       // max concurrent emitted rings
  hueA: 190,          // gradient start hue (ignored if colorA is set)
  hueB: 285,          // gradient end hue
  colorA: null,       // explicit '#rrggbb' overrides hueA
  colorB: null,
  bounce: 0.09,       // how much the avatar scales with loudness
  glow: 1.0,          // glow intensity multiplier
  blobAmount: 0.085,  // spectrum deformation of the orb outline
  ringThreshold: 0.42,// transient level needed to emit a ring
  style: 'pulse',
};

// Each style is just a list of layers drawn under the avatar.
export const STYLES = {
  pulse:         ['glow', 'rings', 'blob', 'scope'],
  constellation: ['glow', 'constellation', 'carrier'],
  waterfall:     ['waterfall'],
  packets:       ['glow', 'packets', 'carrier', 'scope'],
  handshake:     ['glow', 'carrier', 'constellation', 'packets'],
};

// Brand palettes.
export const PRESETS = {
  modem: { colorA: '#44BDA3', colorB: '#F8F8ED' },   // modem.dev teal + cream
};

const HISTORY = 46;   // frames of spectrum kept for the waterfall (~1.5s at 30fps)

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createVisualizer(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  if (cfg.preset && PRESETS[cfg.preset]) Object.assign(cfg, PRESETS[cfg.preset], opts.colorA ? { colorA: opts.colorA } : {});

  const rgbA = cfg.colorA ? hexToRgb(cfg.colorA) : null;
  const rgbB = cfg.colorB ? hexToRgb(cfg.colorB) : null;
  const col = (which, alpha) => {
    const rgb = which === 'a' ? rgbA : rgbB;
    if (rgb) return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
    const hue = which === 'a' ? cfg.hueA : cfg.hueB;
    return `hsla(${hue}, 95%, 65%, ${alpha})`;
  };

  const layers = (STYLES[cfg.style] || STYLES.pulse).filter(n => typeof fx[n] === 'function');
  const rings = [];
  const history = [];
  let lastEmit = -999, phase = 0;

  function reset() { rings.length = 0; history.length = 0; lastEmit = -999; phase = 0; }

  function draw(ctx, f, avatar) {
    const S = cfg.size, C = S / 2;
    ctx.clearRect(0, 0, S, S);

    const level = f.level;
    phase += 0.006 + level * 0.02;

    // transient -> emitted ring/packet burst
    if (f.attack > cfg.ringThreshold && f.i - lastEmit > 5 && rings.length < cfg.ringCount) {
      rings.push({ born: f.i, power: Math.min(1, f.attack) });
      lastEmit = f.i;
    }
    for (let r = rings.length - 1; r >= 0; r--) {
      if ((f.i - rings[r].born) / f.fps / 1.3 >= 1) rings.splice(r, 1);
    }

    history.push(f.spectrum);
    if (history.length > HISTORY) history.shift();

    const orbR = S * cfg.avatarRadius * (1 + level * cfg.bounce);
    const scene = { S, C, orbR, level, hit: f.attack, bands: f.bands, spec: f.spectrum,
                    wave: f.waveform, phase, col, cfg, rings, history };

    for (const name of layers) fx[name](ctx, scene, f);

    // --- avatar, circle-masked, bouncing --------------------------------
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, orbR, 0, Math.PI * 2); ctx.closePath();
    ctx.clip();
    if (avatar) ctx.drawImage(avatar, C - orbR, C - orbR, orbR * 2, orbR * 2);
    else { ctx.fillStyle = '#1b1f2a'; ctx.fillRect(C - orbR, C - orbR, orbR * 2, orbR * 2); }
    const sh = ctx.createLinearGradient(C - orbR, C - orbR, C + orbR, C + orbR);
    sh.addColorStop(0, col('a', f.bands[1] * 0.16));
    sh.addColorStop(1, col('b', 0));
    ctx.fillStyle = sh;
    ctx.fillRect(C - orbR, C - orbR, orbR * 2, orbR * 2);
    ctx.restore();

    ctx.beginPath(); ctx.arc(C, C, orbR, 0, Math.PI * 2);
    ctx.strokeStyle = cfg.colorB ? col('b', 0.30 + level * 0.45) : `hsla(0,0%,100%,${0.20 + level * 0.35})`;
    ctx.lineWidth = S * 0.006;
    ctx.stroke();
  }

  return { draw, reset, cfg };
}
