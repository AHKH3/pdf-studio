"use strict";
const { contextBridge, ipcRenderer } = require("electron");

/**
 * Deliberately narrow bridge. The renderer can ask the user where to put a file
 * and hand over bytes; it can never name a path the user did not pick, list a
 * directory, or read anything back.
 */
contextBridge.exposeInMainWorld("pdfStudioDesktop", {
  platform: process.platform,
  isDesktop: true,

  /** Keep native titlebar overlay + window background in sync with the theme. */
  setWindowChrome: (chrome) => ipcRenderer.invoke("window:set-chrome", chrome),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: () => ipcRenderer.invoke("window:close"),

  /**
   * @param {{ suggestedName: string; kind: "pdf" | "png" | "jpeg" | "zip" }} request
   * @param {ArrayBuffer} data
   * @returns {Promise<{ saved: boolean; name?: string }>}
   */
  saveFile: (request, data) => ipcRenderer.invoke("pdf-studio:save-file", request, data),

  /**
   * @param {{ suggestedName: string }} request
   * @param {Array<{ name: string; data: ArrayBuffer }>} files
   * @returns {Promise<{ saved: boolean; name?: string; count?: number }>}
   */
  saveFolder: (request, files) => ipcRenderer.invoke("pdf-studio:save-folder", request, files)
});
