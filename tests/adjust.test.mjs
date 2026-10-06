import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAdjustments, isNeutral, NEUTRAL, PRESETS } from '../js/adjust.js';

const pixel = (r, g, b) => new Uint8ClampedArray([r, g, b, 255]);
const adjusted = (px, adj) => {
  applyAdjustments(px, adj);
  return [...px];
};

test('neutral settings leave pixels unchanged', () => {
  const data = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
  const copy = data.slice();
  applyAdjustments(data, NEUTRAL);
  assert.deepEqual(data, copy);
  assert.ok(isNeutral(NEUTRAL));
  assert.ok(!isNeutral({ ...NEUTRAL, warmth: 5 }));
});

test('brightness lightens and darkens', () => {
  assert.ok(adjusted(pixel(100, 100, 100), { brightness: 50 })[0] > 100);
  assert.ok(adjusted(pixel(100, 100, 100), { brightness: -50 })[0] < 100);
});

test('contrast spreads values away from mid-grey', () => {
  const [dark] = adjusted(pixel(60, 60, 60), { contrast: 50 });
  const [light] = adjusted(pixel(200, 200, 200), { contrast: 50 });
  assert.ok(dark < 60 && light > 200);
  const [flat] = adjusted(pixel(60, 60, 60), { contrast: -100 });
  assert.equal(flat, 128);
});

test('saturation -100 gives grey; alpha is untouched', () => {
  const [r, g, b, a] = adjusted(pixel(200, 50, 50), { saturation: -100 });
  assert.equal(r, g);
  assert.equal(g, b);
  assert.equal(a, 255);
});

test('warmth shifts red against blue', () => {
  const [r, g, b] = adjusted(pixel(128, 128, 128), { warmth: 50 });
  assert.ok(r > 128 && g === 128 && b < 128);
});

test('warmth still tints a black-and-white photo (sepia)', () => {
  const [r, g, b] = adjusted(pixel(60, 120, 200), { saturation: -100, warmth: 60 });
  assert.ok(r > g && g > b);
});

test('values are clamped to 0..255', () => {
  const [r, , b] = adjusted(pixel(250, 128, 5), { brightness: 100, contrast: 100, warmth: 100 });
  assert.equal(r, 255);
  assert.ok(b >= 0);
});

test('presets only use known settings', () => {
  for (const p of Object.values(PRESETS)) assert.deepEqual(Object.keys(p).sort(), Object.keys(NEUTRAL).sort());
});
