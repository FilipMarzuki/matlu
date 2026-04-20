import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'matlu_admin_session';
export const COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours in seconds

// HMAC-SHA256(password, fixed-label) → 64-char hex token.
// Stateless: anyone who knows the password can recompute the expected token,
// so the cookie is essentially a proof-of-knowing-the-password.
function computeToken(password: string): string {
  return createHmac('sha256', password).update('matlu-admin-v1').digest('hex');
}

export function createSessionToken(password: string): string {
  return computeToken(password);
}

// Returns true if cookieValue matches the expected token.
// Uses constant-time comparison so an attacker cannot measure how many hex
// nibbles matched and learn anything about the password.
export function verifySessionCookie(cookieValue: string, password: string): boolean {
  if (cookieValue.length !== 64) return false; // SHA-256 hex is always 64 chars
  const expected = computeToken(password);
  try {
    return timingSafeEqual(
      Buffer.from(cookieValue, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}
