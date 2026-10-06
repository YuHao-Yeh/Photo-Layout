import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateLayouts,
  createRng,
  PAPER_SIZES,
  cropLoss,
  layoutTree,
  cloneTree,
  splitAt,
} from '../js/layout.js';

const A4 = { ...PAPER_SIZES.A4, margin: 5, gap: 3 };
const EPS = 1e-6;

function randomAspects(n, seed) {
  const rng = createRng(seed);
  const common = [4 / 3, 3 / 4, 3 / 2, 2 / 3, 16 / 9, 9 / 16, 1];
  return Array.from({ length: n }, () => common[Math.floor(rng() * common.length)]);
}

function weightedCrop(layout, aspects) {
  let area = 0;
  let loss = 0;
  for (const c of layout.cells) {
    const p = c.rotated ? 1 / aspects[c.photo] : aspects[c.photo];
    area += c.w * c.h;
    loss += c.w * c.h * cropLoss(c.w / c.h, p);
  }
  return loss / area;
}

for (let n = 1; n <= 12; n++) {
  test(`${n} photo(s): every photo placed once, inside margins, no overlap`, () => {
    const aspects = randomAspects(n, n * 7);
    const layouts = generateLayouts(aspects, A4, { seed: n });
    assert.ok(layouts.length > 0);
    for (const { cells } of layouts) {
      assert.deepEqual(cells.map((c) => c.photo).sort((a, b) => a - b), aspects.map((_, i) => i));
      for (const c of cells) {
        assert.ok(c.x >= A4.margin - EPS && c.y >= A4.margin - EPS);
        assert.ok(c.x + c.w <= A4.width - A4.margin + EPS);
        assert.ok(c.y + c.h <= A4.height - A4.margin + EPS);
      }
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          const a = cells[i];
          const b = cells[j];
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          assert.ok(ox <= EPS || oy <= EPS, 'cells overlap');
        }
      }
    }
  });
}

test('without gaps the cells tile the whole printable area', () => {
  const page = { width: 210, height: 297, margin: 0, gap: 0 };
  const [best] = generateLayouts(randomAspects(7, 3), page);
  const area = best.cells.reduce((s, c) => s + c.w * c.h, 0);
  assert.ok(Math.abs(area - 210 * 297) < 1e-3);
});

test('best layouts need little cropping', () => {
  for (let n = 2; n <= 12; n++) {
    // Two photos have few possible arrangements, so some aspect combinations
    // cannot fill a page without real cropping (e.g. 4:3 + 1:1 on portrait A4).
    const limit = n === 2 ? 0.25 : 0.05;
    for (const seed of [1, 2, 3]) {
      const aspects = randomAspects(n, n * 100 + seed);
      const [best] = generateLayouts(aspects, A4, { seed });
      const crop = weightedCrop(best, aspects);
      assert.ok(crop < limit, `n=${n} seed=${seed}: ${(crop * 100).toFixed(1)}% cropped`);
    }
  }
});

test('rotation can be disabled', () => {
  const layouts = generateLayouts(randomAspects(8, 5), A4, { allowRotate: false });
  assert.ok(layouts.every((l) => l.cells.every((c) => !c.rotated)));
});

test('same seed gives the same result', () => {
  const aspects = randomAspects(6, 9);
  assert.deepEqual(generateLayouts(aspects, A4, { seed: 4 }), generateLayouts(aspects, A4, { seed: 4 }));
});

test('impossible margins yield no layouts', () => {
  assert.deepEqual(generateLayouts([1, 1], { width: 50, height: 50, margin: 25, gap: 0 }), []);
});

test('layoutTree reproduces a generated layout', () => {
  const aspects = randomAspects(9, 21);
  for (const layout of generateLayouts(aspects, A4)) {
    const { cells, dividers } = layoutTree(cloneTree(layout.tree), aspects, layout.page);
    assert.deepEqual(cells, layout.cells);
    assert.equal(dividers.length, aspects.length - 1);
  }
});

test('dragging a cut line moves it exactly and keeps the page tiled', () => {
  const page = { width: 210, height: 297, margin: 0, gap: 0 };
  const aspects = randomAspects(6, 8);
  const [layout] = generateLayouts(aspects, page);
  const tree = cloneTree(layout.tree);
  for (const target of [0.3, 0.5, 0.7]) {
    const [root] = layoutTree(tree, aspects, page).dividers;
    const pos = root.dir === 'h' ? target * page.width : target * page.height;
    root.node.split = splitAt(root, pos, page.gap);
    const { cells, dividers } = layoutTree(tree, aspects, page);
    assert.ok(Math.abs(dividers[0].pos - pos) < 1e-9);
    const area = cells.reduce((s, c) => s + c.w * c.h, 0);
    assert.ok(Math.abs(area - page.width * page.height) < 1e-6);
  }
  // The original layout is untouched by edits to the copy.
  assert.deepEqual(layoutTree(cloneTree(layout.tree), aspects, page).cells, layout.cells);
});

test('splitAt accounts for the gap between frames', () => {
  const d = { dir: 'v', x: 5, y: 5, w: 200, h: 287 };
  const gap = 3;
  const split = splitAt(d, 100, gap);
  // Top frame ends half a gap above the line.
  assert.ok(Math.abs(d.y + split * (d.h - gap) - (100 - gap / 2)) < 1e-9);
});
