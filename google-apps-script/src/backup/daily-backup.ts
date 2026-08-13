/**
 * The daily backup of the tracking spreadsheet.
 *
 * See IMPLEMENTATION_PLAN.md §24. Driven by a time-driven trigger the operator
 * installs once; `installDailyBackupTrigger()` does that, and is idempotent.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROTECTS AGAINST, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * The generated PDFs and Word files do NOT need this. Drive keeps a revision
 * history for every one of them and a 30-day trash, and the archive writes
 * replace in place rather than creating new files, so every regeneration leaves
 * the previous revision recoverable.
 *
 * The SPREADSHEET is different, and it is the one thing that cannot be
 * reconstructed from anything else:
 *
 *   - `Counters` is the sole authority for the next quotation number;
 *   - `Idempotency` is what stops a retry issuing a second number;
 *   - `Users` holds the password hashes;
 *   - `Quotations` is what the company invoices from.
 *
 * Sheets version history covers an accidental edit. It does not cover the
 * spreadsheet being deleted, or a script — this one included — corrupting it.
 * So a dated copy is taken into the archive daily, and kept for 90 days.
 *
 * ---------------------------------------------------------------------------
 * WHY IT NEVER THROWS INTO THE TRIGGER
 * ---------------------------------------------------------------------------
 * A trigger that throws sends the owner an email and stops. That is right for a
 * failure the operator must act on, and wrong for a transient Drive hiccup at
 * 02:00. So `runDailyBackup` returns a typed RESULT rather than throwing, the
 * trigger entry point logs it, and `RUNBOOK.md` says to check the outcome in
 * the weekly review. A failure is visible; it is not an alarm.
 */

import { requireProperty } from '../config/properties';
import { getOrCreateFolder, archiveRoot } from '../drive/folder-resolver';

/** Where the dated copies live, under the archive root. */
export const BACKUPS_FOLDER_NAME = '_backups';

/**
 * How long a copy is kept.
 *
 * 90 days is the window in which somebody notices that a figure is wrong and
 * wants to see what the register said last month. Beyond that the copies are
 * storage cost against a scenario nobody has ever needed.
 */
export const BACKUP_RETENTION_DAYS = 90;

/** The hour the trigger fires, in the script's timezone (Asia/Riyadh). */
export const BACKUP_HOUR = 2;

/** `2026-08-11` — the folder name for one day's copy. Sorts correctly as text. */
export function backupFolderName(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  const day = String(at.getUTCDate()).padStart(2, '0');

  return `${String(year)}-${month}-${day}`;
}

/** True when a folder name is a backup date this old or older. */
export function isExpiredBackupName(name: string, now: Date, retentionDays: number): boolean {
  // Only names this module produces are ever considered. A folder somebody put
  // in `_backups` by hand is left alone rather than deleted by a script.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return false;

  const stamp = Date.parse(`${name}T00:00:00Z`);
  if (Number.isNaN(stamp)) return false;

  /*
   * Whole CALENDAR days, both sides truncated to midnight.
   *
   * The folder name carries a date and no time, so comparing it against the
   * current instant measures the wrong thing: a copy taken 90 days ago at 02:00
   * reads as 90.08 days old and is pruned hours early. Worse, at a retention of
   * zero it makes TODAY's copy — taken minutes before — already expired.
   *
   * Truncating both sides makes the rule what the runbook says it is: a copy is
   * kept for `retentionDays` calendar days and removed on the day after.
   */
  const today = Date.parse(`${backupFolderName(now)}T00:00:00Z`);
  const ageDays = Math.round((today - stamp) / (24 * 60 * 60 * 1000));

  return ageDays > retentionDays;
}

export interface BackupResult {
  outcome: 'copied' | 'already-present' | 'failed';
  /** The dated folder, e.g. `2026-08-11`. */
  folderName: string;
  /** The Drive id of the copy, when one was made or already existed. */
  fileId: string | null;
  /** Dated folders removed by the prune. */
  pruned: string[];
  /** Present only on `failed`. Safe to log: never carries a Drive id or a value. */
  message?: string;
}

