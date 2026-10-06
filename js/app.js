import { PAPER_SIZES, generateLayouts, shouldRotate, layoutTree, cloneTree, splitAt } from './layout.js';
import { drawPage, cellGeometry } from './render.js';
import { buildPdf } from './pdf.js';
import { t, setLanguage, detectLanguage } from './i18n.js';
import { applyAdjustments, isNeutral, NEUTRAL, PRESETS } from './adjust.js';

const MAX_PHOTOS = 12;
const LOAD_MAX_PIXELS = 3.5e6; // per photo; keeps 12 photos within iPhone memory limits
const MAX_EXPORT_PIXELS = 16e6; // iOS Safari refuses canvases above ~16.7M pixels
const MAX_ZOOM = 5;
const PREVIEW_MAX_SIDE = 900; // px; colour edits render at this size while a slider moves
const MIN_FRAME_MM = 8; // frames can't be dragged smaller than this
const DOUBLE_TAP_MS = 350;
const TAP_SLOP_PX = 10; // a touch that moves less than this is a tap, not a drag
const DIVIDER_HIT_PX = 14; // how close (CSS px) a touch must be to grab a cut line
const MAX_ALTERNATIVES = 12;
const ALTERNATIVE_SCORE_RANGE = 0.3; // hide alternatives much worse than the best
const SETTINGS_KEY = 'photo-layout:settings';
const MM_PER_INCH = 25.4;

const DEFAULT_SETTINGS = {
  paper: 'A4',
  customWidth: 210,
  customHeight: 297,
  orientation: 'portrait',
  margin: 5,
  gap: 3,
  allowRotate: true,
  background: '#ffffff',
  dpi: 300,
  language: null, // null = follow the device language
};

const $ = (sel) => document.querySelector(sel);
const canvas = $('#page');
const ctx = canvas.getContext('2d');

const state = {
  photos: [], // { img: HTMLCanvasElement, aspect }
  settings: loadSettings(),
  layouts: [],
  layoutIndex: 0,
  page: null, // { width, height, margin, gap } in mm
  tree: null, // current layout's cut tree; its nodes' `split` hold resized frames
  dividers: [], // cut lines of the current layout, for dragging
  activeDivider: null, // tree node whose cut is being dragged
  cells: [], // current layout's cells plus the user's edits (rot, zoom, panX, panY)
  selected: -1,
  swapFrom: -1,
  adjusting: false, // colour panel open for the selected photo
  seed: 1,
  language: 'en',
  view: { k: 1, dpr: 1 }, // preview CSS pixels per mm
  exportFile: null,
  exportUrl: null,
};

// ---------- settings ----------

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    // Storage unavailable (e.g. private browsing); settings just won't persist.
  }
}

function paperDims(orientation) {
  const s = state.settings;
  const base = s.paper === 'Custom'
    ? { width: s.customWidth, height: s.customHeight }
    : PAPER_SIZES[s.paper] || PAPER_SIZES.A4;
  const short = Math.min(base.width, base.height);
  const long = Math.max(base.width, base.height);
  return orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long };
}

const layoutKey = (s) =>
  JSON.stringify([s.paper, s.customWidth, s.customHeight, s.orientation, s.margin, s.gap, s.allowRotate]);

// ---------- layouts ----------

function regenerate({ newSeed = false } = {}) {
  if (newSeed) state.seed++;
  const s = state.settings;
  const aspects = state.photos.map((p) => p.aspect);
  state.layouts = [];
  state.layoutsStale = false;
  if (aspects.length) {
    const orientations = s.orientation === 'auto' ? ['portrait', 'landscape'] : [s.orientation];
    const all = orientations.flatMap((o) =>
      generateLayouts(aspects, { ...paperDims(o), margin: s.margin, gap: s.gap }, {
        allowRotate: s.allowRotate,
        seed: state.seed,
      }),
    );
    all.sort((a, b) => a.score - b.score);
    if (all.length) {
      const limit = all[0].score + ALTERNATIVE_SCORE_RANGE;
      state.layouts = all.filter((l) => l.score <= limit).slice(0, MAX_ALTERNATIVES);
    } else {
      toast(t('tooLarge'));
    }
  }
  showLayout(0);
}

