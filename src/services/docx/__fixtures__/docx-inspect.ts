/**
 * TEST ONLY — read a generated DOCX back.
 *
 * Every fidelity claim in this phase is asserted against the PARSED PACKAGE,
 * not against the builder's intentions. "The table header repeats" is only
 * meaningful if `w:tblHeader` can be found in the `word/document.xml` of the
 * finished bytes.
 *
 * A `.docx` is a ZIP of XML parts, so the whole inspection is: unzip, parse,
 * assert. `jszip` is already present (it is what `docx` packs with) and jsdom
 * supplies a real XML parser, so nothing is added to the dependency list to
 * make these assertions possible.
 */

import JSZip from 'jszip';

export interface DocxPackage {
  /** Every path inside the ZIP, sorted. */
  entries: string[];
  /** Part path → its text, for the XML parts. */
  parts: Map<string, string>;
  /** Part path → byte length, including the images. */
  sizes: Map<string, number>;
}

const XML_PART = /\.(xml|rels)$/;

export async function TEST_ONLY_openDocx(bytes: Uint8Array): Promise<DocxPackage> {
  const zip = await JSZip.loadAsync(bytes);

  const entries: string[] = [];
  const parts = new Map<string, string>();
  const sizes = new Map<string, number>();

  for (const path of Object.keys(zip.files)) {
    const file = zip.files[path];
    if (file === undefined || file.dir) continue;

    entries.push(path);

    const data = await file.async('uint8array');
    sizes.set(path, data.byteLength);

    if (XML_PART.test(path)) {
      parts.set(path, await file.async('string'));
    }
  }

  entries.sort();
  return { entries, parts, sizes };
}

/** A part's XML, or a failing assertion's worth of context if it is absent. */
export function TEST_ONLY_part(pkg: DocxPackage, path: string): string {
  const xml = pkg.parts.get(path);
  if (xml === undefined) {
    throw new Error(`The package has no ${path}. It contains: ${pkg.entries.join(', ')}`);
  }
  return xml;
}

/** Every header part, in package order. There is normally exactly one. */
export function TEST_ONLY_headerParts(pkg: DocxPackage): string[] {
  return pkg.entries
    .filter((path) => /^word\/header\d*\.xml$/.test(path))
    .map((path) => TEST_ONLY_part(pkg, path));
}

export function TEST_ONLY_footerParts(pkg: DocxPackage): string[] {
  return pkg.entries
    .filter((path) => /^word\/footer\d*\.xml$/.test(path))
    .map((path) => TEST_ONLY_part(pkg, path));
}

/**
 * Parse a part, failing loudly on malformed XML.
 *
 * jsdom's DOMParser reports a parse failure as a `<parsererror>` element rather
 * than by throwing, which is easy to miss — hence the explicit check.
 */
export function TEST_ONLY_parseXml(xml: string): Document {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  const error = parsed.querySelector('parsererror');

  if (error !== null) {
    throw new Error(`The part is not well-formed XML: ${error.textContent ?? ''}`);
  }
  return parsed;
}

/**
 * All visible text of a part, in document order.
 *
 * Word splits a sentence across several `w:t` elements whenever formatting
 * changes, so a test looking for a phrase has to join them first.
 */
export function TEST_ONLY_textOf(xml: string): string {
  const document_ = TEST_ONLY_parseXml(xml);
  const runs = document_.getElementsByTagName('w:t');

  let text = '';
  for (let index = 0; index < runs.length; index += 1) {
    text += runs[index]?.textContent ?? '';
  }
  return text;
}

/** The text of each paragraph, in order. */
export function TEST_ONLY_paragraphs(xml: string): string[] {
  const document_ = TEST_ONLY_parseXml(xml);
  const paragraphs = document_.getElementsByTagName('w:p');

  const result: string[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (paragraph === undefined) continue;

    const runs = paragraph.getElementsByTagName('w:t');
    let text = '';
    for (let run = 0; run < runs.length; run += 1) {
      text += runs[run]?.textContent ?? '';
    }
    result.push(text);
  }
  return result;
}

export interface ParsedTable {
  /** Each row's cell texts. */
  rows: string[][];
  /** Rows carrying `w:tblHeader`. */
  headerRowIndexes: number[];
  /** Rows carrying `w:cantSplit`. */
  cantSplitRowIndexes: number[];
  /** The `w:gridCol` widths, in twips. */
  columnWidths: number[];
}

/** Every TOP-LEVEL table of a part. Nested tables are not used by this renderer. */
export function TEST_ONLY_tables(xml: string): ParsedTable[] {
  const document_ = TEST_ONLY_parseXml(xml);
  const tables = document_.getElementsByTagName('w:tbl');

  const parsed: ParsedTable[] = [];

  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    if (table === undefined) continue;

    const rows: string[][] = [];
    const headerRowIndexes: number[] = [];
    const cantSplitRowIndexes: number[] = [];

    const rowElements = table.getElementsByTagName('w:tr');
    for (let rowIndex = 0; rowIndex < rowElements.length; rowIndex += 1) {
      const row = rowElements[rowIndex];
      if (row === undefined) continue;

      if (row.getElementsByTagName('w:tblHeader').length > 0) headerRowIndexes.push(rowIndex);
      if (row.getElementsByTagName('w:cantSplit').length > 0) cantSplitRowIndexes.push(rowIndex);

      const cells: string[] = [];
      const cellElements = row.getElementsByTagName('w:tc');

      for (let cellIndex = 0; cellIndex < cellElements.length; cellIndex += 1) {
        const cell = cellElements[cellIndex];
        if (cell === undefined) continue;

        const runs = cell.getElementsByTagName('w:t');
        let text = '';
        for (let run = 0; run < runs.length; run += 1) {
          text += runs[run]?.textContent ?? '';
        }
        cells.push(text);
      }
      rows.push(cells);
    }

    const gridColumns = table.getElementsByTagName('w:gridCol');
    const columnWidths: number[] = [];
    for (let column = 0; column < gridColumns.length; column += 1) {
      columnWidths.push(Number(gridColumns[column]?.getAttribute('w:w') ?? '0'));
    }

    parsed.push({ rows, headerRowIndexes, cantSplitRowIndexes, columnWidths });
  }

  return parsed;
}

