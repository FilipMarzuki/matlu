/**
 * saveMap — POST a map JSON to the dev-only /__save-map endpoint (#1172).
 *
 * Shared by SettlementEditorScene and MapForgeScene's Export action so both
 * write through one code path: a hand-edited map ends up byte-for-byte the
 * same shape as a generated one (public/assets/maps/<id>.json).
 *
 * Dev only — the endpoint is registered by vite.config.ts's devSaveMapPlugin
 * and doesn't exist in a production build.
 */

interface SaveMapResponse {
  ok?: boolean;
  path?: string;
  error?: string;
}

/**
 * @returns the saved path (e.g. "/assets/maps/foo.json") on success, or
 * `null` on failure after showing an error toast.
 */
export async function saveMap(id: string, level: unknown): Promise<string | null> {
  try {
    const res = await fetch('/__save-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, level }),
    });
    const data = (await res.json()) as SaveMapResponse;
    if (!res.ok || !data.ok || !data.path) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data.path;
  } catch (err) {
    showSaveMapErrorToast(err instanceof Error ? err.message : String(err));
    return null;
  }
}

function showSaveMapErrorToast(message: string): void {
  const toast = document.createElement('div');
  toast.textContent = `Export failed: ${message}`;
  toast.style.cssText = [
    'position: fixed', 'bottom: 16px', 'left: 50%', 'transform: translateX(-50%)',
    'background: #3a1a1acc', 'color: #ff9090', 'border: 1px solid #772222',
    'border-radius: 4px', 'padding: 8px 14px', 'font-family: monospace', 'font-size: 12px',
    'z-index: 2000', 'pointer-events: none',
  ].join(';');
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
