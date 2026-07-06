/** Minimal typed API client with automatic access-token refresh. */

export interface ApiError {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public error: ApiError
  ) {
    super(error.message);
  }
}

const BASE = '/api/v1';

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');
let onSessionExpired: (() => void) | null = null;

export function setTokens(access: string | null, refresh: string | null): void {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem('accessToken', access);
  else localStorage.removeItem('accessToken');
  if (refresh) localStorage.setItem('refreshToken', refresh);
  else localStorage.removeItem('refreshToken');
}

export const hasSession = (): boolean => !!refreshToken;

export function setSessionExpiredHandler(fn: () => void): void {
  onSessionExpired = fn;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const json = await res.json();
      setTokens(json.accessToken, json.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { retry?: boolean; raw?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });

  if (res.status === 401 && opts.retry !== false) {
    if (await tryRefresh()) return api<T>(method, path, body, { ...opts, retry: false });
    setTokens(null, null);
    onSessionExpired?.();
    throw new ApiRequestError(401, { code: 'UNAUTHORIZED', message: 'Session expired' });
  }
  if (!res.ok) {
    let error: ApiError = { code: 'INTERNAL', message: `Request failed (${res.status})` };
    try {
      error = (await res.json()).error ?? error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(res.status, error);
  }
  if (opts.raw) return (await res.text()) as T;
  return res.json() as Promise<T>;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body?: unknown) => api<T>('POST', path, body);
export const patch = <T,>(path: string, body?: unknown) => api<T>('PATCH', path, body);
export const del = <T,>(path: string) => api<T>('DELETE', path);
