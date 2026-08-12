/**
 * Script Property access.
 *
 * Every secret and every environment-specific id lives here and nowhere else.
 * No REQUIRED property may ever appear in the frontend bundle, in source, or in
 * a log line. See IMPLEMENTATION_PLAN.md §19.7 and §22.2.
 *
 * The optional properties are a different class: company identifiers that are
 * printed on the quotation itself and are therefore public. They carry
 * committed defaults, and a deployment overrides them per environment.
 */

import { isValidSaudiVatNumber } from '@shared/validation-rules';

export const REQUIRED_PROPERTIES = [
  'SESSION_HMAC_SECRET',
  'PASSWORD_PEPPER',
  'DRIVE_ROOT_FOLDER_ID',
  'TRACKING_SPREADSHEET_ID',
] as const;

export const OPTIONAL_PROPERTIES = [
  'ALLOWED_ORIGINS',
  'COMPANY_CODE',
  'BRANCH_CODE',
  'DOC_TYPE_CODE',
  'COMPANY_VAT_NUMBER',
] as const;

export type RequiredProperty = (typeof REQUIRED_PROPERTIES)[number];
export type OptionalProperty = (typeof OPTIONAL_PROPERTIES)[number];
export type PropertyName = RequiredProperty | OptionalProperty;

/**
 * Defaults for the optional properties.
 *
 * These are the company's real, published identifiers — the same class of value
 * as `SFC` and `RUH`, not secrets and not sample data. A deployment overrides
 * any of them with a Script Property; nothing here is ever read by a component
 * or written into a term template.
 */
const DEFAULTS: Partial<Record<OptionalProperty, string>> = {
  COMPANY_CODE: 'SFC',
  BRANCH_CODE: 'RUH',
  DOC_TYPE_CODE: 'QTN',
  ALLOWED_ORIGINS: '',
  // ZATCA VAT registration. Printed on quotations and resolves
  // `{{company.vatNumber}}`; public by definition, never a secret.
  COMPANY_VAT_NUMBER: '313098686600003',
};

function store(): GoogleAppsScript.Properties.Properties {
  return PropertiesService.getScriptProperties();
}

/** Read a required property. Throws when absent so a misconfiguration fails fast. */
export function requireProperty(name: RequiredProperty): string {
  const value = store().getProperty(name);
  if (value === null || value.trim().length === 0) {
    throw new Error(`CONFIG_MISSING:${name}`);
  }
  return value;
}

export function optionalProperty(name: OptionalProperty): string {
  const value = store().getProperty(name);
  if (value === null || value.trim().length === 0) {
    return DEFAULTS[name] ?? '';
  }
  return value;
}

/** Names of required properties that are not set. Never returns any VALUES. */
export function missingProperties(): string[] {
  const properties = store().getProperties();
  return REQUIRED_PROPERTIES.filter((name) => {
    const value = properties[name];
    return value === undefined || value.trim().length === 0;
  });
}

export function isFullyConfigured(): boolean {
  return missingProperties().length === 0;
}

/**
 * Fail fast before doing any work, naming every missing key so an operator can
 * fix the deployment in one pass rather than one error at a time.
 */
export function assertConfigured(): void {
  const missing = missingProperties();
  if (missing.length > 0) {
    throw new Error(`CONFIG_MISSING:${missing.join(',')}`);
  }
}

/** The quotation number codes: SFC / RUH / QTN. Configurable, never inlined. */
export function quotationCodes(): { company: string; branch: string; documentType: string } {
  return {
    company: optionalProperty('COMPANY_CODE'),
    branch: optionalProperty('BRANCH_CODE'),
    documentType: optionalProperty('DOC_TYPE_CODE'),
  };
}

/**
 * The company's VAT registration number, for `{{company.vatNumber}}` and the
 * document letterhead.
 *
 * A malformed override is refused rather than printed. A wrong VAT number on a
 * quotation is a tax-compliance problem for the company, so a typo in a Script
 * Property must not reach a client document — falling back to the known-good
 * default is the safer failure.
 */
export function companyVatNumber(): string {
  const configured = optionalProperty('COMPANY_VAT_NUMBER').trim();
  if (isValidSaudiVatNumber(configured)) return configured;

  const fallback = DEFAULTS.COMPANY_VAT_NUMBER ?? '';
  if (configured.length > 0) {
    // Names the property, never the value (§19.7).
    console.warn('COMPANY_VAT_NUMBER is not a valid Saudi VAT number; using the default.');
  }
  return fallback;
}

export function allowedOrigins(): string[] {
  return optionalProperty('ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
