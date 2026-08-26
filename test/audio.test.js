import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, buildFrames } from '../src/audio.js';

const SR = 48000;

function tone(hz, seconds, amp = 0.5) {
  const pcm = new Float32Array(SR * seconds);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * hz * i / SR) * amp;
  return pcm;
}

test('fft puts a pure tone in the expected bin', () => {
  const N = 1024, hz = 750;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.sin(2 * Math.PI * hz * i / SR);
  fft(re, im);
  let peak = 1;
  for (let i = 2; i < N / 2; i++) {
    if (Math.hypot(re[i], im[i]) > Math.hypot(re[peak], im[peak])) peak = i;
  }
  assert.equal(Math.round(peak * SR / N), 750);
});

test('silence produces no movement', () => {
  const frames = buildFrames(new Float32Array(SR), SR, 30, {});
  assert.ok(frames.length > 0);
  assert.ok(frames.every(f => f.level === 0), 'silence must not pulse');
});

test('loud audio reaches a high level', () => {
  const frames = buildFrames(tone(220, 2, 0.6), SR, 30, {});
  const peak = Math.max(...frames.map(f => f.level));
  assert.ok(peak > 0.8, `expected a strong pulse, got ${peak.toFixed(2)}`);
});

test('calibration is per-clip: a quiet recording still pulses', () => {
  // The whole point of auto-calibration. A -40dB recording must not sit flat.
  const quiet = buildFrames(tone(220, 2, 0.01), SR, 30, {});
  assert.ok(Math.max(...quiet.map(f => f.level)) > 0.8);
});

test('level is bounded and frame count matches duration', () => {
  const frames = buildFrames(tone(300, 3, 0.5), SR, 30, {});
  assert.equal(frames.length, 90);
  assert.ok(frames.every(f => f.level >= 0 && f.level <= 1));
});

test('analysis is deterministic', () => {
  const pcm = tone(440, 1, 0.4);
  const a = buildFrames(pcm, SR, 30, {}).map(f => f.level);
  const b = buildFrames(pcm, SR, 30, {}).map(f => f.level);
  assert.deepEqual(a, b);
});

test('a steady tone fires no transients', () => {
  // Regression: the envelope used to start at zero, so its ramp-up read as one
  // enormous attack and every render opened with a burst of rings that was not
  // in the audio at all.
  const frames = buildFrames(tone(220, 3, 0.4), SR, 30, {});
  const hits = frames.filter(f => f.attack > 0.42).length;
  assert.equal(hits, 0, `steady audio should not pulse, got ${hits} transients`);
  assert.ok(frames[0].attack < 0.05, `frame 0 attack was ${frames[0].attack}`);
});

test('leading silence stays completely still', () => {
  const pcm = new Float32Array(SR * 3);
  const speech = tone(220, 2, 0.4);
  pcm.set(speech, SR);                       // 1s of silence, then audio
  const lead = buildFrames(pcm, SR, 30, {}).slice(0, 30);
  assert.ok(lead.every(f => f.level === 0), 'silence must not pulse');
  assert.ok(lead.every(f => f.attack === 0), 'silence must not fire transients');
});

test('silence never normalises up into a pulse', () => {
  const nearSilent = new Float32Array(SR);
  nearSilent[1000] = 0.02;                   // one tiny blip, otherwise silent
  const frames = buildFrames(nearSilent, SR, 30, {});
  assert.ok(frames.every(f => f.level === 0));
});
