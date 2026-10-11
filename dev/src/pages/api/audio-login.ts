/**
 * POST /api/audio-login
 *
 * Body: { password: string }
 * Exchanges the shared AUDIO_EDITOR_PASSWORD for a session token the client
 * stores in sessionStorage and replays as a bearer token (see audio-auth.ts).
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { login } from '../../lib/audio-auth';

export const POST: APIRoute = async ({ request }) => {
  let password: string;
  try {
    const body = await request.json();
    password = body.password;
    if (typeof password !== 'string' || !password) throw new Error('missing password');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = login(password);
  if (!token) {
    return new Response(JSON.stringify({ error: 'Incorrect password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
