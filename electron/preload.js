const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sqlc", {
  getConfig: () => ipcRenderer.invoke("config"),
  keychain: {
    get: (id) => ipcRenderer.invoke("keychain:get", id),
    set: (id, password) => ipcRenderer.invoke("keychain:set", id, password),
    delete: (id) => ipcRenderer.invoke("keychain:delete", id),
  },
  saveFile: (filename, contents) => ipcRenderer.invoke("save-file", filename, contents),
});
