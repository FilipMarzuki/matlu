import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AssetManifest, AssetManifestEntry } from './types';

const MANIFEST_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseManifest(raw: unknown): AssetManifest {
  if (!isRecord(raw)) return emptyManifest();
  const entries = Array.isArray(raw.entries)
    ? raw.entries.filter(isManifestEntry)
    : [];

  return {
    version: MANIFEST_VERSION,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date(0).toISOString(),
    entries,
  };
}

function isManifestEntry(value: unknown): value is AssetManifestEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.source === 'string' &&
    typeof value.sourceUrl === 'string' &&
    typeof value.license === 'string' &&
    typeof value.fetchedAt === 'string' &&
    Array.isArray(value.tags) &&
    typeof value.localPath === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.shipSafe === 'boolean' &&
    value.purchase === null
  );
}

function emptyManifest(): AssetManifest {
  return {
    version: MANIFEST_VERSION,
    generatedAt: new Date(0).toISOString(),
    entries: [],
  };
}

export function manifestPath(projectRoot: string): string {
  return join(projectRoot, 'assets', 'MANIFEST.json');
}

export function readManifest(projectRoot: string): AssetManifest {
  const filePath = manifestPath(projectRoot);
  if (!existsSync(filePath)) return emptyManifest();
  return parseManifest(JSON.parse(readFileSync(filePath, 'utf8')) as unknown);
}

export function hasSourceUrl(manifest: AssetManifest, sourceUrl: string): boolean {
  return manifest.entries.some((entry) => entry.sourceUrl === sourceUrl);
}

export function upsertManifestEntry(projectRoot: string, entry: AssetManifestEntry): AssetManifest {
  const filePath = manifestPath(projectRoot);
  const manifest = readManifest(projectRoot);
  const withoutExisting = manifest.entries.filter((item) => item.sourceUrl !== entry.sourceUrl);
  const updated: AssetManifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    entries: [...withoutExisting, entry].sort((a, b) => a.id.localeCompare(b.id)),
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  return updated;
}
