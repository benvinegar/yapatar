// Shared, environment-agnostic visual engine.
// Uses only Canvas2D APIs so it runs identically in the browser preview
// and in the headless offline renderer (@napi-rs/canvas).

export const DEFAULTS = {
  size: 512,          // square output, transparent background
  avatarRadius: 0.21, // fraction of size (leaves room for glow+rings inside the frame)
  ringCount: 4,       // max concurrent emitted rings
  hueA: 190,          // gradient start hue
  hueB: 285,          // gradient end hue
  bounce: 0.09,       // how much the avatar scales with loudness
  glow: 1.0,          // glow intensity multiplier
  blobAmount: 0.085,  // spectrum deformation of the orb outline
  ringThreshold: 0.42,// transient level needed to emit a ring
  showScope: true,    // waveform ring
};

export function createVisualizer(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const rings = [];
  let lastEmit = -999;
  let phase = 0;

  function reset() { rings.length = 0; lastEmit = -999; phase = 0; }

  /**
   * @param ctx      Canvas2D context, cfg.size square
   * @param f        frame features: {i, fps, level, attack, bands:[bass,mid,high], spectrum:Float32Array, waveform:Float32Array}
   * @param avatar   drawable image (or null)
   */
  function draw(ctx, f, avatar) {
    const S = cfg.size, C = S / 2;
    ctx.clearRect(0, 0, S, S);

    const level = f.level;                 // 0..1 smoothed loudness
    const hit = f.attack;                  // 0..1 transient energy
    const [bass, mid, high] = f.bands;
    phase += 0.006 + level * 0.02;

    // --- emit expanding rings on transients -------------------------------
    if (hit > cfg.ringThreshold && f.i - lastEmit > 5 && rings.length < cfg.ringCount) {
      rings.push({ born: f.i, power: Math.min(1, hit) });
      lastEmit = f.i;
    }
    for (let r = rings.length - 1; r >= 0; r--) {
      const age = (f.i - rings[r].born) / f.fps / 1.15; // normalised 0..1 over ~1.15s
      if (age >= 1) rings.splice(r, 1);
    }

    const baseR = S * cfg.avatarRadius;
    const orbR = baseR * (1 + level * cfg.bounce);

    // --- outer glow --------------------------------------------------------
    const glowR = orbR * (1.25 + level * 0.85);
    const g = ctx.createRadialGradient(C, C, orbR * 0.85, C, C, glowR);
    const gAlpha = (0.12 + level * 0.5) * cfg.glow;
    g.addColorStop(0, `hsla(${cfg.hueA}, 95%, 62%, ${gAlpha})`);
    g.addColorStop(0.55, `hsla(${cfg.hueB}, 90%, 60%, ${gAlpha * 0.35})`);
    g.addColorStop(1, `hsla(${cfg.hueB}, 90%, 60%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(C, C, glowR, 0, Math.PI * 2); ctx.fill();

    // --- emitted rings -----------------------------------------------------
    for (const ring of rings) {
      const age = (f.i - ring.born) / f.fps / 1.15;
      const e = 1 - Math.pow(1 - age, 3);          // ease-out expansion
      const rad = orbR * (1.02 + e * 1.05);
      const a = (1 - age) * (1 - age) * 0.75 * ring.power;
      ctx.strokeStyle = `hsla(${cfg.hueA + (cfg.hueB - cfg.hueA) * age}, 95%, 68%, ${a})`;
      ctx.lineWidth = Math.max(1, S * 0.010 * (1 - age) * ring.power);
      ctx.beginPath(); ctx.arc(C, C, rad, 0, Math.PI * 2); ctx.stroke();
    }

    // --- spectrum-deformed orb outline ("voice blob") ----------------------
    const spec = f.spectrum;
    const N = 128;
    const outline = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      // mirror the spectrum across the vertical axis so the shape reads as symmetric
      const m = Math.abs(((i / N) * 2) % 2 - 1);       // 0..1..0
      const si = Math.min(spec.length - 1, Math.floor(Math.pow(m, 0.7) * spec.length));
      const s = spec[si];
      const wobble = Math.sin(th * 3 + phase * 2.1) * 0.012 + Math.sin(th * 5 - phase * 1.3) * 0.008;
      const rr = orbR * (1.045 + s * cfg.blobAmount * (0.5 + level) + wobble * (0.4 + level));
      outline.push([C + Math.cos(th - Math.PI / 2) * rr, C + Math.sin(th - Math.PI / 2) * rr]);
    }
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = outline[i % N], q = outline[(i + 1) % N];
      if (i === 0) ctx.moveTo(p[0], p[1]);
      ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    ctx.closePath();
    const og = ctx.createLinearGradient(0, 0, S, S);
    og.addColorStop(0, `hsla(${cfg.hueA}, 100%, 65%, ${0.55 + level * 0.45})`);
    og.addColorStop(1, `hsla(${cfg.hueB}, 100%, 68%, ${0.55 + level * 0.45})`);
    ctx.strokeStyle = og;
    ctx.lineWidth = S * (0.006 + bass * 0.012);
    ctx.stroke();

    // --- waveform scope ring ----------------------------------------------
    if (cfg.showScope && f.waveform) {
      const w = f.waveform, WN = 180;
      ctx.beginPath();
      for (let i = 0; i < WN; i++) {
        const th = (i / WN) * Math.PI * 2 - Math.PI / 2;
        const v = w[Math.floor((i / WN) * w.length)] || 0;
        const rr = orbR * 1.24 + v * S * 0.055;
        const x = C + Math.cos(th) * rr, y = C + Math.sin(th) * rr;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `hsla(${cfg.hueA + high * 60}, 100%, 72%, ${0.15 + level * 0.5})`;
      ctx.lineWidth = S * 0.0035;
      ctx.stroke();
    }

    // --- avatar, circle-masked, bouncing ----------------------------------
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, orbR, 0, Math.PI * 2); ctx.closePath();
    ctx.clip();
    if (avatar) {
      const d = orbR * 2;
      ctx.drawImage(avatar, C - orbR, C - orbR, d, d);
    } else {
      ctx.fillStyle = '#1b1f2a';
      ctx.fillRect(C - orbR, C - orbR, orbR * 2, orbR * 2);
    }
    // loudness sheen across the avatar
    const sh = ctx.createLinearGradient(C - orbR, C - orbR, C + orbR, C + orbR);
    sh.addColorStop(0, `hsla(${cfg.hueA}, 100%, 70%, ${mid * 0.16})`);
    sh.addColorStop(1, `hsla(${cfg.hueB}, 100%, 70%, 0)`);
    ctx.fillStyle = sh;
    ctx.fillRect(C - orbR, C - orbR, orbR * 2, orbR * 2);
    ctx.restore();

    // crisp rim on top of the avatar
    ctx.beginPath(); ctx.arc(C, C, orbR, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(0,0%,100%,${0.20 + level * 0.35})`;
    ctx.lineWidth = S * 0.006;
    ctx.stroke();
  }

  return { draw, reset, cfg };
}
