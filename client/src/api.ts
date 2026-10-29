const configuredApiOrigin = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, '') ?? '';

/** Blank for local Vite proxying; set to the Render service origin in production. */
export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${configuredApiOrigin}${normalizedPath}`;
}

/** Send the server-side admin session cookie across the Vercel/Render origin boundary. */
export function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), { ...options, credentials: 'include' });
}
