import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AssetManifestSchema, type AssetEntry, type AssetManifest } from './schema.js';

export const EMPTY_MANIFEST: AssetManifest = {
  version: 1,
  assets: [],
};

export async function readManifest(manifestPath: string): Promise<AssetManifest> {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    return AssetManifestSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isNodeFileNotFound(error)) return EMPTY_MANIFEST;
    throw error;
  }
}

export async function writeManifest(manifestPath: string, manifest: AssetManifest): Promise<void> {
  const parsed = AssetManifestSchema.parse(manifest);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

export function hasSourceUrl(manifest: AssetManifest, sourceUrl: string): boolean {
  return manifest.assets.some((entry: AssetEntry) => entry.sourceUrl === sourceUrl);
}

export function addManifestEntries(
  manifest: AssetManifest,
  entries: AssetEntry[],
): AssetManifest {
  return AssetManifestSchema.parse({
    ...manifest,
    assets: [...manifest.assets, ...entries],
  });
}

function isNodeFileNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}
