/**
 * Private Drive storage for signature images.
 *
 * See IMPLEMENTATION_PLAN.md §11.2.
 *
 * ---------------------------------------------------------------------------
 * PRIVATE MEANS PRIVATE
 * ---------------------------------------------------------------------------
 * Nothing here calls `setSharing`, `addViewer`, or `getDownloadUrl`, and no
 * function returns a URL. A signature is a legal mark; a link-shared signature
 * image is a forgeable asset for anyone who finds the URL.
 *
 * The only way out of Drive is `readSignature`, behind the authenticated
 * `persons.getSignature` action, which returns base64 to a signed-in caller.
 *
 * Phase 10 owns the per-quotation folder tree. This module creates ONLY the
 * private `_assets/signatures/` folder it needs.
 */

import { requireProperty } from '../config/properties';
import { ApiError } from '../errors';

/** Under the Drive root, beside — not inside — the year folders Phase 10 adds. */
export const ASSETS_FOLDER_NAME = '_assets';
export const SIGNATURES_FOLDER_NAME = 'signatures';

function rootFolder(): GoogleAppsScript.Drive.Folder {
  try {
    return DriveApp.getFolderById(requireProperty('DRIVE_ROOT_FOLDER_ID'));
  } catch (thrown: unknown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    if (message.indexOf('CONFIG_MISSING:') === 0) throw thrown;

    throw new ApiError(
      'DRIVE_AUTH_FAILED',
      'The document archive could not be opened. Check the Drive configuration.',
    );
  }
}

/**
 * Get a child folder by name, creating it when absent.
 *
 * Drive permits duplicate names, so an existing folder is always reused rather
 * than a second one created — otherwise a race during setup would silently
 * split signatures across two folders with the same name.
 */
function childFolder(
  parent: GoogleAppsScript.Drive.Folder,
  name: string,
): GoogleAppsScript.Drive.Folder {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();

  try {
    return parent.createFolder(name);
  } catch {
    throw new ApiError(
      'DRIVE_FOLDER_CREATE_FAILED',
      'The signature folder could not be created in Google Drive.',
    );
  }
}

/** `Quotation Archive / _assets / signatures /`, created on first use. */
export function signaturesFolder(): GoogleAppsScript.Drive.Folder {
  return childFolder(childFolder(rootFolder(), ASSETS_FOLDER_NAME), SIGNATURES_FOLDER_NAME);
}

export interface StoredSignature {
  fileId: string;
  byteLength: number;
}

/**
 * Store a signature and return its file id.
 *
 * Always creates a NEW file — replacing a signature never overwrites the old
 * one. Quotations reference the file id they were issued with, so overwriting
 * would retroactively change the signature on every document that person ever
 * signed. The superseded file stays in Drive, unreferenced by the sheet.
 */
export function storeSignature(
  personId: string,
  bytes: number[],
  filename: string,
): StoredSignature {
  const folder = signaturesFolder();

  // The person id and a timestamp, not the uploaded filename, so the stored
  // name cannot be steered by the caller and two uploads never collide.
  const name = `${personId}-${String(Date.now())}-${filename}`;

  try {
    const blob = Utilities.newBlob(bytes, 'image/png', name);
    const file = folder.createFile(blob);

    return { fileId: file.getId(), byteLength: bytes.length };
  } catch (thrown: unknown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);

    if (message.toLowerCase().indexOf('quota') !== -1) {
      throw new ApiError(
        'DRIVE_QUOTA_EXCEEDED',
        'Google Drive is out of space. Free some space and try again.',
      );
    }
    throw new ApiError('DRIVE_UPLOAD_FAILED', 'The signature could not be saved to Google Drive.');
  }
}

/**
 * Read a stored signature as base64.
 *
 * Returns null when the file is gone, so the caller can say so specifically
 * rather than failing with something generic — a signature that will not load
 * has to be reported clearly, never silently omitted from a document.
 */
export function readSignature(fileId: string): string | null {
  if (fileId.length === 0) return null;

  try {
    const file = DriveApp.getFileById(fileId);
    return Utilities.base64Encode(file.getBlob().getBytes());
  } catch {
    return null;
  }
}

/** True when the referenced file is still readable. */
export function signatureExists(fileId: string): boolean {
  if (fileId.length === 0) return false;

  try {
    DriveApp.getFileById(fileId);
    return true;
  } catch {
    return false;
  }
}