export interface SectionGeometry {
  widthTwips: number;
  heightTwips: number;
  margins: { top: number; bottom: number; left: number; right: number };
  headerReferenceIds: string[];
  footerReferenceIds: string[];
}

/** The section properties Word will apply to every page. */
export function TEST_ONLY_section(xml: string): SectionGeometry {
  const document_ = TEST_ONLY_parseXml(xml);
  const properties = document_.getElementsByTagName('w:sectPr')[0];

  if (properties === undefined) {
    throw new Error('The document has no section properties.');
  }

  const size = properties.getElementsByTagName('w:pgSz')[0];
  const margin = properties.getElementsByTagName('w:pgMar')[0];

  const attribute = (element: Element | undefined, name: string): number =>
    Number(element?.getAttribute(name) ?? '0');

  const references = (tag: string): string[] => {
    const found = properties.getElementsByTagName(tag);
    const ids: string[] = [];
    for (let index = 0; index < found.length; index += 1) {
      ids.push(found[index]?.getAttribute('r:id') ?? '');
    }
    return ids;
  };

  return {
    widthTwips: attribute(size, 'w:w'),
    heightTwips: attribute(size, 'w:h'),
    margins: {
      top: attribute(margin, 'w:top'),
      bottom: attribute(margin, 'w:bottom'),
      left: attribute(margin, 'w:left'),
      right: attribute(margin, 'w:right'),
    },
    headerReferenceIds: references('w:headerReference'),
    footerReferenceIds: references('w:footerReference'),
  };
}

/** The `w:numPr` references a part uses: `[{ id, level }]`, in order. */
export function TEST_ONLY_numberingReferences(xml: string): Array<{ id: number; level: number }> {
  const document_ = TEST_ONLY_parseXml(xml);
  const properties = document_.getElementsByTagName('w:numPr');

  const references: Array<{ id: number; level: number }> = [];

  for (let index = 0; index < properties.length; index += 1) {
    const element = properties[index];
    if (element === undefined) continue;

    const id = element.getElementsByTagName('w:numId')[0]?.getAttribute('w:val');
    const level = element.getElementsByTagName('w:ilvl')[0]?.getAttribute('w:val');

    if (id !== null && id !== undefined) {
      references.push({ id: Number(id), level: Number(level ?? '0') });
    }
  }

  return references;
}

/** Relationship id → target, for a part's `.rels`. */
export function TEST_ONLY_relationships(pkg: DocxPackage, partPath: string): Map<string, string> {
  const slash = partPath.lastIndexOf('/');
  const directory = partPath.slice(0, slash);
  const name = partPath.slice(slash + 1);

  const relationships = new Map<string, string>();
  const xml = pkg.parts.get(`${directory}/_rels/${name}.rels`);
  if (xml === undefined) return relationships;

  const document_ = TEST_ONLY_parseXml(xml);
  const found = document_.getElementsByTagName('Relationship');

  for (let index = 0; index < found.length; index += 1) {
    const element = found[index];
    if (element === undefined) continue;

    relationships.set(element.getAttribute('Id') ?? '', element.getAttribute('Target') ?? '');
  }

  return relationships;
}

export interface DrawingInfo {
  /** `behindDoc` on the anchor, when the drawing is floating. */
  behindDocument: boolean;
  isFloating: boolean;
  /** Extent in EMU. */
  widthEmu: number;
  heightEmu: number;
  /** The image relationship id it embeds. */
  embedId: string;
}

/** Every `w:drawing` of a part. */
export function TEST_ONLY_drawings(xml: string): DrawingInfo[] {
  const document_ = TEST_ONLY_parseXml(xml);
  const drawings = document_.getElementsByTagName('w:drawing');

  const parsed: DrawingInfo[] = [];

  for (let index = 0; index < drawings.length; index += 1) {
    const drawing = drawings[index];
    if (drawing === undefined) continue;

    const anchor = drawing.getElementsByTagName('wp:anchor')[0];
    const extent = drawing.getElementsByTagName('wp:extent')[0];
    const blip = drawing.getElementsByTagName('a:blip')[0];

    parsed.push({
      isFloating: anchor !== undefined,
      behindDocument: anchor?.getAttribute('behindDoc') === '1',
      widthEmu: Number(extent?.getAttribute('cx') ?? '0'),
      heightEmu: Number(extent?.getAttribute('cy') ?? '0'),
      embedId: blip?.getAttribute('r:embed') ?? '',
    });
  }

  return parsed;
}
