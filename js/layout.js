// Layout engine: arranges N photos so that together they fill a page.
//
// A layout is a slicing tree (guillotine cuts). Each internal node splits its
// rectangle either side by side ('h') or stacked ('v'); each leaf is a photo,
// optionally rotated 90°. Because every photo has a known aspect ratio, a tree
// has an exact natural aspect ratio:
//   side by side: a = a1 + a2        stacked: 1/a = 1/a1 + 1/a2
// We search for trees whose natural aspect matches the page, so photos need
// little cropping when the tree is stretched to fill the page exactly.
//
// All lengths are in the page's unit (the app uses millimetres).

export const PAPER_SIZES = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  '4×6 in': { width: 101.6, height: 152.4 },
  '5×7 in': { width: 127, height: 177.8 },
};

// Score weights (lower score = better layout).
const WEIGHT_MAX_CROP = 0.5; // worst single photo crop, so no photo is butchered
const WEIGHT_SIZE_SPREAD = 0.25; // coefficient of variation of photo sizes
const WEIGHT_ROTATION = 0.01; // mild preference for upright photos
const MIN_CELL = 1; // cells thinner than this are rejected

export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fraction of a photo cut away when it covers a cell (0 = perfect fit). */
export function cropLoss(cellAspect, photoAspect) {
  return 1 - Math.min(cellAspect / photoAspect, photoAspect / cellAspect);
}

/** Whether rotating a photo 90° makes it fit a cell with less cropping. */
export function shouldRotate(cellAspect, photoAspect) {
  return cropLoss(cellAspect, 1 / photoAspect) < cropLoss(cellAspect, photoAspect);
}

const isLeaf = (t) => t.photo !== undefined;
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomTree(photos, rng, allowRotate) {
  if (photos.length === 1) {
    return { photo: photos[0], rotated: allowRotate && rng() < 0.25 };
  }
  // Averaging two draws biases the split point toward the middle.
  const k = 1 + Math.floor(((rng() + rng()) / 2) * (photos.length - 1));
  return {
    dir: rng() < 0.5 ? 'h' : 'v',
    a: randomTree(photos.slice(0, k), rng, allowRotate),
    b: randomTree(photos.slice(k), rng, allowRotate),
  };
}

function clone(t) {
  return isLeaf(t)
    ? { photo: t.photo, rotated: t.rotated }
    : { dir: t.dir, a: clone(t.a), b: clone(t.b) };
}

function collect(t, leaves, nodes) {
  if (isLeaf(t)) {
    leaves.push(t);
  } else {
    nodes.push(t);
    collect(t.a, leaves, nodes);
    collect(t.b, leaves, nodes);
  }
}

function mutate(tree, rng, allowRotate) {
  const t = clone(tree);
  const leaves = [];
  const nodes = [];
  collect(t, leaves, nodes);
  if (!nodes.length) return t;
  const r = rng();
  if (r < 0.35) {
    const n = pick(nodes, rng);
    n.dir = n.dir === 'h' ? 'v' : 'h';
  } else if (r < 0.6) {
    const x = pick(leaves, rng);
    const y = pick(leaves, rng);
    [x.photo, y.photo] = [y.photo, x.photo];
  } else if (r < 0.75 && allowRotate) {
    const l = pick(leaves, rng);
    l.rotated = !l.rotated;
  } else {
    // Tree rotation: (A, (B, C)) -> ((A, B), C), or swap children of a node
    // whose right child is a leaf.
    const n = pick(nodes, rng);
    if (isLeaf(n.b)) {
      [n.a, n.b] = [n.b, n.a];
    } else {
      const { a, b, dir } = n;
      n.a = { dir, a, b: b.a };
      n.dir = b.dir;
      n.b = b.b;
    }
  }
  return t;
}

function annotate(t, aspects) {
  if (isLeaf(t)) {
    const a = aspects[t.photo];
    t.aspect = t.rotated ? 1 / a : a;
  } else {
    const a1 = annotate(t.a, aspects);
    const a2 = annotate(t.b, aspects);
    t.aspect = t.dir === 'h' ? a1 + a2 : 1 / (1 / a1 + 1 / a2);
  }
  return t.aspect;
}

