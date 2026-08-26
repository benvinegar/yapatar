// End-to-end: these actually shell out to ffmpeg, so they are skipped when it
// is unavailable rather than failing a contributor's checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegAvailable, checkCodec } from '../src/preflight.js';

const skip = !ffmpegAvailable() ? 'ffmpeg not installed' : false;

function render(args) {
  return spawnSync(process.execPath, ['src/render.js', ...args], { encoding: 'utf8' });
}

test('renders a file with an alpha channel and an audio track', { skip: skip || checkCodec("prores") || false }, () => {
  const out = mkdtempSync(join(tmpdir(), 'yapatar-'));
  try {
    const r = render(['--audio', 'assets/voice.wav', '--avatar', 'assets/avatar.png',
                      '--codec', 'prores', '--size', '128', '--fps', '10',
                      '--outdir', out, '--no-preview']);
    assert.equal(r.status, 0, r.stderr);
    const mov = join(out, 'avatar_alpha.mov');
    assert.ok(existsSync(mov));

    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries',
      'stream=codec_type,pix_fmt', '-of', 'csv=p=0', mov], { encoding: 'utf8' });
    assert.match(probe.stdout, /yuva/, 'expected an alpha pixel format');
    assert.match(probe.stdout, /audio/, 'expected the source audio to be carried');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('--no-audio produces a silent clip', { skip: skip || checkCodec("prores") || false }, () => {
  const out = mkdtempSync(join(tmpdir(), 'yapatar-'));
  try {
    const r = render(['--audio', 'assets/voice.wav', '--codec', 'prores', '--size', '128',
                      '--fps', '10', '--no-audio', '--outdir', out, '--no-preview']);
    assert.equal(r.status, 0, r.stderr);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0', join(out, 'avatar_alpha.mov')], { encoding: 'utf8' });
    assert.doesNotMatch(probe.stdout, /audio/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('bad arguments fail with a useful message', { skip }, () => {
  assert.match(render(['--audio', 'assets/voice.wav', '--style', 'nope']).stderr, /--style must be one of/);
  assert.match(render(['--audio', 'assets/voice.wav', '--preset', 'nope']).stderr, /--preset must be one of/);
  assert.match(render(['--audio', 'does-not-exist.wav']).stderr, /no such audio/);
});
