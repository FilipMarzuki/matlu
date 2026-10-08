/**
 * Shared server-side auth for the /audio editor (#944).
 *
 * The client never sees AUDIO_EDITOR_PASSWORD. /api/audio-login exchanges the
 * password for an HMAC session token, which the browser keeps in
 * sessionStorage and sends as `Authorization: Bearer <token>` on every
 * subsequent request. Changing AUDIO_EDITOR_PASSWORD instantly invalidates
 * every outstanding token. timingSafeEqual guards both comparisons against
 * timing attacks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

function expectedPassword(): string {
  return import.meta.env.AUDIO_EDITOR_PASSWORD ?? '';
}

function sessionToken(password: string): string {
  return createHmac('sha256', password).update('matlu-audio-editor-v1').digest('hex');
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Validate a submitted password against AUDIO_EDITOR_PASSWORD; returns the session token on success. */
export function login(submittedPassword: string): string | null {
  const expected = expectedPassword();
  if (!expected || !timingSafeEqualStrings(submittedPassword, expected)) return null;
  return sessionToken(expected);
}

/** Validate a bearer token against the current AUDIO_EDITOR_PASSWORD. */
export function isValidToken(token: string | null): boolean {
  const expected = expectedPassword();
  if (!expected || !token) return false;
  return timingSafeEqualStrings(token, sessionToken(expected));
}

/** Pull the bearer token out of an Authorization header, if present. */
export function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
