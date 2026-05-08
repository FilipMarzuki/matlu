import { z } from 'zod';

export const AssetKindSchema = z.enum(['audio', 'graphics']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetLicenseSchema = z.enum([
  'CC0',
  'CC-BY',
  'CC-BY-SA',
  'CC-BY-NC',
  'CC-BY-NC-SA',
  'CC-BY-NC-ND',
  'public-domain',
  'commercial-royalty-free',
  'commercial-single-seat',
  'custom',
  'other',
]);
export type AssetLicense = z.infer<typeof AssetLicenseSchema>;

export const PurchaseInfoSchema = z.object({
  purchasedAt: z.string().datetime(),
  priceUsd: z.number(),
  currencyPaid: z.string().optional(),
  vendor: z.string(),
  orderId: z.string(),
  receiptHash: z.string(),
  receiptHint: z.string().optional(),
  purchaseAccount: z.string().optional(),
  licenseTermsPath: z.string().optional(),
});
export type PurchaseInfo = z.infer<typeof PurchaseInfoSchema>;

export const AssetEntrySchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceUrl: z.string().url(),
  license: AssetLicenseSchema,
  licenseUrl: z.string().url().optional(),
  attribution: z.string().optional(),
  author: z.string().optional(),
  fetchedAt: z.string().datetime(),
  tags: z.array(z.string()),
  localPath: z.string(),
  files: z.array(z.string()).optional(),
  brief: z.string().optional(),
  kind: AssetKindSchema,
  shipSafe: z.boolean(),
  purchase: PurchaseInfoSchema.nullable(),
});
export type AssetEntry = z.infer<typeof AssetEntrySchema>;

export const AssetManifestSchema = z.object({
  version: z.literal(1),
  assets: z.array(AssetEntrySchema),
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

export const COMMERCIAL_SAFE_LICENSES: ReadonlySet<AssetLicense> = new Set([
  'CC0',
  'CC-BY',
  'public-domain',
]);

export function isCommercialSafeLicense(license: AssetLicense): boolean {
  return COMMERCIAL_SAFE_LICENSES.has(license);
}
