import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf } from '../js/pdf.js';

test('PDF cross-reference offsets point at their objects', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0x0a, 0x0d, 0xff, 0xd9]);
  const bytes = buildPdf({ widthPt: 595.28, heightPt: 841.89, jpeg, imageWidth: 10, imageHeight: 20 });
  const text = Buffer.from(bytes).toString('latin1');

  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);

  const xrefAt = Number(text.match(/startxref\n(\d+)\n/)[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 5), 'xref\n');

  const entries = text.slice(xrefAt).split('\n').slice(3, 8);
  entries.forEach((line, i) => {
    const offset = Number(line.slice(0, 10));
    assert.equal(text.slice(offset, offset + 8), `${i + 1} 0 obj\n`);
  });

  const start = text.indexOf('stream\n', text.indexOf('4 0 obj')) + 7;
  assert.deepEqual(bytes.slice(start, start + jpeg.length), jpeg);
});
