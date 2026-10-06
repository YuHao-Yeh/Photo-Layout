import { PAPER_SIZES, generateLayouts, shouldRotate } from './layout.js';
import { drawPage, cellGeometry } from './render.js';
import { buildPdf } from './pdf.js';

const MAX_PHOTOS = 12;
const LOAD_MAX_PIXELS = 3.5e6; // per photo; keeps 12 photos within iPhone memory limits
const MAX_EXPORT_PIXELS = 16e6; // iOS Safari refuses canvases above ~16.7M pixels
const MAX_ZOOM = 5;
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
  cells: [], // current layout's cells plus the user's edits (rot, zoom, panX, panY)
  selected: -1,
  swapFrom: -1,
  seed: 1,
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
      toast('The margin and spacing are too large for this paper size.');
    }
  }
  showLayout(0);
}

function showLayout(index) {
  const layout = state.layouts[index];
  state.layoutIndex = index;
  state.page = layout ? layout.page : null;
  state.cells = layout
    ? layout.cells.map((c) => ({ ...c, rot: c.rotated ? 90 : 0, zoom: 1, panX: 0, panY: 0 }))
    : [];
  state.selected = -1;
  state.swapFrom = -1;
  updateUI();
  resize();
}

function nextLayout() {
  if (state.layouts.length > 1) showLayout((state.layoutIndex + 1) % state.layouts.length);
  else regenerate({ newSeed: true });
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
    return { img: c, aspect: c.width / c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addFiles(fileList) {
  const files = [...fileList];
  const room = MAX_PHOTOS - state.photos.length;
  if (!files.length) return;
  if (room <= 0) {
    toast(`A page holds at most ${MAX_PHOTOS} photos.`);
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
  if (files.length > room) toast(`Only the first ${room} photo(s) were added; the limit is ${MAX_PHOTOS}.`);
  else if (failed) toast(`${failed} file(s) could not be opened.`);
  else if (state.photos.length === 1) toast('Add at least one more photo.');
  regenerate();
}

function removeSelectedPhoto() {
  state.photos.splice(state.cells[state.selected].photo, 1);
  regenerate();
}

function swapCells(i, j) {
  const a = state.cells[i];
  const b = state.cells[j];
  [a.photo, b.photo] = [b.photo, a.photo];
  for (const c of [a, b]) {
    c.rotated = state.settings.allowRotate && shouldRotate(c.w / c.h, state.photos[c.photo].aspect);
    c.rot = c.rotated ? 90 : 0;
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
  $('#empty').hidden = state.photos.length > 0;
  canvas.hidden = !state.page;
  $('#mainBar').hidden = editing;
  $('#cellBar').hidden = !editing;
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
  const parts = [paperName, landscape ? 'Landscape' : 'Portrait'];
  if (state.photos.length) parts.unshift(`${state.photos.length} photo${state.photos.length > 1 ? 's' : ''}`);
  $('#paperLabel').textContent = parts.join(' · ');
}

function select(index) {
  state.selected = index;
  state.swapFrom = -1;
  updateUI();
  requestDraw();
}

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

function cellAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const x = (clientX - r.left) / state.view.k;
  const y = (clientY - r.top) / state.view.k;
  return state.cells.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
}

const pinchDistance = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2 && state.selected >= 0) {
    gesture = { type: 'pinch', startDist: pinchDistance(), zoom: state.cells[state.selected].zoom };
    return;
  }
  if (pointers.size !== 1) return;

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
  gesture = { type: 'pan', x: e.clientX, y: e.clientY, panX: c.panX, panY: c.panY };
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    ...[...Object.keys(PAPER_SIZES), 'Custom'].map((name) => new Option(name, name)),
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
  status.textContent = 'Rendering…';
  await new Promise(requestAnimationFrame); // let the status message paint

  try {
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
    status.textContent = `${name} is ready (${(blob.size / 1e6).toFixed(1)} MB).`;
  } catch {
    status.textContent = 'Export failed. Try the Standard quality setting.';
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function shareExport() {
  try {
    await navigator.share({ files: [state.exportFile] });
  } catch (err) {
    if (err.name !== 'AbortError') toast('Sharing failed. Use Download instead.');
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
    c.zoom = 1;
    c.panX = c.panY = 0;
  },
};

const actions = {
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
    if (state.swapFrom >= 0) toast('Tap the photo to swap with.');
    updateUI();
    requestDraw();
  },
  remove: removeSelectedPhoto,
  deselect: () => select(-1),
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

$('#dpiSelect').addEventListener('change', (e) => {
  state.settings.dpi = Number(e.target.value);
  saveSettings();
});

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe($('#stage'));

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

updateUI();
