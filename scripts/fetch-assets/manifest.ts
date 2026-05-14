import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type AssetKind = "audio" | "graphics";

export type AssetLicense =
  | "CC0"
  | "CC-BY"
  | "CC-BY-SA"
  | "CC-BY-NC"
  | "CC-BY-NC-SA"
  | "CC-BY-NC-ND"
  | "public-domain"
  | "commercial-royalty-free"
  | "commercial-single-seat"
  | "custom"
  | "other";

export interface PurchaseInfo {
  purchasedAt: string;
  priceUsd: number;
  currencyPaid?: string;
  vendor: string;
  orderId: string;
  receiptHash: string;
  receiptHint?: string;
  purchaseAccount?: string;
  licenseTermsPath?: string;
}

export interface AssetEntry {
  id: string;
  source: string;
  sourceUrl: string;
  license: AssetLicense;
  licenseUrl?: string;
  attribution?: string;
  author?: string;
  fetchedAt: string;
  tags: string[];
  localPath: string;
  files?: string[];
  brief?: string;
  kind: AssetKind;
  shipSafe: boolean;
  purchase: PurchaseInfo | null;
}

export interface AssetManifest {
  version: 1;
  assets: AssetEntry[];
}

const MANIFEST_VERSION = 1;

export const ASSET_LICENSES: readonly AssetLicense[] = [
  "CC0",
  "CC-BY",
  "CC-BY-SA",
  "CC-BY-NC",
  "CC-BY-NC-SA",
  "CC-BY-NC-ND",
  "public-domain",
  "commercial-royalty-free",
  "commercial-single-seat",
  "custom",
  "other",
] as const;

export const ASSET_KINDS: readonly AssetKind[] = ["audio", "graphics"] as const;

export function manifestPath(repoRoot: string): string {
  return path.join(repoRoot, "assets", "MANIFEST.json");
}

export async function readManifest(repoRoot: string): Promise<AssetManifest> {
  const filePath = manifestPath(repoRoot);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parseManifest(parsed, filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: MANIFEST_VERSION, assets: [] };
    }

    throw error;
  }
}

export async function writeManifest(repoRoot: string, manifest: AssetManifest): Promise<void> {
  const filePath = manifestPath(repoRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function assertUniqueSourceUrl(manifest: AssetManifest, sourceUrl: string): void {
  const existing = manifest.assets.find((entry) => entry.sourceUrl === sourceUrl);

  if (existing !== undefined) {
    throw new Error(`Manifest already contains sourceUrl ${sourceUrl} as ${existing.id}`);
  }
}

export function isAssetKind(value: string): value is AssetKind {
  return ASSET_KINDS.includes(value as AssetKind);
}

export function isAssetLicense(value: string): value is AssetLicense {
  return ASSET_LICENSES.includes(value as AssetLicense);
}

function parseManifest(value: unknown, filePath: string): AssetManifest {
  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }

  if (value.version !== MANIFEST_VERSION) {
    throw new Error(`${filePath} must have version ${MANIFEST_VERSION}`);
  }

  if (!Array.isArray(value.assets)) {
    throw new Error(`${filePath} must contain an assets array`);
  }

  return {
    version: MANIFEST_VERSION,
    assets: value.assets.map((entry, index) => parseAssetEntry(entry, `${filePath} assets[${index}]`)),
  };
}

function parseAssetEntry(value: unknown, label: string): AssetEntry {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }

  const id = requiredString(value, "id", label);
  const source = requiredString(value, "source", label);
  const sourceUrl = requiredString(value, "sourceUrl", label);
  const license = requiredLicense(value, "license", label);
  const fetchedAt = requiredString(value, "fetchedAt", label);
  const localPath = requiredString(value, "localPath", label);
  const kind = requiredKind(value, "kind", label);
  const shipSafe = requiredBoolean(value, "shipSafe", label);
  const tags = requiredStringArray(value, "tags", label);

  return {
    id,
    source,
    sourceUrl,
    license,
    licenseUrl: optionalString(value, "licenseUrl", label),
    attribution: optionalString(value, "attribution", label),
    author: optionalString(value, "author", label),
    fetchedAt,
    tags,
    localPath,
    files: optionalStringArray(value, "files", label),
    brief: optionalString(value, "brief", label),
    kind,
    shipSafe,
    purchase: parsePurchaseInfo(value.purchase, `${label}.purchase`),
  };
}

function parsePurchaseInfo(value: unknown, label: string): PurchaseInfo | null {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error(`${label} must be null or an object`);
  }

  return {
    purchasedAt: requiredString(value, "purchasedAt", label),
    priceUsd: requiredNumber(value, "priceUsd", label),
    currencyPaid: optionalString(value, "currencyPaid", label),
    vendor: requiredString(value, "vendor", label),
    orderId: requiredString(value, "orderId", label),
    receiptHash: requiredString(value, "receiptHash", label),
    receiptHint: optionalString(value, "receiptHint", label),
    purchaseAccount: optionalString(value, "purchaseAccount", label),
    licenseTermsPath: optionalString(value, "licenseTermsPath", label),
  };
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }

  return value;
}

function optionalString(record: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${label}.${key} must be a string when present`);
  }

  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be a finite number`);
  }

  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string, label: string): boolean {
  const value = record[key];

  if (typeof value !== "boolean") {
    throw new Error(`${label}.${key} must be a boolean`);
  }

  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string, label: string): string[] {
  const value = record[key];

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label}.${key} must be an array of strings`);
  }

  return value;
}

function optionalStringArray(record: Record<string, unknown>, key: string, label: string): string[] | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label}.${key} must be an array of strings when present`);
  }

  return value;
}

function requiredKind(record: Record<string, unknown>, key: string, label: string): AssetKind {
  const value = requiredString(record, key, label);

  if (!isAssetKind(value)) {
    throw new Error(`${label}.${key} must be one of: ${ASSET_KINDS.join(", ")}`);
  }

  return value;
}

function requiredLicense(record: Record<string, unknown>, key: string, label: string): AssetLicense {
  const value = requiredString(record, key, label);

  if (!isAssetLicense(value)) {
    throw new Error(`${label}.${key} must be one of: ${ASSET_LICENSES.join(", ")}`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
