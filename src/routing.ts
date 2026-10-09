/**
 * Hostname-aware default route (#1193): the survival crafter ships as its own
 * site, "Artificer: Convergence", on the same bundle as Core Warden. Which
 * scene `/` resolves to — and which branding applies — depends on either an
 * explicit `VITE_DEFAULT_ROUTE` env var (set on the Vercel project) or, as a
 * fallback for a preview deploy that hasn't got the env var yet, the
 * `artificer.` hostname prefix.
 *
 * Pulled out of main.ts so it's a pure function Vitest can exercise without a
 * browser — main.ts has side effects (it builds the Phaser game) as soon as
 * it's imported.
 */

export interface RouteEnv {
  readonly VITE_DEFAULT_ROUTE?: string;
}

/** The route `/` should resolve to when no path is given, or null for the ordinary default. */
function defaultRoute(hostname: string, env: RouteEnv): string | null {
  if (env.VITE_DEFAULT_ROUTE) return env.VITE_DEFAULT_ROUTE;
  if (hostname.startsWith('artificer.')) return 'crafter';
  return null;
}

/** True when this build/host should present itself as Artificer: Convergence rather than Matlu. */
export function isArtificerHost(hostname: string, env: RouteEnv): boolean {
  return defaultRoute(hostname, env) !== null;
}

/**
 * Resolves `window.location.pathname` to the route key main.ts's scene-order
 * switch understands. Every explicit path (`/crafter`, `/settlement`, …)
 * passes through unchanged on every host; only `/` is affected.
 */
export function resolveRoute(path: string, hostname: string, env: RouteEnv): string {
  const trimmed = path.replace(/\/$/, '');
  if (trimmed !== '') return trimmed;
  const route = defaultRoute(hostname, env);
  return route ? `/${route}` : '';
}
