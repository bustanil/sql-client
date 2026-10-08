/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
  readonly VITE_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    sqlc?: {
      getConfig: () => Promise<{ origin: string; token: string }>;
      keychain?: {
        get: (id: string) => Promise<string>;
        set: (id: string, password: string) => Promise<void>;
        delete: (id: string) => Promise<void>;
      };
    };
  }
}

export {};
