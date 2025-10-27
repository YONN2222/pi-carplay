import EventEmitter from 'events'
import { MessageHeader, HeaderBuildError } from './messages/common.js'
import { PhoneType } from './messages/readable.js'
import {
  SendableMessage,
  SendNumber,
  FileAddress,
  SendOpen,
  SendBoolean,
  SendString,
  SendBoxSettings,
  SendCommand,
  HeartBeat
} from './messages/sendable.js'

const CONFIG_NUMBER = 1
const MAX_ERROR_COUNT = 5

export enum HandDriveType {
  LHD = 0,
  RHD = 1
}

export type PhoneTypeConfig = { frameInterval: number | null }
type PhoneTypeConfigMap = { [K in PhoneType]: PhoneTypeConfig }

export type DongleConfig = {
  androidWorkMode?: boolean
  width: number
  height: number
  fps: number
  dpi: number
  format: number
  iBoxVersion: number
  packetMax: number
  phoneWorkMode: number
  nightMode: boolean
  boxName: string
  hand: HandDriveType
  mediaDelay: number
  audioTransferMode: boolean
  wifiType: '2.4ghz' | '5ghz'
  wifiChannel: number
  micType: 'box' | 'os'
  phoneConfig: Partial<PhoneTypeConfigMap>
}

export const DEFAULT_CONFIG: DongleConfig = {
  width: 800,
  height: 480,
  fps: 60,
  dpi: 140,
  format: 5,
  iBoxVersion: 2,
  phoneWorkMode: 2,
  packetMax: 49152,
  boxName: 'nodePlay',
  nightMode: true,
  hand: HandDriveType.LHD,
  mediaDelay: 1000,
  audioTransferMode: false,
  wifiType: '5ghz',
  wifiChannel: 36,
  micType: 'os',
  phoneConfig: {
    [PhoneType.CarPlay]: { frameInterval: 5000 },
    [PhoneType.AndroidAuto]: { frameInterval: null }
  }
}

export class DriverStateError extends Error { }

export class DongleDriver extends EventEmitter {
  private _heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private _device: USBDevice | null = null
  private _inEP: USBEndpoint | null = null
  private _outEP: USBEndpoint | null = null
  private _ifaceNumber: number | null = null
  private errorCount = 0
  private _closing = false
  private _started = false
  private _readerActive = false

  static knownDevices = [
    { vendorId: 0x1314, productId: 0x1520 },
    { vendorId: 0x1314, productId: 0x1521 }
  ]