function showLayout(index) {
  const layout = state.layouts[index];
  state.layoutIndex = index;
  state.page = layout ? layout.page : null;
  // A copy, so resized frames don't leak into the stored alternative.
  state.tree = layout ? cloneTree(layout.tree) : null;
  // Frame sizes stay based on these aspects even if a photo is replaced later.
  state.treeAspects = state.photos.map((p) => p.aspect);
  state.cells = layout
    ? layout.cells.map((c) => ({ ...c, rot: c.rotated ? 90 : 0, fit: false, zoom: 1, panX: 0, panY: 0 }))
    : [];
  state.dividers = layout ? relayout().dividers : [];
  state.photos.forEach(finishAdjusting);
  state.selected = -1;
  state.swapFrom = -1;
  state.adjusting = false;
  updateUI();
  resize();
}

function relayout() {
  return layoutTree(state.tree, state.treeAspects, state.page);
}

/**
 * Moves a cut line toward `pos` (mm). If a frame would get too small, the line
 * stops as close to `pos` as the minimum frame size allows.
 */
function moveDivider(divider, pos) {
  const node = divider.node;
  const tooSmall = (result) => result.cells.some((c) => c.w < MIN_FRAME_MM || c.h < MIN_FRAME_MM);
  const target = splitAt(divider, pos, state.page.gap);
  let valid = node.split ?? splitAt(divider, divider.pos, state.page.gap);
  node.split = target;
  let result = relayout();
  if (tooSmall(result)) {
    // Bisect between the last valid position and the target.
    let invalid = target;
    for (let i = 0; i < 20; i++) {
      node.split = (valid + invalid) / 2;
      if (tooSmall(relayout())) invalid = node.split;
      else valid = node.split;
    }
    node.split = valid;
    result = relayout();
  }
  const { cells, dividers } = result;
  // Cells come back in the same order, so the user's per-photo edits stay put.
  cells.forEach((c, i) => Object.assign(state.cells[i], { x: c.x, y: c.y, w: c.w, h: c.h }));
  state.dividers = dividers;
}

function nextLayout() {
  // After a photo was replaced, the stored alternatives were made for the old
  // photo, so build new ones instead of cycling.
  if (state.layoutsStale || state.layouts.length <= 1) regenerate({ newSeed: true });
  else showLayout((state.layoutIndex + 1) % state.layouts.length);
}

// ---------- photos ----------

async function loadPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // Safari applies the EXIF orientation here
    const scale = Math.min(1, Math.sqrt(LOAD_MAX_PIXELS / (img.naturalWidth * img.naturalHeight)));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    // `img` is what gets drawn: the original, or a colour-adjusted copy of it.
    return { img: c, original: c, aspect: c.width / c.height, adjust: { ...NEUTRAL } };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addFiles(fileList) {
  const files = [...fileList];
  const room = MAX_PHOTOS - state.photos.length;
  if (!files.length) return;
  if (room <= 0) {
    toast(t('maxPhotos', { max: MAX_PHOTOS }));
    return;
  }
  setBusy(true);
  let failed = 0;
  for (const file of files.slice(0, room)) {
    try {
      state.photos.push(await loadPhoto(file));
    } catch {
      failed++;
    }
  }
  setBusy(false);
  if (files.length > room) toast(t('partialAdd', { room, max: MAX_PHOTOS }));
  else if (failed) toast(t('openFailed', { n: failed }));
  else if (state.photos.length === 1) toast(t('addOneMore'));
  regenerate();
}

function removeSelectedPhoto() {
  state.photos.splice(state.cells[state.selected].photo, 1);
  regenerate();
}

/** Puts a new photo into the selected frame, leaving every frame where it is. */
async function replaceSelectedPhoto(file) {
  const c = state.cells[state.selected];
  if (!c || !file) return;
  setBusy(true);
  try {
    state.photos[c.photo] = await loadPhoto(file);
  } catch {
    toast(t('openFailed', { n: 1 }));
    return;
  } finally {
    setBusy(false);
  }
  c.rotated = state.settings.allowRotate && shouldRotate(c.w / c.h, state.photos[c.photo].aspect);
  c.rot = c.rotated ? 90 : 0;
  c.fit = false;
  c.zoom = 1;
  c.panX = c.panY = 0;
  state.layoutsStale = true;
  requestDraw();
}

function swapCells(i, j) {
  const a = state.cells[i];
  const b = state.cells[j];
  [a.photo, b.photo] = [b.photo, a.photo];
  for (const c of [a, b]) {
    c.rotated = state.settings.allowRotate && shouldRotate(c.w / c.h, state.photos[c.photo].aspect);
    c.rot = c.rotated ? 90 : 0;
    c.fit = false;
    c.zoom = 1;
    c.panX = 0;
    c.panY = 0;
  }
}

