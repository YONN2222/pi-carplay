import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ExtraConfig } from '../main/Globals'

type ApiCallback<T = any> = (event: Electron.IpcRendererEvent, ...args: T[]) => void

const api = {
  quit: () => ipcRenderer.invoke('quit'),

  // Settings
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings: ExtraConfig) => ipcRenderer.invoke('save-settings', settings),
  onSettingsUpdate: (callback: ApiCallback<ExtraConfig>) => ipcRenderer.on('settings', callback),

  // USB (forceReset)
  forceReset: () => ipcRenderer.invoke('usb-force-reset'),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      ...electronAPI,
      api: {
        quit: api.quit,
        settings: {
          get: api.getSettings,
          save: api.saveSettings,
          onUpdate: api.onSettingsUpdate,
        },
        usb: {
          forceReset: api.forceReset,
        },
      },
    })

    contextBridge.exposeInMainWorld('carplay', {
      usb: {
        forceReset: api.forceReset,
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
  window.electron = {
    api: {
      quit: api.quit,
      settings: {
        get: api.getSettings,
        save: api.saveSettings,
        onUpdate: api.onSettingsUpdate,
      },
      usb: {
        forceReset: api.forceReset,
      },
    },
  }

  window.carplay = {
    usb: {
      forceReset: api.forceReset,
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
    electron: {
      api: {
        quit: () => Promise<void>
        settings: {
          get: () => Promise<ExtraConfig>
          save: (settings: ExtraConfig) => Promise<void>
          onUpdate: (callback: ApiCallback<ExtraConfig>) => void
        }
        usb: {
          forceReset: () => Promise<boolean>
        }
      }
    }
    carplay: {
      usb: {
        forceReset: () => Promise<boolean>
      }
      settings: {
        get: () => Promise<ExtraConfig>
        save: (settings: ExtraConfig) => Promise<void>
        onUpdate: (callback: ApiCallback<ExtraConfig>) => void
      }
    }
  }
}
