/**
 * POST /api/audio-upload
 *
 * Auth: Authorization: Bearer <session token from /api/audio-login>
 * Body: { key: string, filename: string, fileBase64: string }
 *
 * Commits the uploaded file to public/assets/audio/uploads/<key>/<filename>
 * and repoints that manifest entry's files[0] at it, both on the
 * AUDIO_GITHUB_BRANCH branch (default `sound-updates`, created off `main` if
 * it doesn't exist yet). Nothing touches `main` directly — a human opens the
 * PR from there once they're happy with the swap.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { bearerToken, isValidToken } from '../../lib/audio-auth';
import { ensureBranch, getFile, putFile } from '../../lib/github-content';

const MANIFEST_PATH = 'src/data/audio-manifest.json';
const ALLOWED_EXTENSIONS = ['.ogg', '.mp3'];

interface AudioManifestEntry {
  label: string;
  description: string;
  category: string;
  files: string[];
  fallback?: string[];
  volume: number;
  loop: boolean;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!isValidToken(bearerToken(request.headers.get('Authorization')))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let key: string;
  let filename: string;
  let fileBase64: string;
  try {
    const body = await request.json();
    key = body.key;
    filename = body.filename;
    fileBase64 = body.fileBase64;
    if (!key || !filename || !fileBase64) throw new Error('missing field');
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return jsonResponse({ error: `Only ${ALLOWED_EXTENSIONS.join(', ')} files are accepted` }, 400);
  }
  // filename lands directly in a repo path — reject anything that isn't a plain file name.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)) {
    return jsonResponse({ error: 'Invalid filename' }, 400);
  }

  const branch = import.meta.env.AUDIO_GITHUB_BRANCH ?? 'sound-updates';
  const baseBranch = 'main';

  try {
    await ensureBranch(branch, baseBranch);

    // ensureBranch guarantees `branch` exists and starts from `main`'s tree.
    const manifestFile = await getFile(MANIFEST_PATH, branch);
    if (!manifestFile) return jsonResponse({ error: 'Manifest not found' }, 500);
    const manifest: Record<string, AudioManifestEntry> = JSON.parse(
      Buffer.from(manifestFile.contentBase64, 'base64').toString('utf-8')
    );
    const entry = manifest[key];
    if (!entry) return jsonResponse({ error: `Unknown sound key "${key}"` }, 400);

    const audioPath = `public/assets/audio/uploads/${key}/${filename}`;
    const existingAudioFile = await getFile(audioPath, branch);
    await putFile(
      audioPath,
      fileBase64,
      `audio: replace "${key}" with ${filename}`,
      branch,
      existingAudioFile?.sha
    );

    entry.files = [audioPath.replace(/^public\//, '')];
    delete entry.fallback;
    const updatedManifestBase64 = Buffer.from(JSON.stringify(manifest, null, 2) + '\n').toString('base64');
    await putFile(
      MANIFEST_PATH,
      updatedManifestBase64,
      `audio: point "${key}" at ${filename}`,
      branch,
      manifestFile.sha
    );

    return jsonResponse({ ok: true, branch }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 502);
  }
};
