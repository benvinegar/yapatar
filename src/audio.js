// Audio -> per-frame visual features. Pure JS, no deps.

/** In-place iterative radix-2 FFT. re/im are Float32Array of length n (power of 2). */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const FFT_SIZE = 2048;
const SPEC_BINS = 64;

/**
 * Compute one feature frame from a PCM window.
 * Returns { rms, spectrum(Float32Array SPEC_BINS, 0..1), bands:[bass,mid,high], waveform }
 */
export function analyzeWindow(pcm, start, sampleRate) {
  const re = new Float32Array(FFT_SIZE), im = new Float32Array(FFT_SIZE);
  let sum = 0;
  for (let i = 0; i < FFT_SIZE; i++) {
    const s = pcm[start + i] || 0;
    sum += s * s;
    // Hann window
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }
  const rms = Math.sqrt(sum / FFT_SIZE);
  fft(re, im);

  // log-spaced magnitude bins across ~60Hz..8kHz (the voice-relevant range)
  const spectrum = new Float32Array(SPEC_BINS);
  const nyq = sampleRate / 2, binHz = nyq / (FFT_SIZE / 2);
  const fLo = 60, fHi = 8000;
  for (let b = 0; b < SPEC_BINS; b++) {
    const f0 = fLo * Math.pow(fHi / fLo, b / SPEC_BINS);
    const f1 = fLo * Math.pow(fHi / fLo, (b + 1) / SPEC_BINS);
    const i0 = Math.max(1, Math.floor(f0 / binHz)), i1 = Math.max(i0 + 1, Math.floor(f1 / binHz));
    let m = 0;
    for (let i = i0; i < i1 && i < FFT_SIZE / 2; i++) m = Math.max(m, Math.hypot(re[i], im[i]));
    // magnitude -> dB -> 0..1
    const db = 20 * Math.log10(m / (FFT_SIZE / 4) + 1e-9);
    spectrum[b] = Math.max(0, Math.min(1, (db + 70) / 60));
  }

  const avg = (a, b) => {
    let s = 0; for (let i = a; i < b; i++) s += spectrum[i];
    return s / (b - a);
  };
  const bands = [avg(0, 16), avg(16, 40), avg(40, SPEC_BINS)];

  const waveform = new Float32Array(180);
  for (let i = 0; i < 180; i++) waveform[i] = pcm[start + Math.floor((i / 180) * FFT_SIZE)] || 0;

  return { rms, spectrum, bands, waveform };
}

/**
 * Turn full PCM into one feature frame per video frame, with attack/release
 * smoothing and auto-normalisation so quiet recordings still pulse well.
 */
export function buildFrames(pcm, sampleRate, fps, { gain = 1, range = 13, gate = 0.04 } = {}) {
  const total = Math.ceil((pcm.length / sampleRate) * fps);
  const raw = [];
  for (let i = 0; i < total; i++) {
    const center = Math.floor((i / fps) * sampleRate);
    raw.push(analyzeWindow(pcm, Math.max(0, center - FFT_SIZE / 2), sampleRate));
  }

  // Auto-calibrate to THIS clip: the loud percentile becomes "full pulse",
  // and `range` dB below it becomes rest. Without this, normal speech pins
  // the visual at maximum and nothing appears to react.
  const dbs = raw.map(r => 20 * Math.log10(r.rms + 1e-9));
  const sorted = [...dbs].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const ceilDb = pct(0.97);
  const floorDb = Math.max(pct(0.10), ceilDb - range);
  const norm = dbs.map(db => {
    let v = (db - floorDb) / Math.max(6, ceilDb - floorDb);
    v = Math.max(0, Math.min(1, v));
    v = v < gate ? 0 : (v - gate) / (1 - gate);
    return Math.min(1, Math.pow(v, 0.85) * gain);   // slight lift of mid-loudness
  });

  const frames = [];
  let lvl = 0, env = 0;
  const ATTACK = 0.55, RELEASE = 0.10;   // fast up, slow down - feels like speech
  for (let i = 0; i < total; i++) {
    const target = norm[i];
    const k = target > lvl ? ATTACK : RELEASE;
    const prev = lvl;
    lvl += (target - lvl) * k;
    env = Math.max(env * 0.86, Math.max(0, lvl - prev) * 6);
    const sm = new Float32Array(raw[i].spectrum.length);
    for (let b = 0; b < sm.length; b++) {
      const p = i > 0 ? frames[i - 1].spectrum[b] : 0;
      sm[b] = raw[i].spectrum[b] > p ? raw[i].spectrum[b] : p * 0.78 + raw[i].spectrum[b] * 0.22;
    }
    frames.push({
      i, fps,
      level: lvl,
      attack: Math.min(1, env),
      bands: raw[i].bands,
      spectrum: sm,
      waveform: raw[i].waveform,
    });
  }
  frames.calibration = { floorDb, ceilDb };
  return frames;
}
