/**
 * The quotation's Word body: every block, in the model's order.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO PAGINATION HERE
 * ---------------------------------------------------------------------------
 * Word paginates. The shared paginator (§12.3) exists because a PDF page has to
 * be filled by hand and the HTML preview has to show what the PDF will do; Word
 * already breaks pages, repeats table headers through `w:tblHeader`, and keeps
 * the signature block whole through `cantSplit`.
 *
 * So this renderer expresses the same POLICY through Word's own primitives
 * rather than pre-computing the breaks — running the paginator and then
 * inserting hard page breaks would fight Word the moment the company edits the
 * file, which they will.
 *
 * `paginate()` is still used, but only to count pages for the caller.
 */

import type { Paragraph, Table } from 'docx';

import type { DocumentModel } from '@/services/document/document-model.types';
import { renderBlock, type BlockRenderContext, type DocxBlockElement } from './blocks';

export type { BlockRenderContext, DocxBlockElement };

/** Every block of the model, rendered in order. */
export function buildBody(
  model: DocumentModel,
  context: BlockRenderContext,
): (Paragraph | Table)[] {
  return model.blocks.flatMap((block) => renderBlock(block, context));
}
