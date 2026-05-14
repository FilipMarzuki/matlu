import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  assertUniqueSourceUrl,
  type AssetEntry,
  type AssetKind,
  type AssetLicense,
  type PurchaseInfo,
  isAssetKind,
  isAssetLicense,
  readManifest,
  writeManifest,
} from "../manifest";

interface ImportOptions {
  pack?: string;
  invoice?: string;
  licenseTerms?: string;
  vendor?: string;
  sourceUrl?: string;
  license?: string;
  priceUsd?: string;
  orderId?: string;
  kind?: string;
  tags?: string;
  shipSafe?: string;
  currencyPaid?: string;
  purchaseAccount?: string;
  licenseUrl?: string;
  author?: string;
  brief?: string;
  name?: string;
}

interface ResolvedImportOptions {
  packPath: string;
  invoicePath: string;
  licenseTermsPath: string;
  vendor: string;
  sourceUrl: string;
  license: AssetLicense;
  priceUsd: number;
  orderId: string;
  kind: AssetKind;
  tags: string[];
  shipSafe: boolean;
  currencyPaid?: string;
  purchaseAccount?: string;
  licenseUrl?: string;
  author?: string;
  brief?: string;
  packName: string;
}

interface ImportResult {
  id: string;
  localPath: string;
  licenseTermsPath: string;
  manifestPath: string;
}

const PII_LICENSE_NAME_PATTERN = /(invoice|receipt|order)/i;

export async function runImportCommand(repoRoot: string, args: string[]): Promise<void> {
  const options = parseImportArgs(args);

  if (options.help === "true") {
    printImportHelp();
    return;
  }

  const resolved = await resolveImportOptions(repoRoot, options);
  const result = await importPaidAsset(repoRoot, resolved);

  console.log(`Imported paid asset ${result.id}`);
  console.log(`Pack copied to ${result.localPath}`);
  console.log(`License terms copied to ${result.licenseTermsPath}`);
  console.log(`Manifest updated at ${result.manifestPath}`);
}

function parseImportArgs(args: string[]): ImportOptions & { help?: string } {
  const options: ImportOptions & { help?: string } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = "true";
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = toCamelCase(arg.slice(2));
    const next = args[index + 1];

    if (next === undefined || next.startsWith("--")) {
      if (key === "shipSafe") {
        options.shipSafe = "true";
        continue;
      }

      throw new Error(`Missing value for ${arg}`);
    }

    setImportOption(options, key, next);
    index += 1;
  }

  return options;
}

function setImportOption(options: ImportOptions, key: string, value: string): void {
  switch (key) {
    case "pack":
      options.pack = value;
      break;
    case "invoice":
      options.invoice = value;
      break;
    case "licenseTerms":
      options.licenseTerms = value;
      break;
    case "vendor":
      options.vendor = value;
      break;
    case "sourceUrl":
      options.sourceUrl = value;
      break;
    case "license":
      options.license = value;
      break;
    case "priceUsd":
      options.priceUsd = value;
      break;
    case "orderId":
      options.orderId = value;
      break;
    case "kind":
      options.kind = value;
      break;
    case "tags":
      options.tags = value;
      break;
    case "shipSafe":
      options.shipSafe = value;
      break;
    case "currencyPaid":
      options.currencyPaid = value;
      break;
    case "purchaseAccount":
      options.purchaseAccount = value;
      break;
    case "licenseUrl":
      options.licenseUrl = value;
      break;
    case "author":
      options.author = value;
      break;
    case "brief":
      options.brief = value;
      break;
    case "name":
    case "packName":
      options.name = value;
      break;
    default:
      throw new Error(`Unknown option --${key}`);
  }
}

