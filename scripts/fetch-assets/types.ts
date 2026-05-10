export type AssetKind = 'audio' | 'graphics';

export type ShipSafeLicense =
  | 'CC0'
  | 'CC-BY'
  | 'public-domain'
  | 'commercial-royalty-free'
  | 'custom'
  | 'other';

export interface AssetManifestEntry {
  id: string;
  source: string;
  sourceUrl: string;
  license: ShipSafeLicense;
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
  purchase: null;
}

export interface AssetManifest {
  version: 1;
  generatedAt: string;
  entries: AssetManifestEntry[];
}

export interface SearchOptions {
  kind?: AssetKind;
  limit: number;
}

export interface DownloadOptions {
  brief?: string;
  dryRun: boolean;
  projectRoot: string;
}

export interface SourceSearchResult {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  downloadUrl: string;
  description: string;
  tags: string[];
  kind: AssetKind;
  license: ShipSafeLicense;
  licenseUrl?: string;
  author?: string;
  score: number;
}

export interface AssetSource {
  name: string;
  search(brief: string, options: SearchOptions): Promise<SourceSearchResult[]>;
  download(entry: SourceSearchResult, options: DownloadOptions): Promise<AssetManifestEntry>;
}
