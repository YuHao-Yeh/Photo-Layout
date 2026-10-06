// Draws a layout onto a 2D canvas. Used for both the on-screen preview and
// the full-resolution export, so what you see is what you get.
//
// Each cell carries the user's adjustments:
//   rot   0 | 90 | 180 | 270  clockwise rotation of the photo inside the cell
//   zoom  >= 1                1 = photo just covers the cell
//   panX, panY  -1..1         how far the photo is shifted within its overflow

/** Scale and maximum pan offsets (in pixels) of a photo covering its cell. */
export function cellGeometry(cell, img, k) {
  const quarterTurn = cell.rot % 180 !== 0;
  const rw = quarterTurn ? img.height : img.width;
  const rh = quarterTurn ? img.width : img.height;
  const cw = cell.w * k;
  const ch = cell.h * k;
  const scale = Math.max(cw / rw, ch / rh) * cell.zoom;
  return {
    scale,
    maxX: Math.max(0, (rw * scale - cw) / 2),
    maxY: Math.max(0, (rh * scale - ch) / 2),
  };
}

function drawCell(ctx, cell, img, k) {
  const { scale, maxX, maxY } = cellGeometry(cell, img, k);
  const x = cell.x * k;
  const y = cell.y * k;
  const w = cell.w * k;
  const h = cell.h * k;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x + w / 2 + cell.panX * maxX, y + h / 2 + cell.panY * maxY);
  ctx.rotate((cell.rot * Math.PI) / 180);
  ctx.drawImage(img, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale);
  ctx.restore();
}

function outlineCell(ctx, cell, k, color, dashed) {
  const lw = 3;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash(dashed ? [8, 6] : []);
  ctx.strokeRect(cell.x * k + lw / 2, cell.y * k + lw / 2, cell.w * k - lw, cell.h * k - lw);
  ctx.restore();
}

// A pill-shaped grip in the middle of each cut line, hinting that it can be
// dragged to resize the frames on either side.
function drawHandle(ctx, d, k, active) {
  const long = 28;
  const short = 6;
  const horizontalCut = d.dir === 'h'; // vertical line between side-by-side frames
  const cx = (horizontalCut ? d.pos : d.x + d.w / 2) * k;
  const cy = (horizontalCut ? d.y + d.h / 2 : d.pos) * k;
  const w = horizontalCut ? short : long;
  const h = horizontalCut ? long : short;
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(cx - w / 2, cy - h / 2, w, h, short / 2);
  else ctx.rect(cx - w / 2, cy - h / 2, w, h); // iOS < 16
  ctx.fillStyle = active ? '#1f6feb' : 'rgba(255, 255, 255, 0.95)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 3;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1;
  ctx.strokeStyle = active ? '#ffffff' : 'rgba(0, 0, 0, 0.25)';
  ctx.stroke();
  ctx.restore();
}

/**
 * @param k pixels per page unit (mm)
 * @param opts.selected / opts.swapFrom cell indices to highlight (preview only)
 * @param opts.dividers cut lines to draw resize handles on (preview only)
 * @param opts.activeDivider the divider being dragged
 */
export function drawPage(ctx, page, cells, photos, k, opts = {}) {
  const { background = '#ffffff', selected = -1, swapFrom = -1, dividers = [], activeDivider = null } = opts;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, page.width * k, page.height * k);
  for (const cell of cells) drawCell(ctx, cell, photos[cell.photo].img, k);
  if (cells[swapFrom]) outlineCell(ctx, cells[swapFrom], k, '#f5a524', true);
  if (cells[selected] && selected !== swapFrom) outlineCell(ctx, cells[selected], k, '#1f6feb', false);
  for (const d of dividers) drawHandle(ctx, d, k, d.node === activeDivider);
}
