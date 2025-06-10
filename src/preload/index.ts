import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { ExtraConfig } from '../main/Globals';

// Typ for Callback function (Events)
export type ApiCallback<T = any> = (event: IpcRendererEvent, ...args: T[]) => void;

// USB-Event-Handling with Queue
let usbEventQueue: [IpcRendererEvent, ...any[]][] = [];
let usbEventHandler: ApiCallback<any> | null = null;

ipcRenderer.on('usb-event', (event, ...args) => {
  if (usbEventHandler) {
    usbEventHandler(event, ...args);
  } else {
    usbEventQueue.push([event, ...args]);
  }
});

// VIDEO/AUDIO Chunk-Handling with Queue
type ChunkHandler = (payload: any) => void;

let videoChunkQueue: any[] = [];
let videoChunkHandler: ChunkHandler | null = null;

let audioChunkQueue: any[] = [];
let audioChunkHandler: ChunkHandler | null = null;

ipcRenderer.on('carplay-video-chunk', (_event, payload) => {
  if (videoChunkHandler) {
    videoChunkHandler(payload);
  } else {
    videoChunkQueue.push(payload);
    console.log('[PRELOAD] Video chunk queued (no handler set)');
  }
});

ipcRenderer.on('carplay-audio-chunk', (_event, payload) => {
  if (audioChunkHandler) {
    audioChunkHandler(payload);
  } else {
    audioChunkQueue.push(payload);
    console.log('[PRELOAD] Audio chunk queued (no handler set)');
  }
});


// API for window.carplay
const api = {
  quit: () => ipcRenderer.invoke('quit'),

  onUSBResetStatus: (callback: ApiCallback<any>) => {
      ipcRenderer.on('usb-reset-start', callback);
      ipcRenderer.on('usb-reset-done', callback);
    },

  // USB
  usb: {
    forceReset: () => ipcRenderer.invoke('usb-force-reset'),
    detectDongle: () => ipcRenderer.invoke('usb-detect-dongle'),
    getDeviceInfo: () => ipcRenderer.invoke('carplay:usbDevice'),
    getLastEvent: () => ipcRenderer.invoke('usb-last-event'),
    getSysdefaultPrettyName: () => ipcRenderer.invoke('get-sysdefault-mic-label'),
    listenForEvents: (callback: ApiCallback<any>) => {
      usbEventHandler = callback;
      usbEventQueue.forEach(([evt, ...args]) => callback(evt, ...args));
      usbEventQueue = [];
    }
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('getSettings'),
    save: (settings: ExtraConfig) => ipcRenderer.invoke('save-settings', settings),
    onUpdate: (callback: ApiCallback<ExtraConfig>) => ipcRenderer.on('settings', callback),
  },

  // CarPlay-IPC
  ipc: {
    start: () => ipcRenderer.invoke('carplay-start'),
    stop: () => ipcRenderer.invoke('carplay-stop'),
    sendFrame: () => ipcRenderer.invoke('carplay-sendframe'),
    sendTouch: (x: number, y: number, action: number) =>
      ipcRenderer.send('carplay-touch', { x, y, action }),
    sendKeyCommand: (key: string) => ipcRenderer.send('carplay-key-command', key),
    onEvent: (callback: ApiCallback<any>) => ipcRenderer.on('carplay-event', callback),

    onVideoChunk: (handler: ChunkHandler) => {
      videoChunkHandler = handler;
      videoChunkQueue.forEach(chunk => {
        handler(chunk);
      });
      videoChunkQueue = [];
    },
    onAudioChunk: (handler: ChunkHandler) => {
      audioChunkHandler = handler;
      audioChunkQueue.forEach(chunk => {
        handler(chunk);
      });
      audioChunkQueue = [];
    },
  },
};

contextBridge.exposeInMainWorld('carplay', api);

declare global {
  interface Window {
    carplay: typeof api;
  }
}
