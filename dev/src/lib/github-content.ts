/**
 * Minimal GitHub Contents API client used by the /audio editor (#944) to read
 * and write files without a local git checkout — the Vercel function only has
 * the deployed bundle, not the repo working tree.
 *
 * Auth: AUDIO_GITHUB_TOKEN, a PAT with contents:write on AUDIO_GITHUB_REPO.
 */

const API_BASE = 'https://api.github.com';

export interface GithubFile {
  sha: string;
  contentBase64: string;
}

function repoSlug(): string {
  return import.meta.env.AUDIO_GITHUB_REPO ?? 'FilipMarzuki/matlu';
}

function authHeaders(): Record<string, string> {
  const token = import.meta.env.AUDIO_GITHUB_TOKEN ?? '';
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };
}

/** Fetch a file's current content + blob sha from a given ref (branch or commit). */
export async function getFile(path: string, ref: string): Promise<GithubFile | null> {
  const res = await fetch(
    `${API_BASE}/repos/${repoSlug()}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`,
    { headers: authHeaders() }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFile ${path}@${ref} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { sha: json.sha, contentBase64: json.content.replace(/\n/g, '') };
}

/** Create or update a file on `branch` via a single commit. */
export async function putFile(
  path: string,
  contentBase64: string,
  message: string,
  branch: string,
  sha?: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/repos/${repoSlug()}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub putFile ${path}@${branch} failed: ${res.status} ${await res.text()}`);
}

/** Ensure `branch` exists, branching it off `baseBranch` if it doesn't yet. */
export async function ensureBranch(branch: string, baseBranch: string): Promise<void> {
  const existing = await fetch(`${API_BASE}/repos/${repoSlug()}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers: authHeaders(),
  });
  if (existing.ok) return;

  const base = await fetch(`${API_BASE}/repos/${repoSlug()}/git/ref/heads/${encodeURIComponent(baseBranch)}`, {
    headers: authHeaders(),
  });
  if (!base.ok) throw new Error(`GitHub ensureBranch: failed to read base branch ${baseBranch}: ${base.status}`);
  const baseSha = (await base.json()).object.sha;

  const createRes = await fetch(`${API_BASE}/repos/${repoSlug()}/git/refs`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  if (!createRes.ok) {
    throw new Error(`GitHub ensureBranch: failed to create ${branch}: ${createRes.status} ${await createRes.text()}`);
  }
}