// ---------- drawing ----------

let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    draw();
  });
}

function draw() {
  if (!state.page) return;
  const { k, dpr } = state.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPage(ctx, state.page, state.cells, state.photos, k, {
    background: state.settings.background,
    selected: state.selected,
    swapFrom: state.swapFrom,
    dividers: state.dividers,
    activeDivider: state.activeDivider,
  });
}

function resize() {
  if (!state.page) return;
  const stage = $('#stage');
  const pad = 16;
  const k = Math.min(
    (stage.clientWidth - 2 * pad) / state.page.width,
    (stage.clientHeight - 2 * pad) / state.page.height,
  );
  if (!(k > 0)) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = state.page.width * k;
  const h = state.page.height * k;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  state.view = { k, dpr };
  draw();
}

// ---------- UI state ----------

function updateUI() {
  const editing = state.selected >= 0;
  const adjusting = editing && state.adjusting;
  $('#empty').hidden = state.photos.length > 0;
  canvas.hidden = !state.page;
  $('#mainBar').hidden = editing;
  $('#cellBar').hidden = !editing || adjusting;
  $('#adjustPanel').hidden = !adjusting;
  if (adjusting) syncAdjustPanel();
  $('#addBtn').disabled = state.photos.length >= MAX_PHOTOS;
  $('#nextBtn').disabled = !state.layouts.length;
  $('#exportBtn').disabled = !state.page;
  $('#swapBtn').disabled = state.cells.length < 2;
  $('#swapBtn').classList.toggle('active', state.swapFrom >= 0);
  $('#layoutCount').textContent = state.layouts.length > 1
    ? `${state.layoutIndex + 1}/${state.layouts.length}`
    : '';

  const s = state.settings;
  const paperName = s.paper === 'Custom' ? `${s.customWidth}×${s.customHeight} mm` : s.paper;
  const landscape = state.page ? state.page.width > state.page.height : s.orientation === 'landscape';
  const parts = [paperName, t(landscape ? 'landscape' : 'portrait')];
  if (state.photos.length) parts.unshift(t('photoCount', { n: state.photos.length }));
  $('#paperLabel').textContent = parts.join(' · ');
}

function select(index) {
  const previous = state.cells[state.selected];
  if (previous && index !== state.selected) finishAdjusting(state.photos[previous.photo]);
  if (index < 0) state.adjusting = false;
  state.selected = index;
  state.swapFrom = -1;
  updateUI();
  requestDraw();
}

// ---------- colour adjustments (調色) ----------

const selectedPhoto = () => state.photos[state.cells[state.selected]?.photo];

/** Redraws a photo's adjusted copy: small while a slider moves, full size after. */
function renderAdjusted(photo, full) {
  if (isNeutral(photo.adjust)) {
    photo.img = photo.original;
    return;
  }
  const src = photo.original;
  const scale = full ? 1 : Math.min(1, PREVIEW_MAX_SIDE / Math.max(src.width, src.height));
  const key = full ? 'adjusted' : 'preview';
  // Reuse one canvas per photo; iOS frees canvas memory slowly.
  const out = (photo[key] ??= document.createElement('canvas'));
  out.width = Math.max(1, Math.round(src.width * scale));
  out.height = Math.max(1, Math.round(src.height * scale));
  const c = out.getContext('2d', { willReadFrequently: true });
  c.drawImage(src, 0, 0, out.width, out.height);
  const pixels = c.getImageData(0, 0, out.width, out.height);
  applyAdjustments(pixels.data, photo.adjust);
  c.putImageData(pixels, 0, 0);
  photo.img = out;
}

/** Makes sure the photo shows its full-resolution result, not the preview. */
function finishAdjusting(photo) {
  if (photo && photo.preview && photo.img === photo.preview) renderAdjusted(photo, true);
}

let previewQueued = false;
function queuePreview(photo) {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    renderAdjusted(photo, false);
    draw();
  });
}

function syncAdjustPanel() {
  const photo = selectedPhoto();
  if (!photo) return;
  const form = $('#adjustForm');
  for (const key of Object.keys(NEUTRAL)) {
    form.elements[key].value = photo.adjust[key];
    form.elements[key].nextElementSibling.textContent = photo.adjust[key];
  }
  for (const b of document.querySelectorAll('[data-preset]')) {
    const p = PRESETS[b.dataset.preset];
    b.classList.toggle('active', Object.keys(NEUTRAL).every((k) => p[k] === photo.adjust[k]));
  }
}

