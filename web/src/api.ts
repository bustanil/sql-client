export type ClientConfig = { origin: string; token: string };

export type FieldError = {
  kind: string;
  row: number;
  column?: string;
  message: string;
};

export type ApiErrorBody = { error?: string; errors?: FieldError[] } | null;

export class RequestError extends Error {
  status: number;
  body: ApiErrorBody;

  constructor(message: string, status: number, body: ApiErrorBody) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.body = body;
  }
}

export async function loadConfig(): Promise<ClientConfig> {
  if (window.sqlc) return window.sqlc.getConfig();
  const token = import.meta.env.VITE_API_TOKEN;
  if (!token) {
    throw new Error("Start the app with npm run dev:ui or npm run dev.");
  }
  return { origin: import.meta.env.VITE_API_ORIGIN || "", token };
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
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!res.ok) {
    const parsed = (body || null) as ApiErrorBody;
    throw new RequestError(parsed?.error || res.statusText, res.status, parsed);
  }
  return body as T;
}