export interface BackupDependencies {
  /** Injected so a test can run the whole thing against a fixed date. */
  now?: Date;
  retentionDays?: number;
}

/**
 * Copy the tracking spreadsheet into `_backups/YYYY-MM-DD/`, then prune.
 *
 * Idempotent within a day: running it twice does not produce two copies, which
 * matters because an operator re-running it by hand after a failure is exactly
 * when it will be run twice.
 */
export function runDailyBackup(dependencies: BackupDependencies = {}): BackupResult {
  const now = dependencies.now ?? new Date();
  const retentionDays = dependencies.retentionDays ?? BACKUP_RETENTION_DAYS;
  const folderName = backupFolderName(now);

  try {
    const spreadsheetId = requireProperty('TRACKING_SPREADSHEET_ID');

    const backupsRoot = getOrCreateFolder(archiveRoot(), BACKUPS_FOLDER_NAME);
    const dated = getOrCreateFolder(backupsRoot, folderName);

    const copyName = `Quotation Tracking ${folderName}`;

    // Already there? Do not make a second one.
    const existing = dated.getFilesByName(copyName);
    if (existing.hasNext()) {
      return {
        outcome: 'already-present',
        folderName,
        fileId: existing.next().getId(),
        pruned: prune(backupsRoot, now, retentionDays),
      };
    }

    const copy = DriveApp.getFileById(spreadsheetId).makeCopy(copyName, dated);

    return {
      outcome: 'copied',
      folderName,
      fileId: copy.getId(),
      // Pruned AFTER the copy succeeds. Deleting old backups when the new one
      // failed would leave the company with fewer copies than it started with.
      pruned: prune(backupsRoot, now, retentionDays),
    };
  } catch (thrown: unknown) {
    return {
      outcome: 'failed',
      folderName,
      fileId: null,
      pruned: [],
      message: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }
}

/**
 * Trash dated folders older than the retention window.
 *
 * Trashed, not deleted: Drive keeps a trashed item for 30 days, so a prune that
 * turns out to have been wrong is recoverable for a month.
 */
function prune(
  backupsRoot: GoogleAppsScript.Drive.Folder,
  now: Date,
  retentionDays: number,
): string[] {
  const removed: string[] = [];

  const folders = backupsRoot.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    const name = folder.getName();

    if (!isExpiredBackupName(name, now, retentionDays)) continue;

    try {
      folder.setTrashed(true);
      removed.push(name);
    } catch {
      // One folder that will not trash must not stop the rest, and must not
      // fail a backup that has already succeeded.
    }
  }

  return removed;
}

/* -------------------------------------------------------------------------- */
/* The trigger                                                                */
/* -------------------------------------------------------------------------- */

/** The function name the trigger calls. Must match the exported global. */
export const BACKUP_TRIGGER_FUNCTION = 'dailyBackup';

/**
 * Install the daily trigger, or leave the existing one alone.
 *
 * Idempotent. Apps Script will happily install the same trigger five times if
 * asked five times, and then run the backup five times a night.
 */
export function installDailyBackupTrigger(): { installed: boolean } {
  const existing = ScriptApp.getProjectTriggers().filter(
    (trigger) => trigger.getHandlerFunction() === BACKUP_TRIGGER_FUNCTION,
  );

  if (existing.length > 0) return { installed: false };

  ScriptApp.newTrigger(BACKUP_TRIGGER_FUNCTION)
    .timeBased()
    .atHour(BACKUP_HOUR)
    .everyDays(1)
    .create();

  return { installed: true };
}

/** Remove the trigger. For decommissioning, and for the runbook's rehearsal. */
export function removeDailyBackupTrigger(): { removed: number } {
  const triggers = ScriptApp.getProjectTriggers().filter(
    (trigger) => trigger.getHandlerFunction() === BACKUP_TRIGGER_FUNCTION,
  );

  for (const trigger of triggers) ScriptApp.deleteTrigger(trigger);

  return { removed: triggers.length };
}