function applyPreset(name) {
  const photo = selectedPhoto();
  if (!photo) return;
  photo.adjust = { ...PRESETS[name] };
  renderAdjusted(photo, true);
  syncAdjustPanel();
  requestDraw();
}

$('#adjustForm').addEventListener('input', (e) => {
  const photo = selectedPhoto();
  if (!photo || !(e.target.name in NEUTRAL)) return;
  photo.adjust[e.target.name] = Number(e.target.value);
  syncAdjustPanel();
  queuePreview(photo);
});

// `change` fires when the finger lifts: now render at full resolution.
$('#adjustForm').addEventListener('change', () => {
  const photo = selectedPhoto();
  if (!photo) return;
  renderAdjusted(photo, true);
  requestDraw();
});

$('#adjustForm').addEventListener('submit', (e) => e.preventDefault());

document.addEventListener('click', (e) => {
  const preset = e.target.closest('[data-preset]');
  if (preset) applyPreset(preset.dataset.preset);
});

function setBusy(on) {
  $('#busy').hidden = !on;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

// ---------- touch gestures on the page ----------

const pointers = new Map();
let gesture = null;
let lastTap = null; // { cell, time, x, y } of the last quick tap, for double-tap

function toPage(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / state.view.k, y: (clientY - r.top) / state.view.k };
}

function cellAt(clientX, clientY) {
  const { x, y } = toPage(clientX, clientY);
  return state.cells.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
}

/** The cut line nearest the point, if it's within grabbing distance. */
function dividerAt(clientX, clientY) {
  const { x, y } = toPage(clientX, clientY);
  const reach = Math.max(state.page.gap / 2, DIVIDER_HIT_PX / state.view.k);
  let best = null;
  let bestDist = reach;
  for (const d of state.dividers) {
    const [along, across, from, to] = d.dir === 'h' ? [x, y, d.y, d.y + d.h] : [y, x, d.x, d.x + d.w];
    const dist = Math.abs(along - d.pos);
    if (across >= from && across <= to && dist <= bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

const pinchDistance = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2 && state.selected >= 0 && gesture?.type !== 'divider') {
    gesture = { type: 'pinch', startDist: pinchDistance(), zoom: state.cells[state.selected].zoom };
    return;
  }
  if (pointers.size !== 1) return;

  const divider = state.swapFrom < 0 && dividerAt(e.clientX, e.clientY);
  if (divider) {
    gesture = { type: 'divider', node: divider.node };
    state.activeDivider = divider.node;
    requestDraw();
    return;
  }

  const hit = cellAt(e.clientX, e.clientY);
  if (state.swapFrom >= 0) {
    if (hit >= 0 && hit !== state.swapFrom) swapCells(state.swapFrom, hit);
    select(hit >= 0 ? hit : state.swapFrom);
    gesture = null;
    return;
  }
  if (hit < 0) {
    select(-1);
    gesture = null;
    return;
  }
  if (hit !== state.selected) select(hit);
  const c = state.cells[hit];

  const now = performance.now();
  if (lastTap && lastTap.cell === hit && now - lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < TAP_SLOP_PX * 3) {
    lastTap = null;
    gesture = null;
    toggleFit(c);
    return;
  }
  gesture = { type: 'pan', cell: hit, x: e.clientX, y: e.clientY, panX: c.panX, panY: c.panY };
});

