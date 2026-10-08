import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("sqlc", {
  getConfig: (): Promise<{ origin: string; token: string }> => ipcRenderer.invoke("config"),
  keychain: {
    get: (id: string): Promise<string> => ipcRenderer.invoke("keychain:get", id),
    set: (id: string, password: string): Promise<void> => ipcRenderer.invoke("keychain:set", id, password),
    delete: (id: string): Promise<void> => ipcRenderer.invoke("keychain:delete", id),
  },
  saveFile: (filename: string, contents: string): Promise<void> => ipcRenderer.invoke("save-file", filename, contents),
});
