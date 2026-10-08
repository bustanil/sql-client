export type ClientConfig = { origin: string; token: string };

export async function loadConfig(): Promise<ClientConfig> {
  if (window.sqlc) return window.sqlc.getConfig();
  const origin = import.meta.env.VITE_API_ORIGIN;
  const token = import.meta.env.VITE_API_TOKEN;
  if (!origin || !token) {
    throw new Error("Start the app with npm run dev:ui or npm run dev.");
  }
  return { origin, token };
}

export async function api<T>(config: ClientConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.origin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error || res.statusText);
  return body as T;
}
