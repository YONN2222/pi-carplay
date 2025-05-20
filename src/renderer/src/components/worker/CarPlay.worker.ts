import CarplayWeb, {
  CarplayMessage,
  DongleConfig,
  SendAudio,
  SendCommand,
  SendTouch,
  findDevice,
  decodeTypeMap,
} from '@carplay/web'
import { AudioPlayerKey } from './types'
import type { KeyCommand } from './types'
import { RenderEvent } from './render/RenderEvents'
import { RingBuffer } from 'ringbuf.js'
import { createAudioPlayerKey } from './utils'

let carplayWeb: CarplayWeb | null = null
let videoPort: MessagePort | null = null
let microphonePort: MessagePort | null = null
let config: Partial<DongleConfig>
let audioInfoSent = false
let starting = false
let coldstartHandled = false
let firstFrameLogged = false
let firstResolutionLogged = false
let coldstartTimerStarted = false

const audioBuffers: Record<AudioPlayerKey, RingBuffer<Int16Array>> = {}
const pendingAudio: Record<AudioPlayerKey, Int16Array[]> = {}

function handleMessage(message: CarplayMessage) {
  const { type, message: payload } = message

  if (type === 'video' && videoPort) {
    if (!firstFrameLogged) {
      try {
        console.timeLog('coldstart', '[Worker] First video frame')
      } catch {}
      firstFrameLogged = true
    }

    if (payload.width && payload.height && !firstResolutionLogged) {
      firstResolutionLogged = true
      console.log('[Worker] Sending resolution from video payload:', payload.width, payload.height)
    }

    if (payload.width && payload.height) {
      self.postMessage({
        type: 'resolution',
        payload: { width: payload.width, height: payload.height },
      })
    } else {
      console.warn('[Worker] Video payload does not contain resolution info')
    }

    const view = payload.data instanceof Buffer
      ? new Uint8Array(payload.data)
      : new Uint8Array(payload.data.buffer as ArrayBuffer, payload.data.byteOffset, payload.data.byteLength)
    const dataBuffer = view.buffer

    videoPort.postMessage(new RenderEvent(dataBuffer), [dataBuffer])

  } else if (type === 'audio' && payload.data) {
    const { decodeType, audioType } = payload
    const key = createAudioPlayerKey(decodeType, audioType)

    const meta = decodeTypeMap[decodeType]
    if (meta && !audioInfoSent) {
      audioInfoSent = true
      self.postMessage({
        type: 'audioInfo',
        payload: {
          codec: meta.format ?? meta.mimeType ?? `type ${decodeType}`,
          sampleRate: meta.frequency,
          channels: meta.channel,
          bitDepth: meta.bitDepth,
        },
      })
    } else if (!meta) {
      console.warn(`[Worker] Unknown decodeType: ${decodeType} – expected one of ${Object.keys(decodeTypeMap).join(', ')}`)
    }

    if (audioBuffers[key]) {
      audioBuffers[key].push(payload.data)
    } else {
      pendingAudio[key] = pendingAudio[key] || []
      pendingAudio[key].push(payload.data)
      self.postMessage({ type: 'requestBuffer', message: { decodeType, audioType } })
    }

    const int16 = payload.data
    const channels = Math.max(1, meta?.channel ?? 2)
    const frames = Math.floor(int16.length / channels)
    const f32 = new Float32Array(frames)

    for (let i = 0; i < frames; i++) {
      let sum = 0
      for (let ch = 0; ch < channels; ch++) {
        sum += int16[i * channels + ch] || 0
      }
      f32[i] = (sum / channels) / 32768
    }

    self.postMessage({ type: 'pcmData', payload: f32.buffer }, [f32.buffer])

  } else {
    self.postMessage(message)
  }
}

onmessage = async (ev: MessageEvent<any>) => {
  const data = ev.data as {
    type: string
    payload?: { command?: unknown; [key: string]: any }
    command?: unknown
    [key: string]: any
  }

  const { type, payload = {} } = data
  const cmd = (payload.command as KeyCommand | undefined) ?? (data.command as KeyCommand | undefined)

  switch (type) {
    case 'initialise':
      videoPort = payload.videoPort as MessagePort
      microphonePort = payload.microphonePort as MessagePort
      try {
        if (microphonePort) {
          microphonePort.onmessage = me => {
            if (carplayWeb) {
              const msg = new SendAudio(me.data)
              carplayWeb.dongleDriver.send(msg)
            }
          }
        }
      } catch (err) {
        console.warn('[Worker] Failed to set microphonePort.onmessage:', err)
      }
      console.log('[Worker] Initialised ports')

      if (!coldstartHandled) {
        coldstartHandled = true
        postMessage({ type: 'autoStartAfterInit' })
      }
      break

    case 'audioPlayer': {
      const { sab, decodeType, audioType } = payload as {
        sab: SharedArrayBuffer
        decodeType: number
        audioType: number
      }
      const key = createAudioPlayerKey(decodeType, audioType)
      audioBuffers[key] = new RingBuffer(sab, Int16Array)
      const pend = pendingAudio[key] || []
      pend.forEach(buf => audioBuffers[key].push(buf))
      delete pendingAudio[key]
      break
    }

    case 'start':
      if (starting) {
        console.warn('[Worker] Ignoring duplicate start request')
        return
      }
      starting = true

      try {
        if (!coldstartTimerStarted) {
          coldstartTimerStarted = true
          console.time('coldstart')
        }
        try {
          console.timeLog('coldstart', '[Worker] Starting CarplayWeb')
        } catch {}

        if (carplayWeb) {
          await carplayWeb.stop()
          carplayWeb = null
        }

        config = (payload as { config: DongleConfig }).config
        const device = await findDevice()
        try {
          console.timeLog('coldstart', '[Worker] Device detected')
        } catch {}

        if (device) {
          const instance = new CarplayWeb(config)
          instance.onmessage = handleMessage
          await instance.start(device)
          carplayWeb = instance
          try {
            console.timeLog('coldstart', '[Worker] CarplayWeb started')
          } catch {}

          const dongle = device as any
          self.postMessage({
            type: 'dongleInfo',
            payload: {
              serial: dongle.serialNumber ?? 'unknown',
              manufacturer: dongle.manufacturerName ?? 'unknown',
              product: dongle.productName ?? 'unknown',
              fwVersion: `${dongle.deviceVersionMajor}.${dongle.deviceVersionMinor}`,
            },
          })
        } else {
          console.warn('[Worker] No device found')
        }
      } catch (err) {
        console.error('[Worker] Error during start:', err)
        carplayWeb = null
      } finally {
        starting = false
      }
      break

    case 'touch':
      if (carplayWeb) {
        const { x, y, action } = payload as { x: number; y: number; action: number }
        carplayWeb.dongleDriver.send(new SendTouch(x, y, action))
      }
      break

    case 'stop':
      console.log('[Worker] Stopping CarplayWeb')
      await carplayWeb?.stop()
      carplayWeb = null
      audioInfoSent = false
      firstFrameLogged = false
      firstResolutionLogged = false
      break

    case 'frame':
      if (carplayWeb) {
        carplayWeb.dongleDriver.send(new SendCommand('frame'))
      }
      break

    case 'keyCommand':
      if (!carplayWeb) break
      if (!cmd) {
        console.warn('[Worker] keyCommand ohne command:', data)
        break
      }
      carplayWeb.dongleDriver.send(new SendCommand(cmd))
      break
  }
}

export {}