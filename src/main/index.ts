
import usb from 'usb'
import { app, shell, BrowserWindow, session, ipcMain, IpcMainEvent, USBDevice } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { DEFAULT_CONFIG } from 'node-carplay/node'
import { Socket } from './Socket'
import * as fs from 'fs'
import { ExtraConfig, KeyBindings } from './Globals'

let mainWindow: BrowserWindow
const appPath = app.getPath('userData')
const configPath = `${appPath}/config.json`
let config: ExtraConfig
let socket: Socket

// Default bindings and config
type Bindings = Record<string, string>
const DEFAULT_BINDINGS: KeyBindings = {
  left: 'ArrowLeft', right: 'ArrowRight', selectDown: 'Space', back: 'Backspace',
  down: 'ArrowDown', home: 'KeyH', play: 'KeyP', pause: 'KeyO', next: 'KeyM', prev: 'KeyN'
}
const EXTRA_CONFIG: ExtraConfig = {
  ...DEFAULT_CONFIG,
  kiosk: true,
  camera: '',
  microphone: '',
  nightMode: true,
  bindings: DEFAULT_BINDINGS
}

// Initialize config
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify(EXTRA_CONFIG, null, 2))
}
config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
if (Object.keys(config).sort().join(',') !== Object.keys(EXTRA_CONFIG).sort().join(',')) {
  config = { ...EXTRA_CONFIG, ...config }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}
socket = new Socket(config, saveSettings)

// USB Reset function (no WebUSB)
async function forceUsbReset(): Promise<boolean> {
  const devices = usb.getDeviceList()
  console.log(`[USB DEBUG] ${devices.length} Geräte gefunden:`)
  devices.forEach(d => {
    const { idVendor, idProduct } = d.deviceDescriptor
    console.log(
      `  • Vendor: 0x${idVendor.toString(16).padStart(4,'0')} (${idVendor}), ` +
      `Product: 0x${idProduct.toString(16).padStart(4,'0')} (${idProduct})`
    )
  })

  const dongle = devices.find(d =>
    d.deviceDescriptor.idVendor  === 0x1314 &&
    [0x1520, 0x1521].includes(d.deviceDescriptor.idProduct)
  )
  if (!dongle) {
    console.warn('[USB] Kein CarPlay-Dongle gefunden für Hardware-Reset.')
    return false
  }

  try {
    dongle.open()
    await new Promise<void>((res, rej) =>
      dongle.reset(err => err ? rej(err) : res())
    )
    dongle.close()
    console.log('[USB] Hardware-Reset erfolgreich.')
    return true
  } catch (err) {
    console.error('[USB] Hardware-Reset fehlgeschlagen:', err)
    return false
  }
}

// USB handlers
const setupUsbHandlers = () => {
  ipcMain.handle('usb-request-device', async () => {
    const device = devices.find(d => d.vendorId === 4884 && [5408, 5409].includes(d.productId))
    if (!device) throw new Error('CarPlay device not found')
    mainWindow.webContents.send('usb-connect', device)
    return device
  })


  ipcMain.handle('usb-disconnect', async (_, deviceId: string) => {
    const device = devices.find(d => d.deviceId === deviceId)
    if (device) {
      await session.defaultSession.disconnectUSBDevice(device)
      console.log('[USB] device disconnected')
    }
  })

  ipcMain.handle('usb-connect', async (_, deviceId: string) => {
    const device = devices.find(d => d.deviceId === deviceId)
    if (device) {
      await session.defaultSession.connectUSBDevice(device)
      console.log('[USB] device reconnected')
      mainWindow.webContents.send('usb-connect', device)
      return true
    }
    return false
  })

  app.on('web-contents-created', (_, contents) => {
    contents.session.on('usb-device-added', (_, dev) => {
      if (dev.vendorId === 4884 && [5408, 5409].includes(dev.productId)) {
        mainWindow.webContents.send('usb-connect', dev)
      }
    })
    contents.session.on('usb-device-removed', (_, dev) => {
      if (dev.vendorId === 4884 && [5408, 5409].includes(dev.productId)) {
        mainWindow.webContents.send('usb-disconnect', dev)
      }
    })
  })
}

