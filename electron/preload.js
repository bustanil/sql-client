const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sqlc", {
  getConfig: () => ipcRenderer.invoke("config"),
});
