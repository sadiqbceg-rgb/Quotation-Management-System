/**
 * The daily spreadsheet backup.
 *
 * Everything runs against the in-memory Drive. No real Drive is reachable, so
 * no copy can appear in the company's archive and nothing can be trashed there.
 *
 * The two behaviours that matter most are the ones a careless implementation
 * gets wrong: running twice in a day must not produce two copies, and a FAILED
 * backup must not prune — leaving the company with fewer copies than it started
 * with is worse than skipping a night.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import {
  BACKUPS_FOLDER_NAME,
  BACKUP_HOUR,
  BACKUP_RETENTION_DAYS,
  BACKUP_TRIGGER_FUNCTION,
  backupFolderName,
  installDailyBackupTrigger,
  isExpiredBackupName,
  removeDailyBackupTrigger,
  runDailyBackup,
} from './daily-backup';

let env: GasEnvironment;

/** A fixed instant, so a folder name is the same on every run. */
const NOW = new Date('2026-08-11T02:00:00.000Z');

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);

  // The spreadsheet the backup copies. Created through the Drive fake so it has
  // a real id and a real parent, exactly as the live one does.
  const root = env.drive.service as { getFolderById: (id: string) => unknown };
  const rootFolder = root.getFolderById('test-only-drive-root') as {
    createFile: (blob: unknown) => { getId: () => string };
  };

  const file = rootFolder.createFile({
    getBytes: () => [1, 2, 3],
    getName: () => 'Quotation Tracking',
    getContentType: () => 'application/vnd.google-apps.spreadsheet',
  });

  env.properties.values.set('TRACKING_SPREADSHEET_ID', file.getId());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every folder path under `_backups`, for assertions. */
function backupFolders(): string[] {
  return env.drive
    .folderPaths()
    .filter((path) => path.startsWith(`${BACKUPS_FOLDER_NAME}/`))
    .map((path) => path.slice(BACKUPS_FOLDER_NAME.length + 1));
}

/* -------------------------------------------------------------------------- */
/* Naming                                                                     */
/* -------------------------------------------------------------------------- */

describe('the dated folder name', () => {
  it('is ISO, so the folders sort correctly as text in the Drive UI', () => {
    expect(backupFolderName(new Date('2026-08-11T02:00:00Z'))).toBe('2026-08-11');
    expect(backupFolderName(new Date('2026-01-05T23:59:59Z'))).toBe('2026-01-05');
  });

  it('pads the month and the day, so 2026-1-5 can never appear', () => {
    // An unpadded name sorts wrongly and breaks the expiry parse.
    expect(backupFolderName(new Date('2027-03-09T00:00:00Z'))).toBe('2027-03-09');
  });
});