async function resolveImportOptions(repoRoot: string, options: ImportOptions): Promise<ResolvedImportOptions> {
  const prompt = createInterface({ input, output });

  try {
    const pack = await promptRequired(prompt, "Pack path", options.pack);
    const invoice = await promptRequired(prompt, "Invoice path (not copied into repo)", options.invoice);
    const licenseTerms = await promptRequired(prompt, "License terms path", options.licenseTerms);
    const vendor = await promptRequired(prompt, "Vendor", options.vendor);
    const sourceUrl = await promptRequired(prompt, "Source URL", options.sourceUrl);
    const license = await promptLicense(prompt, options.license);
    const priceUsd = await promptPriceUsd(prompt, options.priceUsd);
    const orderId = await promptRequired(prompt, "Order ID", options.orderId);
    const kind = await promptKind(prompt, options.kind);
    const tags = parseTags(options.tags ?? (await prompt.question("Tags (comma-separated, optional): ")));
    const shipSafe = await promptShipSafe(prompt, options.shipSafe);
    const packPath = resolveUserPath(pack);
    const packName = options.name ?? toTitleCase(stripArchiveExtension(path.basename(packPath)));

    assertPathInsideRepo(repoRoot, packPath, "pack");

    return {
      packPath,
      invoicePath: resolveUserPath(invoice),
      licenseTermsPath: resolveUserPath(licenseTerms),
      vendor,
      sourceUrl,
      license,
      priceUsd,
      orderId,
      kind,
      tags,
      shipSafe,
      currencyPaid: emptyToUndefined(options.currencyPaid),
      purchaseAccount: emptyToUndefined(options.purchaseAccount),
      licenseUrl: emptyToUndefined(options.licenseUrl),
      author: emptyToUndefined(options.author),
      brief: emptyToUndefined(options.brief),
      packName,
    };
  } finally {
    prompt.close();
  }
}

async function promptRequired(
  prompt: ReturnType<typeof createInterface>,
  label: string,
  value: string | undefined,
): Promise<string> {
  const resolved = value ?? (await prompt.question(`${label}: `));

  if (resolved.trim().length === 0) {
    throw new Error(`${label} is required`);
  }

  return resolved.trim();
}

async function promptLicense(
  prompt: ReturnType<typeof createInterface>,
  value: string | undefined,
): Promise<AssetLicense> {
  const resolved = value ?? (await prompt.question("License: "));

  if (!isAssetLicense(resolved)) {
    throw new Error(`License must be one of the supported manifest licenses`);
  }

  return resolved;
}

async function promptKind(prompt: ReturnType<typeof createInterface>, value: string | undefined): Promise<AssetKind> {
  const resolved = value ?? (await prompt.question("Kind (audio|graphics): "));

  if (!isAssetKind(resolved)) {
    throw new Error("Kind must be audio or graphics");
  }

  return resolved;
}

async function promptPriceUsd(prompt: ReturnType<typeof createInterface>, value: string | undefined): Promise<number> {
  const resolved = value ?? (await prompt.question("Price USD: "));
  const price = Number.parseFloat(resolved);

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Price USD must be a non-negative number");
  }

  return price;
}

async function promptShipSafe(prompt: ReturnType<typeof createInterface>, value: string | undefined): Promise<boolean> {
  if (value !== undefined) {
    return parseShipSafe(value);
  }

  const answer = await prompt.question(
    "Confirm this paid asset is ship-safe for commercial use (type yes or no): ",
  );

  return parseShipSafe(answer);
}

async function importPaidAsset(repoRoot: string, options: ResolvedImportOptions): Promise<ImportResult> {
  const vendorSlug = slugify(options.vendor);
  const packSlug = slugify(options.packName);
  const targetDir = path.join(repoRoot, "assets", options.kind, "raw", "paid", vendorSlug, packSlug);
  const licenseDir = path.join(repoRoot, "assets", "_licenses", vendorSlug, packSlug);
  const packTargetPath = path.join(targetDir, path.basename(options.packPath));
  const licenseTargetPath = path.join(licenseDir, path.basename(options.licenseTermsPath));

  assertLicenseTermsNameIsSafe(options.licenseTermsPath);

  await assertReadablePath(options.packPath, "pack");
  await assertReadablePath(options.invoicePath, "invoice");
  await assertReadablePath(options.licenseTermsPath, "license terms");

  const manifest = await readManifest(repoRoot);
  assertUniqueSourceUrl(manifest, options.sourceUrl);

  await mkdir(targetDir, { recursive: true });
  await copyPack(options.packPath, packTargetPath);
  await mkdir(licenseDir, { recursive: true });
  await copyFile(options.licenseTermsPath, licenseTargetPath);

  const receiptHash = await sha256File(options.invoicePath);
  const localPath = toRepoRelative(repoRoot, packTargetPath);
  const licenseTermsRelativePath = toRepoRelative(repoRoot, licenseTargetPath);
  const entry = createPaidAssetEntry(options, {
    id: `paid-${vendorSlug}-${packSlug}`,
    localPath,
    licenseTermsPath: licenseTermsRelativePath,
    receiptHash,
  });

  manifest.assets.push(entry);
  await writeManifest(repoRoot, manifest);

  return {
    id: entry.id,
    localPath,
    licenseTermsPath: licenseTermsRelativePath,
    manifestPath: toRepoRelative(repoRoot, path.join(repoRoot, "assets", "MANIFEST.json")),
  };
}

