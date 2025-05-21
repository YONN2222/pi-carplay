import { ipcMain, BrowserWindow } from 'electron'
import usbDetect from 'usb-detection'
import usb from 'usb'

export class USBService {
  private lastDongleState: boolean = false

  constructor() {
    usbDetect.startMonitoring()
    this.registerIpcHandlers()
    this.listenToUsbEvents()

    usbDetect.find().then(devices => {
      const dongle = devices.find(this.isDongle)
      if (dongle) {
        console.log('[USBService] Dongle was already connected on startup')
        this.lastDongleState = true
        this.notifyDeviceChange(dongle, true)
      }
    })
  }

  private listenToUsbEvents() {
    usbDetect.on('add', device => {
      if (this.isDongle(device)) {
        if (!this.lastDongleState) {
          console.log('[USBService] Dongle connected:', device)
          this.lastDongleState = true
          this.notifyDeviceChange(device, true)
        }
      }
    })

    usbDetect.on('remove', device => {
      if (this.isDongle(device)) {
        if (this.lastDongleState) {
          console.log('[USBService] Dongle disconnected:', device)
          this.lastDongleState = false
          this.notifyDeviceChange(device, false)
        }
      }
    })
  }

  private notifyDeviceChange(device: usbDetect.Device, connected: boolean) {
    const payload = {
      type: connected ? 'plugged' : 'unplugged',
      device: {
        vendorId: device.vendorId,
        productId: device.productId,
        deviceName: device.deviceName || '',
      }
    }

    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('usb-event', payload)
    })
  }

  private registerIpcHandlers() {
    ipcMain.handle('usb-detect-dongle', async () => {
      const devices = await usbDetect.find()
      return devices.some(this.isDongle)
    })

    ipcMain.handle('carplay:usbDevice', async () => {
      const devices = await usbDetect.find()
      const dongle = devices.find(this.isDongle)
      return dongle
        ? {
            device: true,
            vendorId: dongle.vendorId,
            productId: dongle.productId,
          }
        : { device: false, vendorId: null, productId: null }
    })

    ipcMain.handle('usb-force-reset', async () => {
      return this.forceReset()
    })

    ipcMain.handle('usb-last-event', async () => {
      if (this.lastDongleState) {
        const devices = await usbDetect.find()
        const dongle = devices.find(this.isDongle)
        if (dongle) {
          return {
            type: 'plugged',
            device: {
              vendorId: dongle.vendorId,
              productId: dongle.productId,
              deviceName: dongle.deviceName || '',
            }
          }
        }
      }
      return {
        type: 'unplugged',
        device: null,
      }
    })
  }

  private isDongle(device: { vendorId?: number; productId?: number }) {
    return device.vendorId === 0x1314 && [0x1520, 0x1521].includes(device.productId ?? -1)
  }

  private forceReset(): boolean {
    try {
      const device = usb.getDeviceList().find(
        d =>
          d.deviceDescriptor.idVendor === 0x1314 &&
          [0x1520, 0x1521].includes(d.deviceDescriptor.idProduct)
      )

      if (!device) {
        console.warn('[USBService] No dongle found for reset')
        return false
      }

      device.open()
      device.reset(error => {
        if (error) {
          console.error('[USBService] Failed to reset device:', error)
        } else {
          console.log('[USBService] Device reset successful')
        }
        device.close()
      })

      return true
    } catch (err) {
      console.error('[USBService] Exception during USB reset:', err)
      return false
    }
  }
}