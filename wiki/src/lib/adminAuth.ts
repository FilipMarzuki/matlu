/**
 * Checks whether the incoming request carries a valid admin session cookie.
 * The cookie value must match the ADMIN_PASSWORD env var (set in Vercel).
 * Used by admin pages and API routes to gate access server-side.
 */
import type { AstroCookies } from 'astro';

export function isAdminAuthenticated(cookies: AstroCookies): boolean {
  const expected = import.meta.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return cookies.get('admin_session')?.value === expected;
}
