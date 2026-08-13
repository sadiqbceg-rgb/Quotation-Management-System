/**
 * Filing a quotation's documents in the Drive archive.
 *
 * See IMPLEMENTATION_PLAN.md §16 and PRD §30 steps 5–12.
 *
 *     Quotation Archive / 2026 / August / SFC-RUH-QTN-2026-004 /
 *                                          SFC-RUH-QTN-2026-004.pdf
 *                                          SFC-RUH-QTN-2026-004.docx
 *
 * ---------------------------------------------------------------------------
 * THE PARTIAL CASE IS NOT AN EDGE CASE
 * ---------------------------------------------------------------------------
 * Two uploads, and the second can fail on its own — Drive quota, a timeout, a
 * transient 500. Reporting that as "failed" would be a lie the user could act
 * on wrongly (the PDF IS in the archive, and re-uploading it is wasted work);
 * reporting it as "success" would be worse.
 *
 * So the result is a discriminated union and `partial` is a first-class
 * outcome, carrying the links that DID work and naming what is missing. The
 * caller cannot ignore it: the type will not narrow without handling it.
 *
 * Completeness is decided by READING THE FOLDER, not by remembering what this
 * request uploaded — which is what makes a retry that sends only the missing
 * document report `success` once both files are actually there.
 */

import {
  documentFileName,
  quotationFolderSegments,
  type DocumentKind,
} from '@shared/drive-paths';
import type { DriveTarget } from '@shared/drive-links';
import type { QuotationCodes } from '@shared/numbering';
import { ApiError } from '../errors';
import type { ValidatedDocument } from '../validation/document-validator';
import { targetOf } from './drive-urls';
import { findByName, uploadOrReplace, type UploadedDocument } from './file-upload';
import { resolveFolderPath, type ResolveDependencies } from './folder-resolver';

export interface StoreQuotationInput {
  /** The number the application ISSUED. Never re-derived here (PRD §5). */
  quotationNumber: string;
  /** ISO `YYYY-MM-DD`. Decides the year and month folders, not the clock. */
  quotationDate: string;
  codes: QuotationCodes;
  /**
   * What to upload. A first save carries both; a retry may carry only what is
   * missing, and anything already in the folder is left untouched.
   */
  documents: Partial<Record<DocumentKind, ValidatedDocument>>;
}

export interface StoredDocuments {
  pdf: DriveTarget | null;
  docx: DriveTarget | null;
}

/**
 * Where the documents ended up.
 *
 * `folder` is always present on both outcomes: the folder exists as soon as
 * resolution succeeds, and a user whose DOCX failed still wants the link to
 * where the PDF is.
 */
export type StoreQuotationResult =
  | {
      outcome: 'success';
      folder: DriveTarget;
      path: string[];
      files: { pdf: DriveTarget; docx: DriveTarget };
      uploaded: UploadedDocument[];
    }
  | {
      outcome: 'partial';
      folder: DriveTarget;
      path: string[];
      files: StoredDocuments;
      uploaded: UploadedDocument[];
      /** What still has to be uploaded before this quotation is filed. */
      missing: DocumentKind[];
    };

export type StoreDependencies = ResolveDependencies;

const KINDS: readonly DocumentKind[] = ['pdf', 'docx'];

/**
 * File a quotation's documents.
 *
 * Folder resolution happens first and under its own lock; the uploads run
 * outside it (§15.6). If resolution fails there is nothing to clean up, and if
 * an upload fails the folder is still correct for the retry.
 */
export function storeQuotationDocuments(
  input: StoreQuotationInput,
  dependencies: StoreDependencies = {},
): StoreQuotationResult {
  const path = quotationFolderSegments(input.quotationDate, input.quotationNumber, input.codes);

  const supplied = KINDS.filter((kind) => input.documents[kind] !== undefined);
  if (supplied.length === 0) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'No quotation documents were supplied for upload.',
    );
  }

  const folder = resolveFolderPath(path, dependencies);

  const uploaded: UploadedDocument[] = [];
  const files: StoredDocuments = { pdf: null, docx: null };
  const missing: DocumentKind[] = [];

  /*
   * Upload what was supplied; then, for anything that was not, look for a copy
   * already in the folder. That second step is what makes a retry of only the
   * missing document able to report success.
   *
   * A failure on the SECOND document does not undo the first: the PDF is in the
   * archive, its link is real, and pretending otherwise would send the user
   * back to re-upload something that is already there.
   */
  for (const kind of KINDS) {
    const name = documentFileName(input.quotationNumber, kind, input.codes);
    const document = input.documents[kind];

    if (document !== undefined) {
      try {
        const result = uploadOrReplace(folder, name, document);
        uploaded.push(result);
        files[kind] = { fileId: result.fileId, url: result.url, name: result.name };
        continue;
      } catch (thrown: unknown) {
        /*
         * An EMPTY archive folder means the whole save failed — Drive is
         * refusing, and the specific code (quota, permission) is far more use to
         * the user than "partial". Once anything is in the folder, whether from
         * this request or an earlier attempt, a later failure is genuinely
         * partial and has to be reported as such.
         */
        const stored = uploaded.length > 0 || files.pdf !== null || files.docx !== null;
        if (!stored) throw thrown;

        missing.push(kind);
        continue;
      }
    }

    const existing = findByName(folder, name);
    if (existing === null) {
      missing.push(kind);
    } else {
      files[kind] = targetOf(existing);
    }
  }

  const folderTarget = targetOf(folder);

  if (missing.length === 0 && files.pdf !== null && files.docx !== null) {
    return {
      outcome: 'success',
      folder: folderTarget,
      path,
      files: { pdf: files.pdf, docx: files.docx },
      uploaded,
    };
  }

  return {
    outcome: 'partial',
    folder: folderTarget,
    path,
    files,
    uploaded,
    missing,
  };
}
