/**
 * Frontend re-export of the shared domain types.
 *
 * Components import from `@/types`; the definitions live in `shared/` because
 * the Google Apps Script backend imports the very same file. Keeping one
 * definition is what stops the two sides drifting apart.
 */

export type {
  AuthorizedPerson,
  AuthorizedPersonSnapshot,
  CatalogItem,
  CategoryBlock,
  ClientInfo,
  ClientRecord,
  CompanySettings,
  ItemCategory,
  LineItem,
  PricingMode,
  Quotation,
  QuotationState,
  QuotationStatus,
  QuotationTerm,
  TermSource,
  TermTemplate,
  Totals,
  User,
  UserRole,
} from '@shared/types';

export {
  ITEM_CATEGORIES,
  PRICING_MODES,
  QUOTATION_STATUSES,
  TERM_SOURCES,
  USER_ROLES,
} from '@shared/types';

export type { Halalas, Milli } from '@shared/money';
export type { QuotationNumber, QuotationCodes } from '@shared/numbering';