  private sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)) }
  private async waitForReaderStop(timeoutMs = 500) {
    const t0 = Date.now()
    while (this._readerActive && Date.now() - t0 < timeoutMs) await this.sleep(10)
  }

  initialise = async (device: USBDevice) => {
    if (this._device) return

    try {
      this._device = device
      if (!device.opened) throw new DriverStateError('Device not opened')

      await device.selectConfiguration(CONFIG_NUMBER)
      const cfg = device.configuration
      if (!cfg) throw new DriverStateError('Device has no configuration')

      const intf = cfg.interfaces[0]
      if (!intf) throw new DriverStateError('No interface 0')

      this._ifaceNumber = intf.interfaceNumber
      await device.claimInterface(this._ifaceNumber)

      const alt = intf.alternate
      if (!alt) throw new DriverStateError('No active alternate on interface')

      this._inEP = alt.endpoints.find((e) => e.direction === 'in') || null
      this._outEP = alt.endpoints.find((e) => e.direction === 'out') || null
      if (!this._inEP || !this._outEP) throw new DriverStateError('Endpoints missing')
    } catch (err) {
      await this.close()
      throw err
    }
  }

  send = async (msg: SendableMessage): Promise<boolean> => {
    const dev = this._device
    if (!dev || !dev.opened || this._closing) return false

    try {
      const buf = msg.serialise()
      const view = new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength)
      const res = await dev.transferOut(this._outEP!.endpointNumber, view)
      return res.status === 'ok'
    } catch (err) {
      console.error('[DongleDriver] Send error', msg?.constructor?.name, err)
      return false
    }
  }

  private async readLoop() {
    if (this._readerActive) return
    this._readerActive = true

    while (this._device?.opened && !this._closing) {
      if (this.errorCount >= MAX_ERROR_COUNT) {
        await this.close()
        this.emit('failure')
        return
      }

      try {
        const headerRes = await this._device.transferIn(this._inEP!.endpointNumber, MessageHeader.dataLength)
        if (this._closing) break
        const headerBuf = headerRes?.data?.buffer
        if (!headerBuf) throw new HeaderBuildError('Empty header')

        const header = MessageHeader.fromBuffer(Buffer.from(headerBuf))
        let extra: Buffer | undefined
        if (header.length) {
          const extraRes = await this._device.transferIn(this._inEP!.endpointNumber, header.length)
          if (this._closing) break
          const extraBuf = extraRes?.data?.buffer
          if (!extraBuf) throw new Error('Failed to read extra data')
          extra = Buffer.from(extraBuf)
        }

        const msg = header.toMessage(extra)
        if (msg) {
          this.emit('message', msg)
          if (this.errorCount !== 0) this.errorCount = 0
        }
      } catch (err) {
        if (this._closing) break
        console.error('[DongleDriver] readLoop error', err)
        this.errorCount++
      }
    }

    this._readerActive = false
  }

  start = async (cfg: DongleConfig) => {
    if (!this._device) throw new DriverStateError('initialise() first')
    if (!this._device.opened) return
    if (this._started) return

    this.errorCount = 0
    this._started = true

    if (!this._readerActive) void this.readLoop()

    const messages: SendableMessage[] = [
      new SendNumber(cfg.dpi, FileAddress.DPI),
      new SendOpen(cfg),
      new SendBoolean(cfg.nightMode, FileAddress.NIGHT_MODE),
      new SendNumber(cfg.hand, FileAddress.HAND_DRIVE_MODE),
      new SendBoolean(true, FileAddress.CHARGE_MODE),
      new SendString(cfg.boxName, FileAddress.BOX_NAME),
      new SendCommand(cfg.wifiType === '5ghz' ? 'wifi5g' : 'wifi24g'),
      new SendBoxSettings(cfg),
      new SendCommand('wifiEnable'),
      new SendCommand(cfg.micType === 'box' ? 'boxMic' : 'mic'),
      new SendCommand(cfg.audioTransferMode ? 'audioTransferOn' : 'audioTransferOff')
    ]
    if (cfg.androidWorkMode)
      messages.push(new SendBoolean(cfg.androidWorkMode, FileAddress.ANDROID_WORK_MODE))

    for (const m of messages) {
      await this.send(m)
      await this.sleep(120)
    }

    setTimeout(() => void this.send(new SendCommand('wifiConnect')), 600)

    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval)
    this._heartbeatInterval = setInterval(() => void this.send(new HeartBeat()), 2000)
  }

  close = async () => {
    if (!this._device && !this._readerActive && !this._started) return

    this._closing = true
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval)
      this._heartbeatInterval = null
    }

    try {
      if (this._device && this._device.opened) {
        await this.waitForReaderStop(400)

        if (this._ifaceNumber != null) {
          try { await this._device.releaseInterface(this._ifaceNumber) } catch (e) {
            console.warn('releaseInterface() failed', e)
          }
        }

        try {
          await this._device.close()
        } catch (e: any) {
          const msg = String(e?.message || e)
          if (/pending request/i.test(msg)) {
            console.warn('device.close(): pending request -> ignoring for shutdown')
          } else {
            console.warn('device.close() failed', e)
          }
        }
      }
    } catch (err) {
      console.warn('close() outer error', err)
    }

    this._device = null
    this._inEP = null
    this._outEP = null
    this._ifaceNumber = null
    this._started = false
    this._readerActive = false
    this._closing = false
  }
}
