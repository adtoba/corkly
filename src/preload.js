'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const modeArg = process.argv.find((a) => a.startsWith('--corkly-mode='));

contextBridge.exposeInMainWorld('corkly', {
  platform: process.platform,
  mode: modeArg ? modeArg.split('=')[1] : 'window',
  info: () => ipcRenderer.invoke('app:info'),
  load: () => ipcRenderer.invoke('data:load'),
  save: (json) => ipcRenderer.invoke('data:save', json),
  saveSync: (json) => ipcRenderer.sendSync('data:save-sync', json),
  pickImages: () => ipcRenderer.invoke('image:pick'),
  importImage: (file) => ipcRenderer.invoke('image:import', webUtils.getPathForFile(file)),
  imageFromBuffer: (buf, ext) => ipcRenderer.invoke('image:buffer', buf, ext),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  exportPng: (name) => ipcRenderer.invoke('board:export', name),

  // desktop widget + settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setMode: (mode) => ipcRenderer.invoke('window:mode', mode),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  openTip: () => ipcRenderer.invoke('tip:open'),
  readImage: (file) => ipcRenderer.invoke('image:read', file),
  showWindow: () => ipcRenderer.invoke('window:show'),
  pendingJoin: () => ipcRenderer.invoke('cloud:pending-join'),
  onJoinLink: (cb) => ipcRenderer.on('cloud:join', (_e, code) => cb(code)),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
  setClean: (clean) => ipcRenderer.invoke('window:clean', clean),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  onOpenSettings: (cb) => ipcRenderer.on('ui:open-settings', () => cb()),
});