// Splits each rectangle in proportion to the children's natural aspects, so
// any mismatch with the page is spread evenly across all photos.
function place(t, x, y, w, h, gap, out) {
  if (isLeaf(t)) {
    out.push({ photo: t.photo, rotated: t.rotated, x, y, w, h });
  } else if (t.dir === 'h') {
    const avail = w - gap;
    const w1 = (avail * t.a.aspect) / (t.a.aspect + t.b.aspect);
    place(t.a, x, y, w1, h, gap, out);
    place(t.b, x + w1 + gap, y, avail - w1, h, gap, out);
  } else {
    const avail = h - gap;
    const ia = 1 / t.a.aspect;
    const ib = 1 / t.b.aspect;
    const h1 = (avail * ia) / (ia + ib);
    place(t.a, x, y, w, h1, gap, out);
    place(t.b, x, y + h1 + gap, w, avail - h1, gap, out);
  }
}

function scoreCells(cells, aspects) {
  let area = 0;
  let weightedLoss = 0;
  let maxLoss = 0;
  let rotations = 0;
  const sizes = [];
  for (const c of cells) {
    if (c.w < MIN_CELL || c.h < MIN_CELL) return Infinity;
    const photoAspect = c.rotated ? 1 / aspects[c.photo] : aspects[c.photo];
    const loss = cropLoss(c.w / c.h, photoAspect);
    const a = c.w * c.h;
    area += a;
    weightedLoss += a * loss;
    maxLoss = Math.max(maxLoss, loss);
    if (c.rotated) rotations++;
    sizes.push(Math.sqrt(a));
  }
  const mean = sizes.reduce((s, v) => s + v, 0) / sizes.length;
  const variance = sizes.reduce((s, v) => s + (v - mean) ** 2, 0) / sizes.length;
  return (
    weightedLoss / area +
    WEIGHT_MAX_CROP * maxLoss +
    WEIGHT_SIZE_SPREAD * (Math.sqrt(variance) / mean) +
    WEIGHT_ROTATION * rotations
  );
}

function evaluate(tree, aspects, page) {
  annotate(tree, aspects);
  const { width, height, margin = 0, gap = 0 } = page;
  const cells = [];
  place(tree, margin, margin, width - 2 * margin, height - 2 * margin, gap, cells);
  return { cells, score: scoreCells(cells, aspects) };
}

// Coarse geometry fingerprint, so alternatives offered to the user look
// different rather than shifting a cut by a millimetre.
function signature(cells, page) {
  const qx = page.width / 20;
  const qy = page.height / 20;
  return cells
    .map((c) => [c.x / qx, c.y / qy, c.w / qx, c.h / qy].map(Math.round).join(','))
    .sort()
    .join('|');
}

/**
 * Finds good layouts for photos with the given aspect ratios (width / height).
 *
 * @param {number[]} aspects
 * @param {{width:number, height:number, margin?:number, gap?:number}} page
 * @returns {{page, cells:{photo, rotated, x, y, w, h}[], score:number}[]}
 *   distinct layouts, best first. Empty if nothing fits (e.g. huge margins).
 */
export function generateLayouts(aspects, page, options = {}) {
  const { allowRotate = true, seed = 1, restarts = 120, steps = 80, maxResults = 12 } = options;
  if (!aspects.length) return [];
  const rng = createRng(seed);
  const ids = aspects.map((_, i) => i);
  const pool = new Map();

  for (let r = 0; r < restarts; r++) {
    let tree = randomTree(shuffle(ids.slice(), rng), rng, allowRotate);
    let best = evaluate(tree, aspects, page);
    for (let s = 0; s < steps; s++) {
      const candidate = mutate(tree, rng, allowRotate);
      const result = evaluate(candidate, aspects, page);
      if (result.score <= best.score) {
        tree = candidate;
        best = result;
      }
    }
    if (!Number.isFinite(best.score)) continue;
    const key = signature(best.cells, page);
    const existing = pool.get(key);
    if (!existing || best.score < existing.score) {
      pool.set(key, { page: { ...page }, cells: best.cells, score: best.score });
    }
  }

  return [...pool.values()].sort((a, b) => a.score - b.score).slice(0, maxResults);
}