async function copyPack(sourcePath: string, targetPath: string): Promise<void> {
  const sourceStat = await stat(sourcePath);

  if (sourceStat.isDirectory()) {
    await cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true });
    return;
  }

  if (!sourceStat.isFile()) {
    throw new Error(`Pack path must be a file or directory: ${sourcePath}`);
  }

  await copyFile(sourcePath, targetPath);
}

function createPaidAssetEntry(
  options: ResolvedImportOptions,
  importInfo: {
    id: string;
    localPath: string;
    licenseTermsPath: string;
    receiptHash: string;
  },
): AssetEntry {
  const now = new Date().toISOString();
  const purchase: PurchaseInfo = {
    purchasedAt: now,
    priceUsd: options.priceUsd,
    currencyPaid: options.currencyPaid,
    vendor: options.vendor,
    orderId: options.orderId,
    receiptHash: importInfo.receiptHash,
    receiptHint: options.invoicePath,
    purchaseAccount: options.purchaseAccount,
    licenseTermsPath: importInfo.licenseTermsPath,
  };

  return {
    id: importInfo.id,
    source: "paid",
    sourceUrl: options.sourceUrl,
    license: options.license,
    licenseUrl: options.licenseUrl,
    attribution: `${options.packName} by ${options.vendor}`,
    author: options.author ?? options.vendor,
    fetchedAt: now,
    tags: options.tags,
    localPath: importInfo.localPath,
    brief: options.brief,
    kind: options.kind,
    shipSafe: options.shipSafe,
    purchase,
  };
}

async function assertReadablePath(filePath: string, label: string): Promise<void> {
  try {
    await stat(filePath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      throw new Error(`${label} path does not exist: ${filePath}`);
    }

    throw error;
  }
}

function assertLicenseTermsNameIsSafe(filePath: string): void {
  const basename = path.basename(filePath);

  if (PII_LICENSE_NAME_PATTERN.test(basename)) {
    throw new Error(
      `License terms filename looks like an invoice/receipt/order document and will not be copied: ${basename}`,
    );
  }
}

function assertPathInsideRepo(repoRoot: string, filePath: string, label: string): void {
  const relative = path.relative(repoRoot, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return;
  }

  if (label === "pack") {
    return;
  }
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function parseShipSafe(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (["yes", "y", "true", "1"].includes(normalized)) {
    return true;
  }

  if (["no", "n", "false", "0"].includes(normalized)) {
    return false;
  }

  throw new Error("shipSafe must be explicitly confirmed as yes/no or true/false");
}

function resolveUserPath(value: string): string {
  if (value === "~") {
    return process.env.HOME ?? value;
  }

  if (value.startsWith("~/")) {
    const home = process.env.HOME;

    if (home === undefined) {
      throw new Error("Cannot resolve ~/ path because HOME is not set");
    }

    return path.resolve(home, value.slice(2));
  }

  return path.resolve(value);
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripArchiveExtension(value: string): string {
  return value.replace(/\.(tar\.gz|tar\.bz2|tar\.xz|zip|7z|rar)$/i, "");
}

function toTitleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toRepoRelative(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function printImportHelp(): void {
  console.log(`Usage:
  npm run fetch-assets import -- --pack <path> --invoice <path> --license-terms <path> \\
    --vendor <name> --source-url <url> --license <license> --price-usd <amount> \\
    --order-id <id> --kind <audio|graphics> --tags "tag,tag" --ship-safe yes

Paid import copies the pack and license terms into assets/, hashes the invoice,
and records only the hash/path hint in assets/MANIFEST.json.`);
}
