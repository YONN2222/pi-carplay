import usb from 'usb'
import usbDetect from 'usb-detection'
import { ipcMain, BrowserWindow } from 'electron'
import { CarplayService } from '../carplay/CarplayService'
import { findDongle } from './helpers'
import NodeMicrophone from '../carplay/node/NodeMicrophone'

export class USBService {
  private lastDongleState: boolean = false

  constructor(private carplay: CarplayService) {
    usbDetect.startMonitoring()
    this.registerIpcHandlers()
    this.listenToUsbEvents()

    usbDetect.find().then(devices => {
        const hotplugDevice = devices.find(this.isDongle)
        if (hotplugDevice) {
          console.log('[USBService] Dongle was already connected on startup', hotplugDevice)
          this.lastDongleState = true
          this.carplay.markDongleConnected(true)
          this.carplay.autoStartIfNeeded().catch(console.error)
          this.notifyDeviceChange(hotplugDevice, true)
        }
      })
      .catch(err => console.error('[USBService] usbDetect.find on startup failed →', err))
  }

  private listenToUsbEvents() {
    usbDetect.on('add', device => {
      this.broadcastGenericUsbEvent({ type: 'attach', device })
      if (this.isDongle(device) && !this.lastDongleState) {
        console.log('[USBService] Dongle connected:', device)
        this.lastDongleState = true
        this.carplay.markDongleConnected(true)
        this.carplay.autoStartIfNeeded().catch(console.error)
        this.notifyDeviceChange(device, true)
      }
    })

    usbDetect.on('remove', device => {
      this.broadcastGenericUsbEvent({ type: 'detach', device })
      if (this.isDongle(device) && this.lastDongleState) {
        console.log('[USBService] Dongle disconnected:', device)
        this.lastDongleState = false
        this.carplay.markDongleConnected(false)
        this.notifyDeviceChange(device, false)
      }
    })
  }

  private notifyDeviceChange(device: usbDetect.Device | usb.Device, connected: boolean): void {
    const vendorId = 'deviceDescriptor' in device
      ? device.deviceDescriptor.idVendor
      : device.vendorId!

    const productId = 'deviceDescriptor' in device
      ? device.deviceDescriptor.idProduct
      : device.productId!

    const deviceName = 'deviceName' in device
      ? device.deviceName || ''
      : ''

    const payload = {
      type: connected ? 'plugged' : 'unplugged',
      device: { vendorId, productId, deviceName }
    }

    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('usb-event', payload)
      win.webContents.send('carplay-event', payload)
    })
  }

  private broadcastGenericUsbEvent(event: { type: 'attach' | 'detach'; device: usbDetect.Device | usb.Device }) {
    const vendorId = 'deviceDescriptor' in event.device
      ? event.device.deviceDescriptor.idVendor
      : event.device.vendorId!

    const productId = 'deviceDescriptor' in event.device
      ? event.device.deviceDescriptor.idProduct
      : event.device.productId!

    const deviceName = 'deviceName' in event.device
      ? event.device.deviceName || ''
      : ''

    const payload = {
      type: event.type,
      device: { vendorId, productId, deviceName }
    }

    BrowserWindow.getAllWindows().forEach(win =>
      win.webContents.send('usb-event', payload)
    )
  }

  private registerIpcHandlers() {
    ipcMain.handle('usb-detect-dongle', async () => {
      const devices = await usbDetect.find()
      return devices.some(this.isDongle)
    })

    ipcMain.handle('carplay:usbDevice', async () => {
      const devices = await usbDetect.find()
      const detectDev = devices.find(this.isDongle)
      if (!detectDev) {
        return {
          device: false,
          vendorId: null,
          productId: null,
          deviceName: '',
          serialNumber: '',
          manufacturerName: '',
          productName: '',
          fwVersion: 'Unknown'
        }
      }
      return this.getDongleInfo(detectDev)
    })

    ipcMain.handle('usb-force-reset', () => this.forceReset())

    ipcMain.handle('usb-last-event', async () => {
      if (this.lastDongleState) {
        const devices = await usbDetect.find()
        const dev = devices.find(this.isDongle)
        if (dev) return { type: 'plugged', device: dev }
      }
      return { type: 'unplugged', device: null }
    })

    ipcMain.handle('get-sysdefault-mic-label', () => NodeMicrophone.getSysdefaultPrettyName())
  }

  private getDongleInfo(device: usbDetect.Device) {
    const usbDev = usb.getDeviceList().find(
      d => d.deviceDescriptor.idVendor === device.vendorId && d.deviceDescriptor.idProduct === device.productId
    )
    const fwVersion = usbDev && usbDev.deviceDescriptor.bcdDevice
      ? `${usbDev.deviceDescriptor.bcdDevice >> 8}.${(usbDev.deviceDescriptor.bcdDevice & 0xFF).toString().padStart(2, '0')}`
      : 'Unknown'

    return {
      device: true,
      vendorId: device.vendorId,
      productId: device.productId,
      serialNumber: (device as any).serialNumber || ' ',
      manufacturerName: device.manufacturer ? device.manufacturer.replace(/_/g, ' ') : ' ',
      productName: device.deviceName ? device.deviceName.replace(/_/g, ' ') : ' ',
      fwVersion,
    }
  }

  private isDongle(device: { vendorId?: number; productId?: number }) {
    return device.vendorId === 0x1314 && [0x1520, 0x1521].includes(device.productId ?? -1)
  }

  private notifyReset(type: 'usb-reset-start' | 'usb-reset-done', ok: boolean) {
    BrowserWindow.getAllWindows().forEach(win =>
      win.webContents.send(type, ok)
    )
  }

  private forceReset(): boolean {
    this.notifyReset('usb-reset-start', true)

    const dongle = findDongle()
    if (dongle) {
      this.lastDongleState = false
      this.broadcastGenericUsbEvent({ type: 'detach', device: dongle })
      this.notifyDeviceChange(dongle, false)
    }

    try {
      if (!dongle) {
        console.warn('[USB] Dongle not found')
        this.notifyReset('usb-reset-done', false)
        return false
      }

      dongle.open()
      dongle.reset(err => {
        if (err) {
          const msg = String(err.message ?? err)
          if (
            msg.includes('LIBUSB_ERROR_NOT_FOUND') ||
            msg.includes('LIBUSB_ERROR_NO_DEVICE') ||
            msg.includes('LIBUSB_TRANSFER_NO_DEVICE')
          ) {
            console.warn('[USB] reset triggered disconnect – treating as success')
            this.notifyReset('usb-reset-done', true)
          } else {
            console.error('[USB] reset error', err)
            this.notifyReset('usb-reset-done', false)
          }
        } else {
          console.log('[USB] reset ok')
          this.notifyReset('usb-reset-done', true)
        }
        try { dongle.close() } catch {}
      })


      return true
    } catch (e) {
      console.error('[USB] Exception during reset', e)
      this.notifyReset('usb-reset-done', false)
      return false
    }
  }
}
