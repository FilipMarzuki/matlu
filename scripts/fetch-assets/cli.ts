import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { hasSourceUrl, manifestPath, readManifest, upsertManifestEntry } from './manifest';
import { kenneySource } from './sources/kenney';
import type { AssetKind, AssetSource } from './types';

interface CliOptions {
  source: string;
  brief: string;
  kind?: AssetKind;
  limit: number;
  dryRun: boolean;
  help: boolean;
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const sources = new Map<string, AssetSource>([[kenneySource.name, kenneySource]]);

function usage(): string {
  return [
    'Usage:',
    '  npm run fetch-assets -- --source kenney --brief "UI sounds" --limit 1',
    '',
    'Options:',
    '  --source <name>       Source plugin to use (currently: kenney)',
    '  --brief <text>        Search brief, e.g. "UI sounds"',
    '  --kind <kind>         Optional kind filter: audio, graphics, or gfx',
    '  --limit <n>           Max packs/files to fetch (default: 5)',
    '  --dry-run             Show matches without downloading or writing manifest',
    '  --help                Print this message',
  ].join('\n');
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function normalizeKind(value: string | undefined): AssetKind | undefined {
  if (value === undefined) return undefined;
  if (value === 'audio') return 'audio';
  if (value === 'graphics' || value === 'graphic' || value === 'gfx') return 'graphics';
  throw new Error(`Unsupported kind "${value}". Use audio, graphics, or gfx.`);
}

function parseOptions(args: string[]): CliOptions {
  const help = args.includes('--help') || args.includes('-h');
  const source = readFlagValue(args, '--source') ?? 'kenney';
  const brief = readFlagValue(args, '--brief') ?? '';
  const limitRaw = readFlagValue(args, '--limit') ?? '5';
  const limit = Number.parseInt(limitRaw, 10);

  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`Invalid --limit "${limitRaw}". Use a positive integer.`);
  }

  return {
    source,
    brief,
    kind: normalizeKind(readFlagValue(args, '--kind')),
    limit,
    dryRun: args.includes('--dry-run'),
    help,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.brief.trim().length === 0) {
    throw new Error(`Missing --brief.\n\n${usage()}`);
  }

  const source = sources.get(options.source);
  if (source === undefined) {
    throw new Error(`Unknown source "${options.source}". Available sources: ${[...sources.keys()].join(', ')}`);
  }

  const results = await source.search(options.brief, {
    kind: options.kind,
    limit: options.limit,
  });

  if (results.length === 0) {
    console.log(`No ${source.name} results found for "${options.brief}".`);
    return;
  }

  console.log(`Matched ${results.length} ${source.name} result(s):`);
  for (const result of results) {
    console.log(`  - ${result.title} (${result.kind}, score ${result.score})`);
  }

  if (options.dryRun) {
    console.log('\nDry run: no files downloaded and manifest not updated.');
    return;
  }

  const manifest = readManifest(projectRoot);
  for (const result of results) {
    if (hasSourceUrl(manifest, result.sourceUrl)) {
      console.log(`Skipping ${result.title}; manifest already has ${result.sourceUrl}`);
      continue;
    }

    const entry = await source.download(result, {
      brief: options.brief,
      dryRun: options.dryRun,
      projectRoot,
    });
    const updated = upsertManifestEntry(projectRoot, entry);
    console.log(`Wrote ${manifestPath(projectRoot)} (${updated.entries.length} entr${updated.entries.length === 1 ? 'y' : 'ies'})`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
