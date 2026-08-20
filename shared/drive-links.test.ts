/**
 * Drive ids and links — the constructors that make a fabricated URL impossible
 * rather than merely forbidden (PRD §34).
 */

import { describe, expect, it } from 'vitest';

import { DriveLinkError, driveFileId, driveUrl, isDriveUrl, parseDriveTarget } from './drive-links';

const FILE_ID = 'test-only-file-000000-1';
const FILE_URL = 'https://drive.google.com/file/d/test-only-file-000000-1/view';
const FOLDER_URL = 'https://drive.google.com/drive/folders/test-only-folder-1';
/** What Drive returns for an uploaded .docx — the Docs editor, not the viewer. */
const DOCS_EDITOR_URL = 'https://docs.google.com/document/d/test-only-file-000000-1/edit';

describe('file ids', () => {
  it('accepts an opaque Drive id', () => {
    expect(driveFileId(FILE_ID)).toBe(FILE_ID);
  });

  it('refuses an empty string, a path, or a URL', () => {
    for (const value of ['', 'a', '../etc', 'folder/child', FILE_URL]) {
      expect(() => driveFileId(value), value).toThrow(DriveLinkError);
    }
  });
});

describe('links', () => {
  it('accepts a Drive file link and a Drive folder link', () => {
    expect(driveUrl(FILE_URL)).toBe(FILE_URL);
    expect(driveUrl(FOLDER_URL)).toBe(FOLDER_URL);
  });

  it('accepts the Docs editor link Drive returns for a Word file', () => {
    /*
     * `DriveApp.getUrl()` answers with the host that can OPEN the file. A PDF
     * gets the Drive viewer; a .docx gets the Google Docs editor, because Drive
     * knows the editor can open an Office document.
     *
     * Rejecting this rejected the URL of every successfully uploaded Word file,
     * and the save was reported as "The Word document did not upload".
     */
    expect(driveUrl(DOCS_EDITOR_URL)).toBe(DOCS_EDITOR_URL);
    expect(isDriveUrl(DOCS_EDITOR_URL)).toBe(true);
  });

  it('accepts a Docs spreadsheet link, which is the same mechanism', () => {
    const sheet = 'https://docs.google.com/spreadsheets/d/test-only-sheet-1/edit';

    expect(isDriveUrl(sheet)).toBe(true);
  });

  it('refuses anything that is not a Drive link', () => {
    // The point of the constructor: a plausible-looking but fabricated link
    // fails where it is built, not when a user clicks it.
    for (const value of [
      '',
      'test-only-file-1',
      'http://drive.google.com/file/d/x/view',
      'https://drive.google.com.evil.example/file/d/x',
      'https://example.invalid/file',
      // Widening to two Google hosts must not widen to anything else. These
      // are the near-misses the allowlist has to keep refusing.
      'http://docs.google.com/document/d/x/edit',
      'https://docs.google.com.evil.example/document/d/x',
      'https://docs.google.evil.example/document/d/x',
      'https://notdocs.google.com/document/d/x',
      'https://sites.google.com/view/x',
      'https://google.com/document/d/x',
      // A scheme that would execute if it ever reached an href. Built by
      // concatenation so the lint rule that bans script URLs stays on.
      `java${'script'}:alert(1)`,
    ]) {
      expect(() => driveUrl(value), value).toThrow(DriveLinkError);
      expect(isDriveUrl(value), value).toBe(false);
    }
  });
});

describe('parsing a response', () => {
  it('re-brands a well-formed target', () => {
    const target = parseDriveTarget({ fileId: FILE_ID, url: FILE_URL, name: 'x.pdf' });

    expect(target.fileId).toBe(FILE_ID);
    expect(target.url).toBe(FILE_URL);
    expect(target.name).toBe('x.pdf');
  });

  it('refuses a target whose link is not a Drive link', () => {
    expect(() => parseDriveTarget({ fileId: FILE_ID, url: 'https://example.invalid/x' })).toThrow(
      DriveLinkError,
    );
  });

  it('refuses a missing or malformed target rather than rendering a dead link', () => {
    for (const value of [null, undefined, {}, { fileId: FILE_ID }, { url: FILE_URL }, 'x']) {
      expect(() => parseDriveTarget(value)).toThrow(DriveLinkError);
    }
  });
});