/** Double-tap: switch between filling the frame and showing the whole photo. */
function toggleFit(c) {
  c.fit = !c.fit;
  c.zoom = 1;
  c.panX = c.panY = 0;
  toast(t(c.fit ? 'fitWhole' : 'fitFill'));
  requestDraw();
}

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) {
    // Mouse hovering: show a resize cursor over cut lines.
    const d = state.page && dividerAt(e.clientX, e.clientY);
    canvas.style.cursor = d ? (d.dir === 'h' ? 'col-resize' : 'row-resize') : '';
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (gesture?.type === 'divider') {
    // Look the divider up again: its rectangle moves when an outer cut moves.
    const divider = state.dividers.find((d) => d.node === gesture.node);
    const p = toPage(e.clientX, e.clientY);
    if (divider) moveDivider(divider, divider.dir === 'h' ? p.x : p.y);
    requestDraw();
    return;
  }

  const c = state.cells[state.selected];
  if (!gesture || !c) return;

  if (gesture.type === 'pinch' && pointers.size === 2) {
    c.zoom = clamp((gesture.zoom * pinchDistance()) / gesture.startDist, 1, MAX_ZOOM);
  } else if (gesture.type === 'pan') {
    const { maxX, maxY } = cellGeometry(c, state.photos[c.photo].img, state.view.k);
    if (maxX > 0) c.panX = clamp(gesture.panX + (e.clientX - gesture.x) / maxX, -1, 1);
    if (maxY > 0) c.panY = clamp(gesture.panY + (e.clientY - gesture.y) / maxY, -1, 1);
  }
  requestDraw();
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  // A pan that barely moved is a tap; remember it to detect a double-tap.
  if (e.type === 'pointerup' && gesture?.type === 'pan' && pointers.size === 0 &&
      Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < TAP_SLOP_PX) {
    lastTap = { cell: gesture.cell, time: performance.now(), x: e.clientX, y: e.clientY };
  }
  if (gesture?.type === 'divider' && pointers.size === 0) {
    state.activeDivider = null;
    requestDraw();
  }
  // Lifting one finger of a pinch should not turn into a pan.
  if (gesture?.type === 'pinch' || pointers.size === 0) gesture = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  const c = state.cells[state.selected];
  if (!c) return;
  e.preventDefault();
  c.zoom = clamp(c.zoom * Math.exp(-e.deltaY * 0.002), 1, MAX_ZOOM);
  requestDraw();
}, { passive: false });

$('#stage').addEventListener('pointerdown', (e) => {
  if (e.target === e.currentTarget && state.selected >= 0) select(-1);
});

// Stop Safari's page pinch-zoom from fighting the photo pinch.
document.addEventListener('gesturestart', (e) => e.preventDefault());

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- settings dialog ----------

const settingsForm = $('#settingsForm');
let regenerateTimer;

function fillSettingsForm() {
  const f = settingsForm.elements;
  const s = state.settings;
  f.paper.replaceChildren(
    ...Object.keys(PAPER_SIZES).map((name) => new Option(name, name)),
    new Option(t('custom'), 'Custom'),
  );
  f.paper.value = s.paper;
  f.customWidth.value = s.customWidth;
  f.customHeight.value = s.customHeight;
  f.orientation.value = s.orientation;
  f.margin.value = s.margin;
  f.gap.value = s.gap;
  f.allowRotate.checked = s.allowRotate;
  f.background.value = s.background;
  syncSettingsLabels();
}

function syncSettingsLabels() {
  const f = settingsForm.elements;
  $('#customSize').hidden = f.paper.value !== 'Custom';
  $('#marginOut').textContent = `${f.margin.value} mm`;
  $('#gapOut').textContent = `${f.gap.value} mm`;
}

function readNumber(input, min, max, fallback) {
  const v = Number(input.value);
  return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

settingsForm.addEventListener('input', () => {
  const f = settingsForm.elements;
  const s = state.settings;
  const before = layoutKey(s);
  s.paper = f.paper.value;
  s.customWidth = readNumber(f.customWidth, 20, 1000, s.customWidth);
  s.customHeight = readNumber(f.customHeight, 20, 1000, s.customHeight);
  s.orientation = f.orientation.value;
  s.margin = Number(f.margin.value);
  s.gap = Number(f.gap.value);
  s.allowRotate = f.allowRotate.checked;
  s.background = f.background.value;
  saveSettings();
  syncSettingsLabels();
  updateUI();
  if (layoutKey(s) !== before) {
    clearTimeout(regenerateTimer);
    regenerateTimer = setTimeout(regenerate, 150);
  } else {
    requestDraw();
  }
});

// ---------- export ----------

function renderExportCanvas() {
  const { page } = state;
  const areaSqIn = (page.width / MM_PER_INCH) * (page.height / MM_PER_INCH);
  const dpi = Math.min(state.settings.dpi, Math.sqrt(MAX_EXPORT_PIXELS / areaSqIn));
  const k = dpi / MM_PER_INCH;
  const out = document.createElement('canvas');
  out.width = Math.round(page.width * k);
  out.height = Math.round(page.height * k);
  drawPage(out.getContext('2d'), page, state.cells, state.photos, k, {
    background: state.settings.background,
  });
  return out;
}

const toBlob = (c, type, quality) =>
  new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encoding failed'))), type, quality),
  );

