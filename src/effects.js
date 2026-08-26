// Effect layers. Each takes (ctx, s, f) where `s` is the shared scene state
// { S, C, orbR, level, hit, bands, spec, wave, phase, col } and `f` is the frame.
// Everything here is deterministic: driven by frame index, never wall-clock.

// --- shared -----------------------------------------------------------------

export function glow(ctx, s) {
  const { C, orbR, level, col, cfg } = s;
  // A wide, slowly-fading glow covers most of the frame in low alpha, which
  // composites over footage as a flat grey wash - it reads as a translucent
  // box rather than a floating avatar. So: hug the orb, and fall off fast
  // enough that the outer half of the frame is genuinely empty.
  const r = orbR * (1.06 + level * 0.42);
  const g = ctx.createRadialGradient(C, C, orbR * 0.94, C, C, r);
  const a = (0.05 + level * 0.34) * cfg.glow;
  g.addColorStop(0,    col('a', a));
  g.addColorStop(0.30, col('a', a * 0.42));
  g.addColorStop(0.60, col('b', a * 0.12));
  g.addColorStop(0.85, col('b', a * 0.02));
  g.addColorStop(1,    col('b', 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(C, C, r, 0, Math.PI * 2); ctx.fill();
}

// --- pulse (the original) ---------------------------------------------------

export function rings(ctx, s, f) {
  const { C, orbR, col, S } = s;
  for (const ring of s.rings) {
    const age = (f.i - ring.born) / f.fps / 1.15;
    const e = 1 - Math.pow(1 - age, 3);
    const rad = orbR * (1.02 + e * 1.05);
    const a = (1 - age) * (1 - age) * 0.75 * ring.power;
    ctx.strokeStyle = col(age < 0.5 ? 'a' : 'b', a);
    ctx.lineWidth = Math.max(1, S * 0.010 * (1 - age) * ring.power);
    ctx.beginPath(); ctx.arc(C, C, rad, 0, Math.PI * 2); ctx.stroke();
  }
}

export function blob(ctx, s) {
  const { S, C, orbR, level, spec, phase, col, cfg } = s;
  const N = 128, pts = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const m = Math.abs(((i / N) * 2) % 2 - 1);
    const si = Math.min(spec.length - 1, Math.floor(Math.pow(m, 0.7) * spec.length));
    const wob = Math.sin(th * 3 + phase * 2.1) * 0.012 + Math.sin(th * 5 - phase * 1.3) * 0.008;
    const rr = orbR * (1.045 + spec[si] * cfg.blobAmount * (0.5 + level) + wob * (0.4 + level));
    pts.push([C + Math.cos(th - Math.PI / 2) * rr, C + Math.sin(th - Math.PI / 2) * rr]);
  }
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N], q = pts[(i + 1) % N];
    if (i === 0) ctx.moveTo(p[0], p[1]);
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.closePath();
  const lg = ctx.createLinearGradient(0, 0, S, S);
  lg.addColorStop(0, s.col('a', 0.55 + level * 0.45));
  lg.addColorStop(1, s.col('b', 0.55 + level * 0.45));
  ctx.strokeStyle = lg;
  ctx.lineWidth = S * (0.006 + s.bands[0] * 0.012);
  ctx.stroke();
}

export function scope(ctx, s) {
  const { S, C, orbR, level, wave, col } = s;
  const N = 180;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2 - Math.PI / 2;
    const v = wave[Math.floor((i / N) * wave.length)] || 0;
    const rr = orbR * 1.24 + v * S * 0.055;
    const x = C + Math.cos(th) * rr, y = C + Math.sin(th) * rr;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = col('a', 0.15 + level * 0.5);
  ctx.lineWidth = S * 0.0035;
  ctx.stroke();
}

// --- constellation ----------------------------------------------------------
// A QAM constellation diagram: the actual way a modem encodes bits onto a
// carrier. Each symbol is a point in amplitude/phase space; noise makes the
// cluster smear. Here voice energy is the "signal", so a loud clean vowel
// snaps the lattice tight and silence lets it drift apart.

