// Generates a placeholder avatar PNG so the PoC runs with zero assets.
// Replace assets/avatar.png with a real headshot/illustration any time.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';

const S = 512;
const c = createCanvas(S, S), x = c.getContext('2d');
const g = x.createLinearGradient(0, 0, S, S);
g.addColorStop(0, '#2a3552'); g.addColorStop(1, '#14182a');
x.fillStyle = g; x.fillRect(0, 0, S, S);
// shoulders
x.fillStyle = '#3d4a6e';
x.beginPath(); x.ellipse(S / 2, S * 1.02, S * 0.42, S * 0.34, 0, 0, Math.PI * 2); x.fill();
// head
x.fillStyle = '#e8b48c';
x.beginPath(); x.ellipse(S / 2, S * 0.44, S * 0.20, S * 0.24, 0, 0, Math.PI * 2); x.fill();
// hair
x.fillStyle = '#2b2119';
x.beginPath(); x.ellipse(S / 2, S * 0.30, S * 0.215, S * 0.14, 0, Math.PI, 0); x.fill();
// eyes + smile
x.fillStyle = '#1d2430';
x.beginPath(); x.ellipse(S * 0.435, S * 0.44, S * 0.019, S * 0.026, 0, 0, Math.PI * 2); x.fill();
x.beginPath(); x.ellipse(S * 0.565, S * 0.44, S * 0.019, S * 0.026, 0, 0, Math.PI * 2); x.fill();
x.strokeStyle = '#8a5a44'; x.lineWidth = S * 0.014; x.lineCap = 'round';
x.beginPath(); x.arc(S / 2, S * 0.49, S * 0.075, 0.25 * Math.PI, 0.75 * Math.PI); x.stroke();

writeFileSync('assets/avatar.png', c.toBuffer('image/png'));
console.log('wrote assets/avatar.png');