async function createExport(kind) {
  const status = $('#exportStatus');
  const buttons = document.querySelectorAll('[data-action="makePdf"], [data-action="makeJpg"]');
  buttons.forEach((b) => (b.disabled = true));
  $('#exportResult').hidden = true;
  status.textContent = t('rendering');
  await new Promise(requestAnimationFrame); // let the status message paint

  try {
    state.photos.forEach(finishAdjusting);
    const out = renderExportCanvas();
    const jpeg = await toBlob(out, 'image/jpeg', 0.92);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    let blob = jpeg;
    let name = `photo-layout-${stamp}.jpg`;
    if (kind === 'pdf') {
      const pt = 72 / MM_PER_INCH;
      const pdf = buildPdf({
        widthPt: state.page.width * pt,
        heightPt: state.page.height * pt,
        jpeg: new Uint8Array(await jpeg.arrayBuffer()),
        imageWidth: out.width,
        imageHeight: out.height,
      });
      blob = new Blob([pdf], { type: 'application/pdf' });
      name = `photo-layout-${stamp}.pdf`;
    }
    out.width = out.height = 0; // free the large canvas right away on iOS

    if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
    state.exportUrl = URL.createObjectURL(blob);
    state.exportFile = new File([blob], name, { type: blob.type });
    const link = $('#downloadLink');
    link.href = state.exportUrl;
    link.download = name;
    $('#shareBtn').hidden = !navigator.canShare?.({ files: [state.exportFile] });
    $('#exportResult').hidden = false;
    status.textContent = t('ready', { name, mb: (blob.size / 1e6).toFixed(1) });
  } catch {
    status.textContent = t('exportFailed');
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function shareExport() {
  try {
    await navigator.share({ files: [state.exportFile] });
  } catch (err) {
    if (err.name !== 'AbortError') toast(t('shareFailed'));
  }
}

// ---------- wiring ----------

const cellEdits = {
  rotate(c) {
    c.rot = (c.rot + 90) % 360;
    c.panX = c.panY = 0;
  },
  zoomIn(c) {
    c.zoom = Math.min(MAX_ZOOM, c.zoom * 1.25);
  },
  zoomOut(c) {
    c.zoom = Math.max(1, c.zoom / 1.25);
  },
  reset(c) {
    c.rot = c.rotated ? 90 : 0;
    c.fit = false;
    c.zoom = 1;
    c.panX = c.panY = 0;
  },
};

const actions = {
  language: () => {
    state.language = setLanguage(state.language === 'en' ? 'zh-Hant' : 'en');
    state.settings.language = state.language; // an explicit choice overrides the device language
    saveSettings();
    updateUI();
  },
  add: () => $('#fileInput').click(),
  next: nextLayout,
  settings: () => {
    fillSettingsForm();
    $('#settingsDialog').showModal();
  },
  export: () => {
    $('#dpiSelect').value = String(state.settings.dpi);
    $('#exportStatus').textContent = '';
    $('#exportResult').hidden = true;
    $('#exportDialog').showModal();
  },
  swap: () => {
    state.swapFrom = state.swapFrom >= 0 ? -1 : state.selected;
    if (state.swapFrom >= 0) toast(t('swapHint'));
    updateUI();
    requestDraw();
  },
  remove: removeSelectedPhoto,
  replace: () => $('#replaceInput').click(),
  deselect: () => select(-1),
  adjust: () => {
    state.adjusting = true;
    updateUI();
  },
  adjustReset: () => applyPreset('original'),
  adjustDone: () => {
    finishAdjusting(selectedPhoto());
    state.adjusting = false;
    updateUI();
    requestDraw();
  },
  makePdf: () => createExport('pdf'),
  makeJpg: () => createExport('jpg'),
  share: shareExport,
};

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const name = button.dataset.action;
  if (cellEdits[name]) {
    const c = state.cells[state.selected];
    if (c) cellEdits[name](c);
    requestDraw();
  } else {
    actions[name]?.();
  }
});

$('#fileInput').addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = ''; // allow picking the same files again
});

$('#replaceInput').addEventListener('change', (e) => {
  replaceSelectedPhoto(e.target.files[0]);
  e.target.value = '';
});

$('#dpiSelect').addEventListener('change', (e) => {
  state.settings.dpi = Number(e.target.value);
  saveSettings();
});

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe($('#stage'));

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

state.language = setLanguage(state.settings.language ?? detectLanguage());
updateUI();
