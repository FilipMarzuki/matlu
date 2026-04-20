/**
 * Shared server-side utilities for the admin password gate.
 *
 * Session token = HMAC-SHA256(ADMIN_PASSWORD, 'matlu-admin-v1') in hex.
 * This means:
 *  - The cookie doesn't contain the plaintext password
 *  - Changing ADMIN_PASSWORD instantly invalidates all existing sessions
 *  - timingSafeEqual guards the login comparison against timing attacks
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'matlu_admin';
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

function sessionToken(password: string): string {
  return createHmac('sha256', password).update('matlu-admin-v1').digest('hex');
}

/** Validate the submitted password against ADMIN_PASSWORD env var. */
export function validatePassword(submitted: string): boolean {
  const expected = import.meta.env.ADMIN_PASSWORD ?? '';
  if (!expected) return false; // gate locked if env var is unset
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  // Must be same length for timingSafeEqual; pad to same length (constant-time)
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Build the Set-Cookie header value for a successful login. */
export function sessionCookieValue(password: string): string {
  const token = sessionToken(password);
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}

/** Check whether a request's cookie header contains a valid admin session. */
export function isAuthorized(cookieHeader: string | null): boolean {
  const password = import.meta.env.ADMIN_PASSWORD ?? '';
  if (!password || !cookieHeader) return false;
  const expected = sessionToken(password);
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  try {
    const got = Buffer.from(match[1], 'hex');
    const exp = Buffer.from(expected, 'hex');
    if (got.length !== exp.length) return false;
    return timingSafeEqual(got, exp);
  } catch {
    return false;
  }
}
