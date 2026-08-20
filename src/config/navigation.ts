/**
 * Application navigation.
 *
 * Exactly the eight destinations listed in PRD §7 and §38, in the PRD's order.
 * Nothing is added speculatively.
 */

import type { UserRole } from '@shared/types';

export interface NavItem {
  readonly label: string;
  readonly path: string;
  /** Omitted means every authenticated role may see it. */
  readonly requiredRole?: UserRole;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/' },
  { label: 'New Quotation', path: '/quotations/new' },
  { label: 'Quotations', path: '/quotations' },
  { label: 'Customers', path: '/customers' },
  { label: 'Items / Services', path: '/items' },
  { label: 'Terms & Conditions', path: '/terms' },
  { label: 'Authorized Persons', path: '/signatories', requiredRole: 'Admin' },
  { label: 'Company Settings', path: '/settings', requiredRole: 'Admin' },
  { label: 'Users', path: '/users', requiredRole: 'Admin' },
];

/**
 * Company identity shown in the application shell.
 *
 * Taken from the letterhead in reference/letterhead.pdf, and it stays here.
 *
 * This used to say Company Settings would supersede it. That surface now
 * exists, and it deliberately reports these two as READ-ONLY instead: the
 * printed identity lives in the letterhead ARTWORK, which the PDF embeds
 * directly. Editing them as text would change the Word document and not the
 * PDF, so the two files for one quotation would disagree about who issued it.
 * Changing them is replacing the letterhead, not editing a setting.
 */
export const COMPANY_IDENTITY = {
  name: 'Speed Falcon Company',
  shortName: 'SPEED-X FALCON',
  crNumber: '7050577670',
} as const;
