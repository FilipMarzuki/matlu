/**
 * convert-heightmap.ts — downloads and converts an Earth heightmap TIF to PNG.
 *
 * Usage:
 *   npm run worldgen:heightmap                   download + convert
 *   npm run worldgen:heightmap -- --input foo.tif  use local file instead
 *   npm run worldgen:heightmap -- --size 4096x2048 override output size
 *
 * Output: macro-world/earth-reference/heightmap.png (grayscale, 2048×1024)
 * Source: Natural Earth III grayscale DEM (public domain, shadedrelief.com)
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Natural Earth III grayscale DEM — 8640×4320, public domain
const SOURCE_URL =
  'https://www.shadedrelief.com/natural3/ne3_data/8192/elev/NE1_HR_LC_SR_W.tif';

const CACHE_PATH = path.join(REPO_ROOT, 'macro-world', 'earth-reference', '_heightmap_source.tif');
const OUTPUT_PATH = path.join(REPO_ROOT, 'macro-world', 'earth-reference', 'heightmap.png');

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(): { input: string | null; width: number; height: number } {
  const args = process.argv.slice(2);
  let input: string | null = null;
  let width = 2048;
  let height = 1024;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      input = args[++i];
    } else if (args[i] === '--size' && args[i + 1]) {
      const parts = args[++i].split('x');
      if (parts.length !== 2) {
        console.error('--size must be in WxH format, e.g. 2048x1024');
        process.exit(1);
      }
      width = parseInt(parts[0], 10);
      height = parseInt(parts[1], 10);
      if (isNaN(width) || isNaN(height) || width < 1 || height < 1) {
        console.error('--size values must be positive integers');
        process.exit(1);
      }
    }
  }

  return { input, width, height };
}

// ── Download ──────────────────────────────────────────────────────────────────

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const makeRequest = (targetUrl: string, redirectCount: number): void => {
      if (redirectCount > 5) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error('Too many redirects'));
        return;
      }

      const protocol = targetUrl.startsWith('https') ? https : http;
      protocol
        .get(targetUrl, (res) => {
          // Follow redirects (301, 302, 307, 308)
          if (
            (res.statusCode === 301 ||
              res.statusCode === 302 ||
              res.statusCode === 307 ||
              res.statusCode === 308) &&
            res.headers.location
          ) {
            makeRequest(res.headers.location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            file.close();
            fs.unlinkSync(dest);
            reject(
              new Error(
                `Download failed: HTTP ${res.statusCode ?? 'unknown'}. ` +
                  `Try downloading manually and passing --input <file>.`,
              ),
            );
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10);
          let receivedBytes = 0;
          let lastLoggedMB = 0;

          res.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            const mb = Math.floor(receivedBytes / (1024 * 1024));
            if (mb > lastLoggedMB) {
              lastLoggedMB = mb;
              const pct =
                totalBytes > 0 ? ` (${Math.round((receivedBytes / totalBytes) * 100)}%)` : '';
              process.stdout.write(`\r  Downloaded ${mb} MB${pct}   `);
            }
          });

          res.pipe(file);
          file.on('finish', () => {
            process.stdout.write('\n');
            file.close();
            resolve();
          });
        })
        .on('error', (err) => {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            // ignore cleanup errors
          }
          reject(
            new Error(
              `Network error: ${err.message}. ` +
                `Try downloading manually and passing --input <file>.`,
            ),
          );
        });
    };

    makeRequest(url, 0);
  });
}

async function ensureSourceFile(inputFlag: string | null): Promise<string> {
  if (inputFlag) {
    if (!fs.existsSync(inputFlag)) {
      throw new Error(`Input file not found: ${inputFlag}`);
    }
    console.log(`Using local file: ${inputFlag}`);
    return inputFlag;
  }

  if (fs.existsSync(CACHE_PATH)) {
    console.log(`Cache hit — skipping download: ${CACHE_PATH}`);
    return CACHE_PATH;
  }

  console.log(`Downloading heightmap from:\n  ${SOURCE_URL}`);
  console.log(
    'This is a large file (~200 MB). If it fails, download manually and use --input.',
  );

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  await download(SOURCE_URL, CACHE_PATH);
  console.log(`Saved to cache: ${CACHE_PATH}`);
  return CACHE_PATH;
}

// ── Convert ───────────────────────────────────────────────────────────────────

async function convertToPng(
  sourcePath: string,
  outputPath: string,
  width: number,
  height: number,
): Promise<void> {
  console.log(`Converting ${path.basename(sourcePath)} → ${path.basename(outputPath)}`);
  console.log(`  Target size: ${width}×${height}`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await sharp(sourcePath)
    // Resize first — cheaper normalize on smaller image
    .resize(width, height, { fit: 'fill' })
    // Convert to single-channel grayscale
    .grayscale()
    // Stretch contrast so darkest pixel → 0, brightest → 255
    // This ensures oceans are near black and Himalayas near white
    .normalize()
    .png()
    .toFile(outputPath);

  const stat = fs.statSync(outputPath);
  console.log(`  Saved: ${outputPath} (${(stat.size / 1024).toFixed(0)} KB)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { input, width, height } = parseArgs();

  try {
    const sourcePath = await ensureSourceFile(input);
    await convertToPng(sourcePath, OUTPUT_PATH, width, height);
    console.log('\nDone. heightmap.png ready for Azgaar import.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${message}`);
    process.exit(1);
  }
}

void main();
