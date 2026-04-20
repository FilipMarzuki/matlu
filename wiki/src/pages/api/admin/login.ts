// POST /api/admin/login — verifies the admin password and sets a session cookie.
// The cookie value is HMAC(password, fixed-label) so it is stateless but cannot
// be forged without knowing the password. Uses constant-time comparison throughout
// to prevent timing oracles.
export const prerender = false;

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { ADMIN_COOKIE, COOKIE_MAX_AGE, createSessionToken } from '../../../lib/adminAuth';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Constant-time string comparison that does not leak string length through early
// exit. Both buffers are padded to the longer length before comparison, then the
// original lengths are checked in a final non-branching AND.
function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  const maxLen = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(maxLen);
  const bPad = Buffer.alloc(maxLen);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  // timingSafeEqual prevents per-byte leaks; the length check ensures we don't
  // accept a prefix that happens to match after zero-padding.
  return timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}

function json(data: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  if (!isObject(body) || typeof body.password !== 'string') {
    return json({ error: 'invalid_request' }, 400);
  }

  const adminPassword = import.meta.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return json({ error: 'server_misconfiguration' }, 500);
  }

  if (!constantTimeStringEqual(body.password, adminPassword)) {
    return json({ error: 'incorrect' }, 401);
  }

  cookies.set(ADMIN_COOKIE, createSessionToken(adminPassword), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });

  return json({ ok: true }, 200);
};
