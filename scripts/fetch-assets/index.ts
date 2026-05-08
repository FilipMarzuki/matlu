#!/usr/bin/env tsx

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFiles } from './env.js';
import {
  addManifestEntries,
  hasSourceUrl,
  readManifest,
  writeManifest,
} from './manifest.js';
import { AssetKindSchema, isCommercialSafeLicense, type AssetEntry, type AssetKind } from './schema.js';
import { sourcePlugins, type AssetCandidate, type AssetSourcePlugin } from './sources.js';

type Command = 'fetch' | 'import';

interface CliOptions {
  command: Command;
  brief: string | null;
  source: string | null;
  kind: AssetKind | null;
  limit: number;
  dryRun: boolean;
  allowRestricted: boolean;
}

interface ParseSuccess {
  ok: true;
  options: CliOptions;
}

interface ParseFailure {
  ok: false;
  message: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const MANIFEST_PATH = resolve(__dirname, 'MANIFEST.json');

async function main(): Promise<void> {
  await loadEnvFiles([
    resolve(ROOT, '.env'),
    resolve(ROOT, '.env.local'),
  ]);

  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const parsed = parseArgs(args);
  if (!parsed.ok) {
    console.error(parsed.message);
    console.error('');
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (parsed.options.command === 'import') {
    console.log('Paid asset import command reserved for FIL-364.');
    console.log('This skeleton accepts the command so future import flow can share the manifest schema.');
    return;
  }

  await runFetch(parsed.options);
}

function printUsage(): void {
  console.log(`Usage:
  npm run fetch-assets -- --brief "bird ambience" [options]
  npm run fetch-assets import -- --help

Options:
  --brief <text>          Search brief for source plugins
  --source <name|number>  Source plugin to use (default: stub)
  --kind <audio|graphics> Asset kind filter
  --limit <n>            Maximum candidates to inspect (default: 5)
  --dry-run              Log candidates without writing MANIFEST.json
  --allow-restricted     Include non-commercial/restricted licences
  --help                 Print this usage

Available sources:
${sourcePlugins.map((source: AssetSourcePlugin, index: number) => `  ${index + 1}. ${source.name} (${source.kind})`).join('\n')}
`);
}

function parseArgs(args: string[]): ParseSuccess | ParseFailure {
  const options: CliOptions = {
    command: 'fetch',
    brief: null,
    source: null,
    kind: null,
    limit: 5,
    dryRun: false,
    allowRestricted: false,
  };

  const rest = [...args];
  if (rest[0] === 'import') {
    options.command = 'import';
    rest.shift();
  }

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    switch (arg) {
      case '--brief':
        options.brief = readOptionValue(rest, index, arg);
        index++;
        break;
      case '--source':
        options.source = readOptionValue(rest, index, arg);
        index++;
        break;
      case '--kind': {
        const rawKind = readOptionValue(rest, index, arg);
        const parsedKind = AssetKindSchema.safeParse(rawKind);
        if (!parsedKind.success) return { ok: false, message: '--kind must be "audio" or "graphics".' };
        options.kind = parsedKind.data;
        index++;
        break;
      }
      case '--limit': {
        const rawLimit = readOptionValue(rest, index, arg);
        const limit = Number.parseInt(rawLimit, 10);
        if (!Number.isInteger(limit) || limit < 1) {
          return { ok: false, message: '--limit must be a positive integer.' };
        }
        options.limit = limit;
        index++;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--allow-restricted':
        options.allowRestricted = true;
        break;
      default:
        return { ok: false, message: `Unknown argument: ${arg}` };
    }
  }

  if (options.command === 'fetch' && (!options.brief || options.brief.trim().length === 0)) {
    return { ok: false, message: '--brief is required for asset fetches.' };
  }

  return { ok: true, options };
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function runFetch(options: CliOptions): Promise<void> {
  if (!options.brief) throw new Error('Missing brief after argument parsing.');

  const source = resolveSource(options.source);
  const manifest = await readManifest(MANIFEST_PATH);
  const candidates = await source.search({
    brief: options.brief,
    kind: options.kind ?? undefined,
    limit: options.limit,
  });

  const filtered = candidates.filter((candidate: AssetCandidate) =>
    shouldIncludeCandidate(candidate, options.allowRestricted),
  );
  const newCandidates = filtered.filter((candidate: AssetCandidate) =>
    !hasSourceUrl(manifest, candidate.sourceUrl),
  );

  if (options.dryRun) {
    printDryRun(source, filtered, newCandidates);
    return;
  }

  const entries: AssetEntry[] = [];
  for (const candidate of newCandidates) {
    const result = await source.download(candidate);
    entries.push(result.entry);
  }

  const nextManifest = addManifestEntries(manifest, entries);
  await writeManifest(MANIFEST_PATH, nextManifest);
  await readManifest(MANIFEST_PATH);

  console.log(`Recorded ${entries.length} asset entr${entries.length === 1 ? 'y' : 'ies'} in ${MANIFEST_PATH}.`);
}

function resolveSource(sourceOption: string | null): AssetSourcePlugin {
  if (!sourceOption) return sourcePlugins[0];

  const sourceNumber = Number.parseInt(sourceOption, 10);
  if (Number.isInteger(sourceNumber) && `${sourceNumber}` === sourceOption) {
    const byIndex = sourcePlugins[sourceNumber - 1];
    if (byIndex) return byIndex;
  }

  const byName = sourcePlugins.find((source: AssetSourcePlugin) => source.name === sourceOption);
  if (byName) return byName;

  throw new Error(`Unknown source "${sourceOption}". Run with --help to list available sources.`);
}

function shouldIncludeCandidate(candidate: AssetCandidate, allowRestricted: boolean): boolean {
  if (allowRestricted) return true;
  return isCommercialSafeLicense(candidate.license);
}

function printDryRun(
  source: AssetSourcePlugin,
  filtered: AssetCandidate[],
  newCandidates: AssetCandidate[],
): void {
  console.log(`Dry run using source "${source.name}"`);
  console.log(`Commercial-safe candidates: ${filtered.length}`);
  console.log(`New candidates after dedup: ${newCandidates.length}`);

  for (const candidate of newCandidates) {
    console.log(`- ${candidate.id} [${candidate.kind}] ${candidate.license} ${candidate.sourceUrl}`);
  }

  console.log('No files or manifest entries were written.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