export function constellation(ctx, s) {
  const { S, C, orbR, level, spec, phase, col } = s;
  const GRID = 4;                              // 16-QAM
  const span = orbR * 1.62;
  const lock = level;                          // 1 = locked, 0 = drifting
  const jitter = (1 - lock) * orbR * 0.30;

  ctx.lineWidth = S * 0.0022;
  ctx.strokeStyle = col('a', 0.06 + lock * 0.10);
  for (let i = 0; i <= GRID; i++) {            // faint I/Q graticule
    const t = (i / GRID - 0.5) * 2 * span;
    ctx.beginPath(); ctx.moveTo(C + t, C - span); ctx.lineTo(C + t, C + span); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(C - span, C + t); ctx.lineTo(C + span, C + t); ctx.stroke();
  }

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const k = gy * GRID + gx;
      const bx = ((gx + 0.5) / GRID - 0.5) * 2 * span;
      const by = ((gy + 0.5) / GRID - 0.5) * 2 * span;
      // deterministic per-symbol drift, modulated by its own spectrum band
      const e = spec[Math.floor((k / (GRID * GRID)) * spec.length)];
      const dx = Math.sin(phase * 2.3 + k * 1.7) * jitter * (0.6 + e);
      const dy = Math.cos(phase * 1.9 + k * 2.4) * jitter * (0.6 + e);
      const x = C + bx + dx, y = C + by + dy;
      if (Math.hypot(x - C, y - C) < orbR * 1.06) continue;   // don't draw over the face
      const r = S * (0.004 + e * 0.010 * (0.4 + lock));
      ctx.fillStyle = col(k % 3 === 0 ? 'b' : 'a', 0.25 + e * 0.65 * (0.35 + lock));
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// --- waterfall --------------------------------------------------------------
// A radial spectrogram: every frame pushes the current spectrum outward, so
// you see the last couple of seconds of your voice trailing away from the
// avatar. This is the one that most obviously reads as "that's my sound".

export function waterfall(ctx, s) {
  const { S, C, orbR, col } = s;
  const hist = s.history;
  if (!hist.length) return;
  const inner = orbR * 1.06, outer = S * 0.485;
  const band = (outer - inner) / hist.length;
  const SEG = 96;

  for (let h = 0; h < hist.length; h++) {
    const spec = hist[hist.length - 1 - h];          // newest closest to the avatar
    const r0 = inner + h * band;
    const fade = Math.pow(1 - h / hist.length, 1.6);
    for (let i = 0; i < SEG; i++) {
      const m = Math.abs(((i / SEG) * 2) % 2 - 1);
      const e = spec[Math.min(spec.length - 1, Math.floor(Math.pow(m, 0.7) * spec.length))];
      if (e < 0.06) continue;
      const th0 = (i / SEG) * Math.PI * 2 - Math.PI / 2;
      const th1 = ((i + 1) / SEG) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(C, C, r0, th0, th1);
      ctx.strokeStyle = col(e > 0.55 ? 'b' : 'a', e * fade * 0.85);
      ctx.lineWidth = band * (0.55 + e * 0.7);
      ctx.stroke();
    }
  }
}

// --- packets ----------------------------------------------------------------
// Transients emit dashes that travel outward like framed data on the wire —
// a burst of blocks with gaps, rather than a smooth ring.

export function packets(ctx, s, f) {
  const { S, C, orbR, col } = s;
  for (const p of s.rings) {
    const age = (f.i - p.born) / f.fps / 1.3;
    if (age > 1) continue;
    const rad = orbR * (1.10 + age * 1.02);
    const a = (1 - age) * 0.9 * p.power;
    const bits = 24;
    ctx.lineWidth = S * 0.011 * (1 - age * 0.5);
    ctx.lineCap = 'butt';
    for (let i = 0; i < bits; i++) {
      // a fixed pseudo-random byte pattern per burst, so each burst looks different
      const on = ((p.born * 2654435761 + i * 40503) >>> 8) % 3 !== 0;
      if (!on) continue;
      const w = (Math.PI * 2 / bits) * 0.62;
      const th = (i / bits) * Math.PI * 2 - Math.PI / 2 + p.born * 0.017;
      ctx.beginPath();
      ctx.arc(C, C, rad, th, th + w);
      ctx.strokeStyle = col(i % 4 === 0 ? 'b' : 'a', a);
      ctx.stroke();
    }
  }
  ctx.lineCap = 'round';
}

// --- carrier ----------------------------------------------------------------
// A slow sweeping arc that locks when you speak: the handshake searching for
// a carrier, then holding it.

export function carrier(ctx, s) {
  const { S, C, orbR, level, phase, col } = s;
  const r = orbR * 1.16;
  const lock = level;
  const sweep = Math.PI * (0.12 + (1 - lock) * 0.55);
  const speed = 1 - lock * 0.8;
  const start = phase * 3.2 * speed;
  ctx.lineWidth = S * 0.007;
  ctx.strokeStyle = col('a', 0.12 + lock * 0.5);
  ctx.beginPath(); ctx.arc(C, C, r, start, start + sweep); ctx.stroke();
  ctx.strokeStyle = col('b', 0.10 + lock * 0.4);
  ctx.beginPath(); ctx.arc(C, C, r, start + Math.PI, start + Math.PI + sweep); ctx.stroke();
}
