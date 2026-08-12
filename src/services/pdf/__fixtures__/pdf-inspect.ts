/**
 * TEST ONLY — read a generated PDF back.
 *
 * Every fidelity claim in this phase is asserted against the PARSED OUTPUT, not
 * against the generator's intentions. "The quotation number is in the PDF" is
 * only meaningful if it can be extracted from the finished bytes.
 *
 * Extraction also proves the output is real text: a rasterised page would yield
 * nothing at all, which is itself the assertion that the document is selectable
 * and searchable.
 */

import { createCanvas } from '@napi-rs/canvas';

export interface TextItem {
  text: string;
  /** Top-left coordinates, matching every measurement in this project. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParsedPage {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  items: TextItem[];
  text: string;
}

interface PdfJsModule {
  getDocument: (options: Record<string, unknown>) => { promise: Promise<PdfJsDocument> };
}

interface PdfJsDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
}

interface PdfJsPage {
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
  };
  getTextContent: () => Promise<{ items: unknown[] }>;
  render: (options: Record<string, unknown>) => { promise: Promise<void> };
}

async function pdfjs(): Promise<PdfJsModule> {
  return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule;
}

/** Parse every page's text, with positions converted to top-left. */
export async function TEST_ONLY_parsePdf(bytes: Uint8Array): Promise<ParsedPage[]> {
  const lib = await pdfjs();
  const document = await lib.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
  }).promise;

  const pages: ParsedPage[] = [];

  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items: TextItem[] = [];

    for (const raw of content.items) {
      const item = raw as {
        str?: unknown;
        transform?: unknown;
        width?: unknown;
        height?: unknown;
      };

      const text = typeof item.str === 'string' ? item.str : '';
      if (text.trim().length === 0) continue;

      const transform = Array.isArray(item.transform) ? (item.transform as number[]) : [];
      const x = transform[4] ?? 0;
      const baselineY = transform[5] ?? 0;
      const height = typeof item.height === 'number' ? item.height : 0;

      items.push({
        text,
        x,
        // pdf.js reports the baseline in bottom-left space; convert to the
        // top-left space every measurement in this project uses.
        y: viewport.height - baselineY - height,
        width: typeof item.width === 'number' ? item.width : 0,
        height,
      });
    }

    pages.push({
      pageNumber: number,
      widthPt: viewport.width,
      heightPt: viewport.height,
      items,
      text: items.map((item) => item.text).join(' '),
    });
  }

  return pages;
}

/** Rasterise one page, for pixel assertions such as the letterhead's red rule. */
export async function TEST_ONLY_rasterise(
  bytes: Uint8Array,
  pageNumber: number,
  scale = 2,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const lib = await pdfjs();
  const document = await lib.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
  }).promise;

  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));

  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;

  const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: image.data };
}

/** Top-left y bands where a colour appears across at least `minPixels` of a row. */
export function TEST_ONLY_colourRows(
  raster: { width: number; height: number; data: Uint8ClampedArray },
  hex: string,
  minPixels: number,
  scale = 2,
): number[] {
  const target = {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };

  const rows: number[] = [];

  for (let y = 0; y < raster.height; y++) {
    let count = 0;

    for (let x = 0; x < raster.width; x++) {
      const index = (y * raster.width + x) * 4;
      if (
        Math.abs((raster.data[index] ?? 0) - target.r) < 24 &&
        Math.abs((raster.data[index + 1] ?? 0) - target.g) < 24 &&
        Math.abs((raster.data[index + 2] ?? 0) - target.b) < 24
      ) {
        count += 1;
      }
    }

    if (count >= minPixels) rows.push(y / scale);
  }

  return rows;
}

/** The bounding box of every text item on a page, in top-left coordinates. */
export function TEST_ONLY_textBounds(page: ParsedPage): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return page.items.reduce(
    (bounds, item) => ({
      minX: Math.min(bounds.minX, item.x),
      maxX: Math.max(bounds.maxX, item.x + item.width),
      minY: Math.min(bounds.minY, item.y),
      maxY: Math.max(bounds.maxY, item.y + item.height),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
}
