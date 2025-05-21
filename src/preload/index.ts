import { contextBridge, ipcRenderer } from 'electron'
import { ExtraConfig } from '../main/Globals'

type ApiCallback<T = any> = (event: Electron.IpcRendererEvent, ...args: T[]) => void

let usbEventQueue: [Electron.IpcRendererEvent, ...any[]][] = []
let usbEventHandler: ApiCallback<any> | null = null

ipcRenderer.on('usb-event', (event, ...args) => {
  if (usbEventHandler) {
    usbEventHandler(event, ...args)
  } else {
    usbEventQueue.push([event, ...args])
  }
})

const api = {
  quit: () => ipcRenderer.invoke('quit'),

  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings: ExtraConfig) => ipcRenderer.invoke('save-settings', settings),
  onSettingsUpdate: (callback: ApiCallback<ExtraConfig>) => ipcRenderer.on('settings', callback),

  forceReset: () => ipcRenderer.invoke('usb-force-reset'),
  detectDongle: () => ipcRenderer.invoke('usb-detect-dongle'),
  getUsbDeviceInfo: () => ipcRenderer.invoke('carplay:usbDevice'),
  getLastEvent: (): Promise<{ type: 'plugged' | 'unplugged'; device: any } | null> =>
    ipcRenderer.invoke('usb-last-event'),

  listenForUsbEvents: (callback: ApiCallback<any>) => {
    usbEventHandler = callback
    for (const [event, ...args] of usbEventQueue) {
      callback(event, ...args)
    }
    usbEventQueue = []
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('carplay', {
      quit: api.quit,
      usb: {
        forceReset: api.forceReset,
        detectDongle: api.detectDongle,
        getDeviceInfo: api.getUsbDeviceInfo,
        getLastEvent: api.getLastEvent,
        listenForEvents: api.listenForUsbEvents,
      },
      settings: {
        get: api.getSettings,
        save: api.saveSettings,
        onUpdate: api.onSettingsUpdate,
      },
    })
  } catch (error) {
    console.error('Failed to expose API via context bridge:', error)
  }
} else {
  console.warn('Context isolation is disabled! This is unsafe for production!')

  window.carplay = {
    quit: api.quit,
    usb: {
      forceReset: api.forceReset,
      detectDongle: api.detectDongle,
      getDeviceInfo: api.getUsbDeviceInfo,
      getLastEvent: api.getLastEvent,
      listenForEvents: api.listenForUsbEvents,
    },
    settings: {
      get: api.getSettings,
      save: api.saveSettings,
      onUpdate: api.onSettingsUpdate,
    },
  }
}

declare global {
  interface Window {
    carplay: {
      quit: () => Promise<void>
      usb: {
        forceReset: () => Promise<boolean>
        detectDongle: () => Promise<boolean>
        getDeviceInfo: () => Promise<{
          device: boolean
          vendorId: number | null
          productId: number | null
        }>
        listenForEvents: (callback: ApiCallback<any>) => void
        getLastEvent: () => Promise<{ type: 'plugged' | 'unplugged'; device: any } | null>
      }
      settings: {
        get: () => Promise<ExtraConfig>
        save: (settings: ExtraConfig) => Promise<void>
        onUpdate: (callback: ApiCallback<ExtraConfig>) => void
      }
    }
  }
}
