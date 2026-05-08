import type { AssetEntry, AssetKind, AssetLicense } from './schema.js';

export interface AssetSearchOptions {
  brief: string;
  kind?: AssetKind;
  limit: number;
}

export interface AssetCandidate {
  id: string;
  source: string;
  sourceUrl: string;
  license: AssetLicense;
  licenseUrl?: string;
  attribution?: string;
  author?: string;
  tags: string[];
  brief?: string;
  kind: AssetKind;
  localPath: string;
  files?: string[];
  purchase: null;
}

export interface DownloadResult {
  entry: AssetEntry;
}

/**
 * Source plugins keep provider-specific discovery/download logic isolated from
 * the CLI. A plugin searches for normalized candidates, then downloads a chosen
 * candidate and returns the manifest entry to record. Real provider plugins
 * should keep API credentials in environment variables loaded by the CLI.
 */
export interface AssetSourcePlugin {
  name: string;
  kind: AssetKind | 'mixed';
  search(options: AssetSearchOptions): Promise<AssetCandidate[]>;
  download(candidate: AssetCandidate): Promise<DownloadResult>;
}

export const stubSource: AssetSourcePlugin = {
  name: 'stub',
  kind: 'mixed',
  async search(options: AssetSearchOptions): Promise<AssetCandidate[]> {
    const kind = options.kind ?? 'audio';
    const count = Math.max(0, options.limit);

    return Array.from({ length: count }, (_unused: unknown, index: number) => ({
      id: `stub-${kind}-${index + 1}`,
      source: 'stub',
      sourceUrl: `https://example.com/matlu/stub-${kind}-${index + 1}`,
      license: 'CC0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: 'Stub Asset (CC0)',
      author: 'Matlu asset fetcher stub',
      tags: ['stub', kind],
      brief: options.brief,
      kind,
      localPath: `public/assets/fetched/stub-${kind}-${index + 1}`,
      purchase: null,
    }));
  },
  async download(candidate: AssetCandidate): Promise<DownloadResult> {
    return {
      entry: {
        ...candidate,
        fetchedAt: new Date().toISOString(),
        shipSafe: true,
      },
    };
  },
};

export const sourcePlugins: AssetSourcePlugin[] = [stubSource];
