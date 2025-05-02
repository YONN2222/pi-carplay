import { IpcRendererEvent, contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ExtraConfig } from '../main/Globals'

type ApiCallback<T = any> = (event: IpcRendererEvent, ...args: T[]) => void

interface USBDeviceExtended extends USBDevice {
  session?: string
}

export interface Api {
  // System APIs
  quit: () => Promise<void>
  restart: () => Promise<void>
  
  // Configuration
  settings: (callback: ApiCallback<ExtraConfig>) => void
  getSettings: () => Promise<ExtraConfig>
  saveSettings: (settings: ExtraConfig) => Promise<void>
  
  // USB Control
  usb: {
    forceReset:    () => Promise<boolean>
    requestDevice: () => Promise<USBDeviceExtended>
    getDevices: () => Promise<USBDeviceExtended[]>
    connect: (deviceId: string) => Promise<boolean>
    disconnect: (deviceId: string) => Promise<void>
    onConnect: (callback: ApiCallback<USBDeviceExtended>) => void
    onDisconnect: (callback: ApiCallback<USBDeviceExtended>) => void
  }
  
  // Audio Control
  audio: {
    requestAccess: () => Promise<boolean>
    getDevices: () => Promise<MediaDeviceInfo[]>
    startStream: (config?: AudioConfig) => Promise<MediaStream>
    stopStream: () => Promise<void>
    onDeviceChange: (callback: ApiCallback<MediaDeviceInfo[]>) => void
  }
  
  // CarPlay Specific
  reverse: (callback: ApiCallback<boolean>) => void
  stream: (stream: Stream) => Promise<void>
}

interface AudioConfig {
  sampleRate?: number
  channelCount?: number
  latency?: number
}

const api: Api = {
  // System APIs
  quit:        () => ipcRenderer.invoke('quit'),

  // Configuration
  settings:    (callback) => ipcRenderer.on('settings', callback),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings:(settings) => ipcRenderer.invoke('save-settings', settings),

  // USB Control
  usb: {
    forceReset:    () => ipcRenderer.invoke('usb-force-reset'),
    requestDevice: () => ipcRenderer.invoke('usb-request-device'),
    getDevices:    () => ipcRenderer.invoke('usb-get-devices'),
    connect:       (deviceId) => ipcRenderer.invoke('usb-connect', deviceId),
    disconnect:    (deviceId) => ipcRenderer.invoke('usb-disconnect', deviceId),
    restart:       (deviceId) => ipcRenderer.invoke('usb-restart', deviceId),
    onConnect:     (callback) => ipcRenderer.on('usb-connect', callback),
    onDisconnect:  (callback) => ipcRenderer.on('usb-disconnect', callback),
  },

  // Audio Control
  audio: {
    requestAccess:  () => ipcRenderer.invoke('audio-request-access'),
    getDevices:     () => ipcRenderer.invoke('audio-get-devices'),
    startStream:    (config) => ipcRenderer.invoke('audio-start-stream', config),
    stopStream:     () => ipcRenderer.invoke('audio-stop-stream'),
    onDeviceChange: (callback) => ipcRenderer.on('audio-devices-changed', callback),
  },

  // CarPlay
  reverse: (callback) => ipcRenderer.on('reverse-gear', callback),
  stream:  (stream)   => ipcRenderer.invoke('start-stream', stream),
}

// Security-check
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      ...electronAPI,
      api: Object.freeze(api)
    })
    contextBridge.exposeInMainWorld('carplay', {
      usb: api.usb,
      audio: api.audio,
      settings: {
        get: api.getSettings,
        save: api.saveSettings,
        onUpdate: api.settings
      }
    })
  } catch (error) {
    console.error('Failed to expose API via context bridge:', error)
  }
} else {
  console.warn('Context isolation is disabled! This is unsafe for production!')
  window.electron = { api }
  window.carplay = {
    usb: api.usb,
    audio: api.audio,
    settings: {
      get: api.getSettings,
      save: api.saveSettings,
      onUpdate: api.settings
    }
  }
}

declare global {
  interface Window {
    electron: {
      api: Api
    }
    carplay: Pick<Api, 'usb' | 'audio' | 'settings'>
  }
}
