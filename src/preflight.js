// Environment checks with actionable messages. hevc_videotoolbox is macOS-only,
// so a Linux contributor hitting the default codec would otherwise get a wall
// of ffmpeg output instead of being told what to use instead.
import { spawnSync } from 'node:child_process';

export const ENCODER_FOR = {
  prores: 'prores_ks',
  hevc:   'hevc_videotoolbox',
  png:    'png',
};

export function ffmpegAvailable() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return r.status === 0;
}

export function availableEncoders() {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (r.status !== 0) return new Set();
  return new Set(
    r.stdout.split('\n')
      .map(l => l.trim().split(/\s+/)[1])
      .filter(Boolean)
  );
}

/** @returns {string|null} an error message, or null if the codec is usable */
export function checkCodec(codec, encoders = availableEncoders()) {
  const needed = ENCODER_FOR[codec];
  if (!needed) return `unknown codec: ${codec}`;
  if (encoders.has(needed)) return null;
  const usable = Object.entries(ENCODER_FOR)
    .filter(([, enc]) => encoders.has(enc))
    .map(([name]) => name);
  const hint = codec === 'hevc'
    ? "\n  hevc uses hevc_videotoolbox, which only exists on macOS."
    : '';
  return `this ffmpeg has no "${needed}" encoder, so --codec ${codec} is unavailable.${hint}`
       + `\n  available here: ${usable.length ? usable.join(', ') : 'none'}`;
}
