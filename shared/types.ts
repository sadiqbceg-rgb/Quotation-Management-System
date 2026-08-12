/**
 * Domain types shared by the React application and the Google Apps Script backend.
 *
 * See IMPLEMENTATION_PLAN.md §6.
 *
 * Types only — no logic, no runtime values beyond string-literal unions.
 * This module must import nothing platform-specific.
 */

import type { Halalas, Milli } from './money.js';
import type { QuotationNumber } from './numbering.js';

/* -------------------------------------------------------------------------- */
/* Enumerations                                                               */
/* -------------------------------------------------------------------------- */

export const QUOTATION_STATUSES = ['Pending', 'Approved', 'Rejected'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const ITEM_CATEGORIES = ['Manpower', 'Equipment', 'Materials'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const USER_ROLES = ['Admin', 'User'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * `amount`    — quantity × rate with an Amount column and a totals block (PRD §19).
 * `rate-only` — rates only, no Amount column, no totals block, reproducing the
 *               approved sample in `reference/quotation-sample.pdf` (§26 UR-04).
 */
export const PRICING_MODES = ['amount', 'rate-only'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export const TERM_SOURCES = ['library', 'library-overridden', 'quotation-local'] as const;
export type TermSource = (typeof TERM_SOURCES)[number];

/* -------------------------------------------------------------------------- */
/* Quotation                                                                  */
/* -------------------------------------------------------------------------- */

export interface ClientInfo {
  /** Required (PRD §12). */
  clientName: string;
  /** Required (PRD §12). */
  companyName: string;
  /** Required (PRD §12). Not shown in the approved layout — see §26 UR-06. */
  address: string;
  /** Rendered as `Attention:` in the document meta block. */
  contactPerson?: string;
  email?: string;
  phone?: string;
  projectName?: string;
  projectLocation?: string;
  clientReference?: string;
}

export interface LineItem {
  /** Client-generated UUID, stable across reordering. */
  id: string;
  category: ItemCategory;
  /** Designation | Equipment Description | Material Description. */
  description: string;
  quantity: Milli;
  unit: string;
  unitPrice: Halalas;
  /** Derived: quantity × unitPrice. Never user-entered. */
  amount: Halalas;
  remarks?: string;
  sortOrder: number;
}

export interface CategoryBlock {
  category: ItemCategory;
  items: LineItem[];
  /** Derived. */
  subtotal: Halalas;
  /** e.g. "Total Manpower: 41 Persons" — see the approved quotation. */
  summaryLine?: string;
}

export interface QuotationTerm {
  /** Library id, or `local:<uuid>` for a quotation-only term. */
  id: string;
  title: string;
  /** Already token-resolved at document build time. Plain text, never HTML. */
  body: string;
  sortOrder: number;
  source: TermSource;
}

/** What a quotation stores about its signatory — a snapshot, not a live reference (§6.3). */
export interface AuthorizedPersonSnapshot {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  /** Drive file id of the signature PNG. The binary is never stored on the quotation. */
  signatureFileId: string;
}

export interface Totals {
  categorySubtotals: Partial<Record<ItemCategory, Halalas>>;
  subtotal: Halalas;
  /** Basis points, 0–10000. Absent when discount is disabled. */
  discountRateBasisPoints?: number;
  discountAmount: Halalas;
  taxableBase: Halalas;
  /** Basis points. 1500 = 15%, the KSA rate in both reference documents. */
  vatRateBasisPoints: number;
  vatAmount: Halalas;
  grandTotal: Halalas;
}

/**
 * A quotation in progress or issued.
 *
 * `quotationNumber` is null until the backend reserves one at finalize time.
 * Opening the application must never reserve a number (PRD §35).
 */
export interface Quotation {
  /** UUID v4 minted client-side when "New Quotation" is clicked. Idempotency key. */
  draftId: string;
  /** Null while a draft. Assigned once, server-side, then immutable (§7.7). */
  quotationNumber: QuotationNumber | null;
  /** ISO `YYYY-MM-DD`. Drives the number's year and the Drive folders. */
  quotationDate: string;
  /** Required (PRD §11). */
  quotationFor: string;
  currency: 'SAR';
  pricingMode: PricingMode;
  /** Derived once (PRD §17); applied identically in preview, PDF and DOCX. */
  showRemarksColumn: boolean;
  client: ClientInfo;
  /** The "1. Scope of Work" paragraph from the approved quotation (§26 UR-08). */
  scopeOfWork?: string;
  categories: CategoryBlock[];
  totals: Totals;
  terms: QuotationTerm[];
  closingParagraph: string;
  authorizedPerson: AuthorizedPersonSnapshot | null;
  status: QuotationStatus;
  driveFolderUrl?: string;
  pdfUrl?: string;
  docxUrl?: string;
  createdBy: string;
  /** Server-assigned ISO 8601. */
  createdAt?: string;
  /** Server-assigned ISO 8601. */
  updatedAt?: string;
}

/**
 * Discriminated view of a quotation, so the compiler prevents reading a
 * quotation number off a draft that does not have one yet.
 */
export type QuotationState =
  | { kind: 'draft'; quotation: Quotation & { quotationNumber: null } }
  | { kind: 'issued'; quotation: Quotation & { quotationNumber: QuotationNumber } };

/* -------------------------------------------------------------------------- */
/* Master data                                                                */
/* -------------------------------------------------------------------------- */

/** A login account. Distinct from AuthorizedPerson, which is a signatory record. */
export interface User {
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface TermTemplate {
  id: string;
  title: string;
  /** May contain whitelisted `{{tokens}}` — see §10.2. */
  bodyTemplate: string;
  category: ItemCategory | 'General';
  sortOrder: number;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface AuthorizedPerson {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  signatureFileId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItem {
  id: string;
  category: ItemCategory;
  name: string;
  defaultUnit: string;
  active: boolean;
}

export interface ClientRecord {
  id: string;
  clientName: string;
  companyName: string;
  address: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
}

export interface CompanySettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  vatNumber: string;
  crNumber: string;
  /** Basis points. Default 1500 (15%). */
  defaultVatRateBasisPoints: number;
  defaultClosingParagraph: string;
  /** Number of days a quotation stays valid. 7 in both reference documents. */
  quotationValidityDays: number;
  companyCode: string;
  branchCode: string;
  documentTypeCode: string;
}
