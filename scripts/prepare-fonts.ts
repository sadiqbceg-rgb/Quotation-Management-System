/**
 * Produce the bundled Carlito TTFs from the licensed source package.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `src/assets/fonts/*.ttf` are committed binaries, and a committed binary with
 * no recorded origin is a liability: nobody can tell later whether it is the
 * licensed font, a modified copy, or something someone found. This script is
 * the origin, written down and re-runnable.
 *
 * Source: `@fontsource/carlito` (a devDependency), which redistributes Carlito
 * under the SIL Open Font License. It ships WOFF rather than TTF, so the tables
 * are unwrapped back into a plain SFNT here — a WOFF is exactly an SFNT with
 * per-table zlib compression and a different header, so this is a lossless
 * repackaging and not a conversion.
 *
 * The `latin` subset is used: the document is English, and the only Arabic in
 * it lives inside the letterhead artwork, which this renderer never re-typesets
 * (§13.2).
 *
 * NOT part of `prebuild`. The outputs are committed, so this runs only when the
 * font is deliberately updated.
 *
 * Run:  node scripts/prepare-fonts.ts
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SOURCE = join(ROOT, 'node_modules', '@fontsource', 'carlito');
const OUTPUT = join(ROOT, 'src', 'assets', 'fonts');

interface WoffTable {
  tag: string;
  offset: number;
  compLength: number;
  origLength: number;
  checksum: number;
}

/**
 * Unwrap a WOFF into the SFNT it contains.
 *
 * WOFF = a 44-byte header, a table directory, and each table stored either raw
 * or zlib-compressed. Rebuilding the SFNT means decompressing each table and
 * writing the standard header plus a 4-byte-aligned table directory.
 */
function woffToSfnt(woff: Buffer): Buffer {
  if (woff.subarray(0, 4).toString('latin1') !== 'wOFF') {
    throw new Error('Source is not a WOFF file.');
  }

  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);

  const tables: WoffTable[] = [];
  for (let index = 0; index < numTables; index++) {
    const offset = 44 + index * 20;
    tables.push({
      tag: woff.subarray(offset, offset + 4).toString('latin1'),
      offset: woff.readUInt32BE(offset + 4),
      compLength: woff.readUInt32BE(offset + 8),
      origLength: woff.readUInt32BE(offset + 12),
      checksum: woff.readUInt32BE(offset + 16),
    });
  }

  const decoded = tables.map((table) => {
    const raw = woff.subarray(table.offset, table.offset + table.compLength);
    const data = table.compLength < table.origLength ? inflateSync(raw) : raw;

    if (data.length !== table.origLength) {
      throw new Error(`Table ${table.tag} decompressed to the wrong length.`);
    }
    return { table, data };
  });

  // An SFNT's table directory must be sorted by tag.
  decoded.sort((a, b) => (a.table.tag < b.table.tag ? -1 : 1));

  const headerSize = 12 + numTables * 16;
  let cursor = headerSize;

  const placed = decoded.map((entry) => {
    const at = cursor;
    cursor += Math.ceil(entry.data.length / 4) * 4;
    return { ...entry, at };
  });

  const out = Buffer.alloc(cursor);
  const highestPowerOfTwo = Math.floor(Math.log2(numTables));

  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(16 * 2 ** highestPowerOfTwo, 6);
  out.writeUInt16BE(highestPowerOfTwo, 8);
  out.writeUInt16BE(numTables * 16 - 16 * 2 ** highestPowerOfTwo, 10);

  placed.forEach((entry, index) => {
    const record = 12 + index * 16;
    out.write(entry.table.tag, record, 4, 'latin1');
    out.writeUInt32BE(entry.table.checksum, record + 4);
    out.writeUInt32BE(entry.at, record + 8);
    out.writeUInt32BE(entry.data.length, record + 12);
    entry.data.copy(out, entry.at);
  });

  return out;
}

function main(): void {
  mkdirSync(OUTPUT, { recursive: true });

  const faces = [
    ['carlito-latin-400-normal.woff', 'Carlito-Regular.ttf'],
    ['carlito-latin-700-normal.woff', 'Carlito-Bold.ttf'],
  ] as const;

  for (const [source, target] of faces) {
    const sfnt = woffToSfnt(readFileSync(join(SOURCE, 'files', source)));
    writeFileSync(join(OUTPUT, target), sfnt);
    console.log(`  ${target.padEnd(24)} ${(sfnt.length / 1024).toFixed(1).padStart(7)} KB`);
  }

  // The OFL requires the licence to travel with the font.
  copyFileSync(join(SOURCE, 'LICENSE'), join(OUTPUT, 'OFL.txt'));
  console.log('  OFL.txt                  (copied from @fontsource/carlito)');
}

main();
