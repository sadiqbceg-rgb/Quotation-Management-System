/**
 * Company settings, over the shared API client.
 *
 * ---------------------------------------------------------------------------
 * DEFAULTS, NOT RETROACTIVE VALUES
 * ---------------------------------------------------------------------------
 * These seed a NEW quotation. Every quotation stores its own VAT rate and its
 * own closing paragraph, and the server recomputes its totals from the rate on
 * that quotation — so changing a default here can never alter one that already
 * exists.
 */

import { callAction } from '@/services/api/client';

/** Editable by an Admin at runtime. */
export interface BusinessSettings {
  /** Basis points. 1500 = 15%. */
  defaultVatRateBasisPoints: number;
  quotationValidityDays: number;
  defaultClosingParagraph: string;
}

/**
 * Read-only, set at deployment.
 *
 * Reported so an administrator can confirm what the deployment is configured
 * with without opening the Apps Script editor. Nothing here is a secret: the
 * codes and the VAT number are printed on every quotation.
 */
export interface DeploymentSettings {
  companyCode: string;
  branchCode: string;
  documentTypeCode: string;
  vatNumber: string;
}

export interface CompanySettings {
  business: BusinessSettings;
  deployment: DeploymentSettings;
}

export async function getSettings(token: string): Promise<CompanySettings> {
  return callAction<Record<string, never>, CompanySettings>('settings.get', {}, { token });
}

/** Admin only — enforced by the backend, not by this function. */
export async function updateSettings(
  input: BusinessSettings,
  token: string,
): Promise<CompanySettings> {
  return callAction<BusinessSettings, CompanySettings>('settings.update', input, { token });
}
