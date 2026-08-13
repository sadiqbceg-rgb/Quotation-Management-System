/**
 * Drive identifiers and links, as distinct types.
 *
 * ---------------------------------------------------------------------------
 * WHY BRAND THEM
 * ---------------------------------------------------------------------------
 * A Drive file id and a Drive URL are both strings, they travel together in
 * every response, and putting one where the other belongs produces a link that
 * looks plausible and goes nowhere. Worse, an id pasted into a page as a link
 * is an id leaked into a place it was never meant to appear.
 *
 * So they are branded, and the only way to build either is through a
 * constructor that validates it.
 *
 * A `DriveUrl` here is always a `webViewLink` — the page a signed-in user with
 * access can open. It is never a download URL and never a sharing link: the
 * application never widens Drive permissions (§16.5).
 */

import { PATTERNS } from './validation-rules';

declare const driveFileIdBrand: unique symbol;
declare const driveUrlBrand: unique symbol;

/** A Drive file or folder id. Never rendered as a link. */
export type DriveFileId = string & { readonly [driveFileIdBrand]: 'DriveFileId' };

/** A `https://drive.google.com/…` webViewLink. */
export type DriveUrl = string & { readonly [driveUrlBrand]: 'DriveUrl' };

/**
 * Drive ids are opaque, but they are always URL-safe base64-ish and bounded.
 * The check exists to stop a path fragment or an empty string being carried
 * around as an id, not to validate Google's format.
 */
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isDriveFileId(value: string): boolean {
  return FILE_ID_PATTERN.test(value);
}

export function isDriveUrl(value: string): boolean {
  return PATTERNS.driveUrl.test(value);
}

export class DriveLinkError extends Error {
  public override readonly name = 'DriveLinkError';
}

export function driveFileId(value: string): DriveFileId {
  if (!isDriveFileId(value)) {
    throw new DriveLinkError('That is not a Drive file id.');
  }
  return value as DriveFileId;
}

/**
 * Brand a URL, refusing anything that is not a Drive link.
 *
 * The refusal matters: this is what stops a malformed or fabricated link
 * reaching the UI as a working one. PRD §34 forbids fake Drive URLs, and a
 * validated constructor is how that becomes impossible rather than a rule
 * someone has to remember.
 */
export function driveUrl(value: string): DriveUrl {
  if (!isDriveUrl(value)) {
    throw new DriveLinkError('That is not a Google Drive link.');
  }
  return value as DriveUrl;
}

/** A stored document: where it is, and where a person can open it. */
export interface DriveTarget {
  fileId: DriveFileId;
  url: DriveUrl;
  name: string;
}

/**
 * Re-brand a target that arrived over the wire.
 *
 * The server sends plain JSON, so the brands are gone by the time the browser
 * sees them. Passing every response through here means a malformed link fails
 * at the boundary rather than becoming a dead link in the success panel.
 */
export function parseDriveTarget(value: unknown): DriveTarget {
  if (typeof value !== 'object' || value === null) {
    throw new DriveLinkError('The server did not return a Drive location.');
  }

  const record = value as { fileId?: unknown; url?: unknown; name?: unknown };

  if (typeof record.fileId !== 'string' || typeof record.url !== 'string') {
    throw new DriveLinkError('The server did not return a Drive location.');
  }

  return {
    fileId: driveFileId(record.fileId),
    url: driveUrl(record.url),
    name: typeof record.name === 'string' ? record.name : '',
  };
}
