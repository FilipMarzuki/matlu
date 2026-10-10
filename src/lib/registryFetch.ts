/**
 * registryFetch.ts — reading registry JSON that's fetched at runtime, one file at a time (#1512).
 *
 * A fetched registry can fail in three ways: the request itself fails, the server answers with an
 * error status, or it answers 200 with something that isn't JSON. The last one is the sneaky one.
 * Vercel rewrites every missing path to index.html, so a registry that isn't in the build comes
 * back as a web page with a 200, and only `res.json()` notices. Each helper here turns all three
 * into `null`, so a caller can fall back for that one file and keep the rest.
 */

/** The bits of a fetch Response these helpers read (so tests can pass a plain `Response`). */
type Got = Pick<Response, 'ok' | 'json'>;

/** `body[key]` from a fetched registry, or null when the request, the JSON or the list isn't there. */
export async function listFrom(get: () => Promise<Got>, key: string): Promise<unknown[] | null> {
  try {
    const res = await get();
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const list = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

/**
 * The crafting menu's two fetched registries, each read on its own: one file that fails can't
 * take the other down with it. (The item registry is bundled instead; see `REGISTRY_ITEMS`.)
 */
export async function fetchMenuLists(get: (url: string) => Promise<Got>): Promise<{ concepts: unknown[] | null; recipes: unknown[] | null }> {
  const [concepts, recipes] = await Promise.all([
    listFrom(() => get('/macro-world/concepts.json'), 'concepts'),
    listFrom(() => get('/macro-world/recipes.json'), 'recipes'),
  ]);
  return { concepts, recipes };
}
