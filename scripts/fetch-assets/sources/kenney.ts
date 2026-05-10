import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import unzipper from 'unzipper';
import type {
  AssetKind,
  AssetManifestEntry,
  AssetSource,
  DownloadOptions,
  SearchOptions,
  ShipSafeLicense,
  SourceSearchResult,
} from '../types';

interface KenneyPack {
  slug: string;
  name: string;
  kind: AssetKind;
  description: string;
  tags: string[];
  sourceUrl: string;
  downloadUrl: string;
  license: ShipSafeLicense;
  licenseUrl: string;
}

interface ZipEntry {
  path: string;
  type: 'File' | 'Directory';
  buffer(): Promise<Buffer>;
  autodrain(): void;
}

const PACKS_PATH = fileURLToPath(new URL('./kenney-packs.json', import.meta.url));
const KENNEY_AUTHOR = 'Kenney';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAssetKind(value: unknown): value is AssetKind {
  return value === 'audio' || value === 'graphics';
}

function isKenneyPack(value: unknown): value is KenneyPack {
  if (!isRecord(value)) return false;
  return (
    typeof value.slug === 'string' &&
    typeof value.name === 'string' &&
    isAssetKind(value.kind) &&
    typeof value.description === 'string' &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    typeof value.sourceUrl === 'string' &&
    typeof value.downloadUrl === 'string' &&
    value.license === 'CC0' &&
    typeof value.licenseUrl === 'string'
  );
}

function loadPacks(): KenneyPack[] {
  const parsed = JSON.parse(readFileSync(PACKS_PATH, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Kenney pack index must be an array: ${PACKS_PATH}`);
  }

  const invalidIndex = parsed.findIndex((entry) => !isKenneyPack(entry));
  if (invalidIndex >= 0) {
    throw new Error(`Invalid Kenney pack at index ${invalidIndex} in ${PACKS_PATH}`);
  }

  return parsed;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1);
}

function scorePack(pack: KenneyPack, brief: string): number {
  const lowerBrief = brief.toLowerCase().trim();
  const tokens = tokenize(brief);
  const name = pack.name.toLowerCase();
  const tags = pack.tags.map((tag) => tag.toLowerCase());
  const haystack = [pack.slug, name, pack.description.toLowerCase(), ...tags].join(' ');

  let score = 0;
  if (name.includes(lowerBrief)) score += 12;
  if (pack.description.toLowerCase().includes(lowerBrief)) score += 6;

  for (const token of tokens) {
    if (name.includes(token)) score += 6;
    if (tags.some((tag) => tag.includes(token))) score += 5;
    if (pack.slug.includes(token)) score += 4;
    if (pack.description.toLowerCase().includes(token)) score += 2;
    if (haystack.includes(token)) score += 1;
  }

  return score;
}

function outputRoot(projectRoot: string, kind: AssetKind): string {
  const folder = kind === 'audio' ? 'audio' : 'gfx';
  return join(projectRoot, 'assets', folder, 'raw', 'kenney');
}

function safeZipPath(entryPath: string): string | null {
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.length === 0 || normalized.includes('../')) return null;
  return normalized;
}

function collectFiles(projectRoot: string, extractDir: string): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(relative(projectRoot, fullPath).replace(/\\/g, '/'));
      }
    }
  }

  walk(extractDir);
  return files.sort((a, b) => a.localeCompare(b));
}

async function downloadZip(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Kenney download failed (${response.status}) for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function extractZip(buffer: Buffer, extractDir: string): Promise<void> {
  const directory = await unzipper.Open.buffer(buffer);
  const rootDir = resolve(extractDir);

  for (const entry of directory.files as ZipEntry[]) {
    const safePath = safeZipPath(entry.path);
    if (safePath === null || entry.type !== 'File') {
      entry.autodrain();
      continue;
    }

    const outPath = resolve(extractDir, safePath);
    if (!outPath.startsWith(rootDir)) {
      entry.autodrain();
      continue;
    }

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, await entry.buffer());
  }
}

function toSearchResult(pack: KenneyPack, score: number): SourceSearchResult {
  return {
    id: `kenney-${pack.slug}`,
    title: pack.name,
    source: 'kenney',
    sourceUrl: pack.sourceUrl,
    downloadUrl: pack.downloadUrl,
    description: pack.description,
    tags: pack.tags,
    kind: pack.kind,
    license: pack.license,
    licenseUrl: pack.licenseUrl,
    author: KENNEY_AUTHOR,
    score,
  };
}

function manifestEntry(
  result: SourceSearchResult,
  options: DownloadOptions,
  localPath: string,
  files: string[],
): AssetManifestEntry {
  return {
    id: result.id,
    source: result.source,
    sourceUrl: result.sourceUrl,
    license: result.license,
    licenseUrl: result.licenseUrl,
    attribution: `${KENNEY_AUTHOR} (${result.license})`,
    author: result.author,
    fetchedAt: new Date().toISOString(),
    tags: result.tags,
    localPath,
    files,
    brief: options.brief,
    kind: result.kind,
    shipSafe: result.license === 'CC0',
    purchase: null,
  };
}

export const kenneySource: AssetSource = {
  name: 'kenney',

  async search(brief: string, options: SearchOptions): Promise<SourceSearchResult[]> {
    const packs = loadPacks();
    return packs
      .filter((pack) => options.kind === undefined || pack.kind === options.kind)
      .map((pack) => toSearchResult(pack, scorePack(pack, brief)))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, options.limit);
  },

  async download(result: SourceSearchResult, options: DownloadOptions): Promise<AssetManifestEntry> {
    const root = outputRoot(options.projectRoot, result.kind);
    const slug = result.id.replace(/^kenney-/, '');
    const zipPath = join(root, `${slug}.zip`);
    const extractDir = join(root, slug);
    const localPath = relative(options.projectRoot, extractDir).replace(/\\/g, '/');

    mkdirSync(root, { recursive: true });

    const existingFiles = collectFiles(options.projectRoot, extractDir);
    if (existingFiles.length > 0) {
      console.log(`Skipping ${result.title}; already extracted at ${localPath}`);
      return manifestEntry(result, options, localPath, existingFiles);
    }

    const buffer = await downloadZip(result.downloadUrl);
    writeFileSync(zipPath, buffer);
    await extractZip(buffer, extractDir);

    const files = collectFiles(options.projectRoot, extractDir);
    console.log(`Downloaded ${result.title} (${files.length} extracted file(s))`);
    return manifestEntry(result, options, localPath, files);
  },
};
