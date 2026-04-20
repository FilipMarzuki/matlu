/**
 * POST /api/admin/login
 * Validates the submitted password against the ADMIN_PASSWORD env var.
 * On success, sets an httpOnly `admin_session` cookie and redirects to the pipeline.
 * On failure, redirects back to the login page with ?error=1.
 */
export const prerender = false;
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const password = form.get('password');
  const expected = import.meta.env.ADMIN_PASSWORD;

  if (!expected || typeof password !== 'string' || password !== expected) {
    return redirect('/admin/login?error=1');
  }

  // httpOnly prevents JS from reading the cookie; secure requires HTTPS (Vercel enforces this)
  cookies.set('admin_session', password, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 8, // 8 hours
  });

  return redirect('/admin/creatures');
};
