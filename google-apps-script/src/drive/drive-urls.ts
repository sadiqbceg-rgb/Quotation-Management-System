/**
 * The links returned to the browser.
 *
 * See IMPLEMENTATION_PLAN.md §16.5.
 *
 * ---------------------------------------------------------------------------
 * WHAT LEAVES THE SERVER
 * ---------------------------------------------------------------------------
 * A `webViewLink` and a file id. Nothing else — no download URL, no export
 * link, no access token. A `webViewLink` is not a grant: it opens for someone
 * who already has access to the archive and 404s for anyone who does not. The
 * application never widens Drive permissions, so a leaked link is not a leaked
 * document.
 *
 * `getUrl()` is DriveApp's own view link, so the URL is read from Drive rather
 * than assembled from an id — a hand-built `drive.google.com/…/<id>` would be a
 * fabricated URL, which PRD §34 forbids, and would silently rot if Google's
 * link format changed.
 */

import { driveFileId, driveUrl, type DriveTarget } from '@shared/drive-links';
import { ApiError } from '../errors';

/** Anything DriveApp returns that has an id, a name and a URL. */
export interface DriveResource {
  getId: () => string;
  getName: () => string;
  getUrl: () => string;
}

/**
 * Read a file's or folder's identity and link.
 *
 * Both are validated on the way out. A blank or malformed URL fails here rather
 * than arriving in the success panel as a link that goes nowhere.
 */
export function targetOf(resource: DriveResource): DriveTarget {
  const id = resource.getId();
  const url = resource.getUrl();

  try {
    return { fileId: driveFileId(id), url: driveUrl(url), name: resource.getName() };
  } catch {
    throw new ApiError(
      'DRIVE_UPLOAD_FAILED',
      'Google Drive did not return a usable link for the saved document.',
    );
  }
}
