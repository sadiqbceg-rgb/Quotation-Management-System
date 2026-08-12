/**
 * Script Property access.
 *
 * Every secret and every environment-specific id lives here and nowhere else.
 * Nothing in this list may ever appear in the frontend bundle, in source, or in
 * a log line. See IMPLEMENTATION_PLAN.md §19.7 and §22.2.
 */

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
] as const;

export type RequiredProperty = (typeof REQUIRED_PROPERTIES)[number];
export type OptionalProperty = (typeof OPTIONAL_PROPERTIES)[number];
export type PropertyName = RequiredProperty | OptionalProperty;

const DEFAULTS: Partial<Record<OptionalProperty, string>> = {
  COMPANY_CODE: 'SFC',
  BRANCH_CODE: 'RUH',
  DOC_TYPE_CODE: 'QTN',
  ALLOWED_ORIGINS: '',
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

export function allowedOrigins(): string[] {
  return optionalProperty('ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
