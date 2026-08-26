import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createVisualizer, STYLES, PRESETS } from '../src/visual.js';

const SIZE = 256;

function frame(i, level, attack = 0) {
  const spectrum = new Float32Array(64).fill(level);
  return { i, fps: 30, level, attack, bands: [level, level, level],
           spectrum, waveform: new Float32Array(180).fill(level * 0.5) };
}

function render(style, frames, opts = {}) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const viz = createVisualizer({ size: SIZE, style, ...opts });
  for (const f of frames) viz.draw(ctx, f, null);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

const loudSequence = Array.from({ length: 12 }, (_, i) => frame(i, 1, i === 3 ? 1 : 0));

for (const style of Object.keys(STYLES)) {
  test(`style "${style}" draws something and stays inside the frame`, () => {
    const px = render(style, loudSequence);

    let painted = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) painted++;
    assert.ok(painted > 500, `${style} drew almost nothing (${painted}px)`);

    // Regression: glow and expanding rings must never touch the frame edge, or
    // they get cut into a hard square once composited over video.
    let edge = 0;
    for (let x = 0; x < SIZE; x++) {
      edge = Math.max(edge, px[(x) * 4 + 3], px[((SIZE - 1) * SIZE + x) * 4 + 3],
                            px[(x * SIZE) * 4 + 3], px[(x * SIZE + SIZE - 1) * 4 + 3]);
    }
    assert.equal(edge, 0, `${style} clips at the frame border (alpha ${edge})`);
  });
}

test('rendering is deterministic for identical input', () => {
  const a = render('pulse', loudSequence);
  const b = render('pulse', loudSequence);
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

test('silence renders less than loud audio', () => {
  const count = (px) => { let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++; return n; };
  const quiet = count(render('pulse', [frame(0, 0)]));
  const loud  = count(render('pulse', loudSequence));
  assert.ok(loud > quiet, `loud (${loud}) should paint more than silent (${quiet})`);
});

test('the modem preset uses the brand colours, not hues', () => {
  assert.deepEqual(PRESETS.modem, { colorA: '#44BDA3', colorB: '#F8F8ED' });
  const px = render('pulse', loudSequence, { preset: 'modem' });
  // teal has a clear green bias; a hue-based default would not
  let green = 0, red = 0;
  for (let i = 0; i < px.length; i += 4) { if (px[i + 3] > 40) { green += px[i + 1]; red += px[i]; } }
  assert.ok(green > red, 'expected the teal preset to skew green');
});

test('an unknown style falls back rather than throwing', () => {
  assert.doesNotThrow(() => render('does-not-exist', loudSequence));
});