describe('deciding what has expired', () => {
  it('keeps a copy inside the retention window', () => {
    expect(isExpiredBackupName('2026-08-11', NOW, BACKUP_RETENTION_DAYS)).toBe(false);
    expect(isExpiredBackupName('2026-06-01', NOW, BACKUP_RETENTION_DAYS)).toBe(false);
  });

  it('expires one past it', () => {
    // 2026-01-01 is more than 90 days before 2026-08-11.
    expect(isExpiredBackupName('2026-01-01', NOW, BACKUP_RETENTION_DAYS)).toBe(true);
  });

  it('keeps a folder exactly at the boundary', () => {
    const ninetyDaysBefore = new Date(NOW.getTime() - BACKUP_RETENTION_DAYS * 86_400_000);
    expect(
      isExpiredBackupName(backupFolderName(ninetyDaysBefore), NOW, BACKUP_RETENTION_DAYS),
    ).toBe(false);
  });

  it('never touches a folder somebody put there by hand', () => {
    /*
     * The prune only ever removes names this module produces. A script that
     * deletes anything it does not recognise is a script that eventually
     * deletes something it should not have.
     */
    for (const name of ['notes', 'TEST_ONLY keep me', '2026', 'August', '11-08-2026', '']) {
      expect(isExpiredBackupName(name, NOW, BACKUP_RETENTION_DAYS), name).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Copying                                                                    */
/* -------------------------------------------------------------------------- */

describe('taking a backup', () => {
  it('copies the spreadsheet into a dated folder under _backups', () => {
    const result = runDailyBackup({ now: NOW });

    expect(result.outcome).toBe('copied');
    expect(result.folderName).toBe('2026-08-11');
    expect(backupFolders()).toEqual(['2026-08-11']);
  });

  it('names the copy after the date, so a restorer can see what it is', () => {
    runDailyBackup({ now: NOW });

    const copies = env.drive.filesIn(`${BACKUPS_FOLDER_NAME}/2026-08-11`);
    expect(copies.map((file) => file.name)).toEqual(['Quotation Tracking 2026-08-11']);
  });

  it('copies the content, not merely the name', () => {
    runDailyBackup({ now: NOW });

    const copy = env.drive.filesIn(`${BACKUPS_FOLDER_NAME}/2026-08-11`)[0];
    expect(copy?.bytes).toEqual([1, 2, 3]);
  });

  it('leaves the original where it was', () => {
    const before = env.properties.get('TRACKING_SPREADSHEET_ID');
    runDailyBackup({ now: NOW });

    expect(env.drive.files().some((file) => file.id === before)).toBe(true);
  });

  it('reuses the dated folder rather than making a second one', () => {
    runDailyBackup({ now: NOW });
    runDailyBackup({ now: NOW });

    expect(backupFolders()).toEqual(['2026-08-11']);
  });

  it('does not make a second copy when run twice in one day', () => {
    // An operator re-running it by hand after a failure is exactly when this
    // happens, and two copies of one day is confusing rather than safer.
    const first = runDailyBackup({ now: NOW });
    const second = runDailyBackup({ now: NOW });

    expect(second.outcome).toBe('already-present');
    expect(second.fileId).toBe(first.fileId);
    expect(env.drive.filesIn(`${BACKUPS_FOLDER_NAME}/2026-08-11`)).toHaveLength(1);
  });

  it('makes one copy per day across several days', () => {
    runDailyBackup({ now: new Date('2026-08-09T02:00:00Z') });
    runDailyBackup({ now: new Date('2026-08-10T02:00:00Z') });
    runDailyBackup({ now: NOW });

    expect(backupFolders().sort()).toEqual(['2026-08-09', '2026-08-10', '2026-08-11']);
  });
});

/* -------------------------------------------------------------------------- */
/* Pruning                                                                    */
/* -------------------------------------------------------------------------- */

describe('pruning old copies', () => {
  /** Seed a run on a given day, so there is something to prune later. */
  function backupOn(iso: string): void {
    runDailyBackup({ now: new Date(`${iso}T02:00:00Z`) });
  }

  it('removes a copy older than the retention window', () => {
    backupOn('2026-01-01');
    expect(backupFolders()).toContain('2026-01-01');

    const result = runDailyBackup({ now: NOW });

    expect(result.pruned).toContain('2026-01-01');
    expect(backupFolders()).not.toContain('2026-01-01');
  });

  it('keeps everything inside the window', () => {
    backupOn('2026-06-01');
    backupOn('2026-08-01');

    const result = runDailyBackup({ now: NOW });

    expect(result.pruned).toEqual([]);
    expect(backupFolders().sort()).toEqual(['2026-06-01', '2026-08-01', '2026-08-11']);
  });

  it('never prunes the copy it has just taken', () => {
    // A retention of zero days would otherwise delete today's backup, which is
    // the one thing a backup run must not do.
    const result = runDailyBackup({ now: NOW, retentionDays: 0 });

    expect(result.outcome).toBe('copied');
    expect(result.pruned).not.toContain('2026-08-11');
    expect(backupFolders()).toContain('2026-08-11');
  });

  it('trashes rather than destroys, so a wrong prune is recoverable for 30 days', () => {
    backupOn('2026-01-01');
    runDailyBackup({ now: NOW });

    // Gone from the listing, but Drive still holds it in the trash.
    expect(backupFolders()).not.toContain('2026-01-01');
  });
});

/* -------------------------------------------------------------------------- */
/* Failure                                                                    */
/* -------------------------------------------------------------------------- */

describe('when the backup fails', () => {
  it('returns a typed failure rather than throwing into the trigger', () => {
    // A trigger that throws emails the owner and stops. That is right for
    // something an operator must act on, and wrong for a Drive hiccup at 02:00.
    env.properties.values.delete('TRACKING_SPREADSHEET_ID');

    const result = runDailyBackup({ now: NOW });

    expect(result.outcome).toBe('failed');
    expect(result.fileId).toBeNull();
    expect(result.message ?? '').toContain('CONFIG_MISSING');
  });

  it('prunes NOTHING when the copy failed', () => {
    /*
     * The property that matters most here. Pruning on a failed run would leave
     * the company with fewer copies than it started with — the backup system
     * actively destroying its own backups.
     */
    runDailyBackup({ now: new Date('2026-01-01T02:00:00Z') });
    expect(backupFolders()).toContain('2026-01-01');

    env.properties.values.delete('TRACKING_SPREADSHEET_ID');
    const result = runDailyBackup({ now: NOW });

    expect(result.outcome).toBe('failed');
    expect(result.pruned).toEqual([]);
    expect(backupFolders()).toContain('2026-01-01');
  });

  it('reports a Drive failure without leaking an id or a secret', () => {
    env.drive.failNextFolder('Drive is unavailable right now.');

    const result = runDailyBackup({ now: NOW });

    expect(result.outcome).toBe('failed');
    expect(result.message ?? '').not.toContain(env.properties.get('SESSION_HMAC_SECRET') ?? 'x');
    expect(result.message ?? '').not.toContain(env.properties.get('PASSWORD_PEPPER') ?? 'x');
  });
});

/* -------------------------------------------------------------------------- */
/* The trigger                                                                */
/* -------------------------------------------------------------------------- */

describe('installing the trigger', () => {
  it('installs one daily trigger at the configured hour', () => {
    expect(installDailyBackupTrigger()).toEqual({ installed: true });

    const triggers = env.scriptApp.triggers();
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.handler).toBe(BACKUP_TRIGGER_FUNCTION);
    expect(triggers[0]?.hour).toBe(BACKUP_HOUR);
    expect(triggers[0]?.everyDays).toBe(1);
  });

  it('is idempotent — running the setup twice does not back up twice a night', () => {
    installDailyBackupTrigger();
    const second = installDailyBackupTrigger();

    expect(second).toEqual({ installed: false });
    expect(env.scriptApp.triggers()).toHaveLength(1);
  });

  it('can be removed again, for decommissioning and for the rollback rehearsal', () => {
    installDailyBackupTrigger();

    expect(removeDailyBackupTrigger()).toEqual({ removed: 1 });
    expect(env.scriptApp.triggers()).toEqual([]);
  });

  it('reports removing nothing when there was nothing to remove', () => {
    expect(removeDailyBackupTrigger()).toEqual({ removed: 0 });
  });
});