// Settings IPC handler
const handleSettingsReq = (_: IpcMainEvent) => {
  mainWindow.webContents.send('settings', config)
}

// Create main window
function createWindow(): void {
  mainWindow = new BrowserWindow({
  width: config.width,
  height: config.height,
  kiosk: false,
  useContentSize: true,
  frame: false,
  autoHideMenuBar: true,
  backgroundColor: '#000',
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    nodeIntegration: true,
    nodeIntegrationInWorker: true,
    contextIsolation: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  },
});

const ses = mainWindow.webContents.session;

// DEV: COEP/COOP/CRP headers
if (is.dev) {
  ses.webRequest.onHeadersReceived(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      if (details.url.includes('/audio.worklet.js')) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Cross-Origin-Embedder-Policy': ['require-corp'],
            'Cross-Origin-Opener-Policy': ['same-origin'],
            'Cross-Origin-Resource-Policy': ['same-site'],
          },
        });
      } else {
        callback({ responseHeaders: details.responseHeaders });
      }
    }
  );
}

// Permission handlers
  ses.setPermissionCheckHandler((wc, perm) => ['usb', 'hid', 'media', 'display-capture'].includes(perm))
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(['usb', 'hid', 'media', 'display-capture'].includes(perm)))
  ses.setDevicePermissionHandler(details => details.device.vendorId === 4884)
  ses.on('select-usb-device', (ev, details, cb) => {
    ev.preventDefault()
    const sel = details.deviceList.find(d => d.vendorId === 4884 && [5408, 5409].includes(d.productId))
    cb(sel?.deviceId)
  })
  ses.setUSBProtectedClassesHandler(({ protectedClasses }) =>
    protectedClasses.filter(c => ['audio', 'video', 'vendor-specific'].includes(c))
  )

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (config?.kiosk) mainWindow.setKiosk(true)
    if (is.dev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load renderer
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const handleRestartDongle = async (): Promise<boolean> => {
  try {
    const device = devices.find(d => d.vendorId === 4884 && [5408, 5409].includes(d.productId))
    if (!device) throw new Error('USB device not found')

    await session.defaultSession.disconnectUSBDevice(device)
    await new Promise(r => setTimeout(r, 500))
    await session.defaultSession.connectUSBDevice(device)
    mainWindow.webContents.send('usb-connect', device)
    console.log('[USB] Dongle hard-restarted')
    return true
  } catch (err) {
    console.error('[USB] Dongle restart failed:', err)
    return false
  }
}

// App lifecycle
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron.carplay')

  // Global Security Headers (fallback for all sessions)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy':   ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
        'Cross-Origin-Resource-Policy': ['same-site'],
      }
    })
  })

  // IPC handlers
  ipcMain.handle('usb-force-reset', () => forceUsbReset())
  ipcMain.handle('getSettings', handleSettingsReq)
  ipcMain.handle('save-settings', (_, settings) => saveSettings(settings))
  ipcMain.handle('restart-dongle', handleRestartDongle)
  ipcMain.handle('quit', quit)
  ipcMain.handle('usb-restart', async (_, deviceId: string) => {
    try {
      const device = devices.find(d => d.deviceId === deviceId)
      if (!device) throw new Error('USB device not found')
  
      await session.defaultSession.disconnectUSBDevice(device)
      await new Promise(r => setTimeout(r, 500))
      await session.defaultSession.connectUSBDevice(device)
      mainWindow.webContents.send('usb-connect', device)
      return true
    } catch (err) {
      console.error('[USB] Dongle restart failed:', err)
      return false
    }
  })

  setupUsbHandlers()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// Save settings
function saveSettings(settings: ExtraConfig) {
  fs.writeFileSync(configPath,
    JSON.stringify({
      ...settings,
      width: +settings.width,
      height: +settings.height,
      fps: +settings.fps,
      dpi: +settings.dpi,
      format: +settings.format,
      iBoxVersion: +settings.iBoxVersion,
      phoneWorkMode: +settings.phoneWorkMode,
      packetMax: +settings.packetMax,
      mediaDelay: +settings.mediaDelay,
    }, null, 2)
  )
}

// Quit
function quit() { app.quit() }
