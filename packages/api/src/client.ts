import type { ApiResponse } from './endpoints';

export async function apiFetch<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }

  return payload.data;
}
