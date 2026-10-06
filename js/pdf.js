// Minimal PDF writer: one page showing one full-bleed JPEG image.
// Avoids pulling in a PDF library for the only thing we need.

const encoder = new TextEncoder();
const num = (n) => String(Math.round(n * 100) / 100);

/**
 * @param {{widthPt:number, heightPt:number, jpeg:Uint8Array, imageWidth:number, imageHeight:number}} opts
 *   page size in PostScript points (1/72 inch) and the JPEG's pixel size.
 * @returns {Uint8Array} the PDF file bytes
 */
export function buildPdf({ widthPt, heightPt, jpeg, imageWidth, imageHeight }) {
  const w = num(widthPt);
  const h = num(heightPt);
  const parts = [];
  const offsets = [];
  let length = 0;

  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id, body) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  // Header plus a comment of high bytes, which marks the file as binary.
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  );

  offsets[4] = length;
  push(
    '4 0 obj\n' +
      `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n` +
      'stream\n',
  );
  push(jpeg);
  push('\nendstream\nendobj\n');

  const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);

  const xref = length;
  push(
    'xref\n0 6\n0000000000 65535 f \n' +
      offsets
        .slice(1)
        .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
        .join(''),
  );
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
