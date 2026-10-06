// Colour adjustments (調色) applied directly to pixel data. Done by hand rather
// than with canvas `filter`, which Safari only supports from iOS 18.
//
// Every value runs from -100 to 100, with 0 meaning "unchanged".

export const NEUTRAL = Object.freeze({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 });

export const PRESETS = {
  original: NEUTRAL,
  bw: { brightness: 0, contrast: 15, saturation: -100, warmth: 0 },
  vivid: { brightness: 0, contrast: 15, saturation: 40, warmth: 0 },
  warm: { brightness: 5, contrast: 0, saturation: 10, warmth: 40 },
  cool: { brightness: 0, contrast: 5, saturation: 0, warmth: -40 },
};

export const isNeutral = (adj) => Object.keys(NEUTRAL).every((k) => !adj[k]);

/** Lookup table for brightness and contrast (same for every channel). */
function toneTable({ brightness = 0, contrast = 0 }) {
  const shift = brightness * 0.64; // up to ±64 levels
  const gain = contrast >= 0 ? 1 + contrast / 100 * 1.5 : 1 + contrast / 100; // 0 … 2.5
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) table[v] = (v + shift - 128) * gain + 128;
  return table;
}

/**
 * Adjusts RGBA pixel data (e.g. ImageData.data) in place.
 * Order: brightness/contrast, then saturation, then warmth, so a warm tint
 * survives on a black-and-white photo (giving a sepia look).
 * @param {Uint8ClampedArray} data
 * @param {{brightness?:number, contrast?:number, saturation?:number, warmth?:number}} adj
 */
export function applyAdjustments(data, adj) {
  const tone = toneTable(adj);
  const sat = 1 + (adj.saturation || 0) / 100; // 0 = greyscale, 2 = double
  const satChanged = sat !== 1;
  const warm = (adj.warmth || 0) * 0.3; // red up / blue down by up to 30 levels
  for (let i = 0; i < data.length; i += 4) {
    let R = tone[data[i]];
    let G = tone[data[i + 1]];
    let B = tone[data[i + 2]];
    if (satChanged) {
      const grey = 0.299 * R + 0.587 * G + 0.114 * B;
      R = grey + (R - grey) * sat;
      G = grey + (G - grey) * sat;
      B = grey + (B - grey) * sat;
    }
    data[i] = R + warm; // Uint8ClampedArray rounds and clamps to 0..255
    data[i + 1] = G;
    data[i + 2] = B - warm;
  }
}
