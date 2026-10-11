/**
 * GET /api/audio-manifest
 *
 * Auth: Authorization: Bearer <session token from /api/audio-login>
 * Returns the current src/data/audio-manifest.json from `main`, so the
 * editor table always reflects what's live.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { bearerToken, isValidToken } from '../../lib/audio-auth';
import { getFile } from '../../lib/github-content';

const MANIFEST_PATH = 'src/data/audio-manifest.json';

export const GET: APIRoute = async ({ request }) => {
  if (!isValidToken(bearerToken(request.headers.get('Authorization')))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const file = await getFile(MANIFEST_PATH, 'main');
    if (!file) {
      return new Response(JSON.stringify({ error: 'Manifest not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const manifest = JSON.parse(Buffer.from(file.contentBase64, 'base64').toString('utf-8'));
    return new Response(JSON.stringify({ manifest }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
