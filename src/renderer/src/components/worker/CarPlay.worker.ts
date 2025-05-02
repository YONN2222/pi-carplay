import CarplayWeb, {
  CarplayMessage,
  DongleConfig,
  SendAudio,
  SendCommand,
  SendTouch,
  findDevice,
  decodeTypeMap,
} from 'node-carplay/web';
import { AudioPlayerKey, Command, KeyCommand } from './types';
import { RenderEvent } from './render/RenderEvents';
import { RingBuffer } from 'ringbuf.js';
import { createAudioPlayerKey } from './utils';

let carplayWeb: CarplayWeb | null = null;
let videoPort: MessagePort | null = null;
let microphonePort: MessagePort | null = null;
let config: Partial<DongleConfig> | null = null;
let audioInfoSent = false;

// Buffers for each audio stream
const audioBuffers: Record<AudioPlayerKey, RingBuffer<Int16Array>> = {};
const pendingAudio: Record<AudioPlayerKey, Int16Array[]> = {};

const handleMessage = (message: CarplayMessage) => {
  const { type, message: payload } = message;

  if (type === 'video' && videoPort) {
    videoPort.postMessage(new RenderEvent(payload.data), [payload.data.buffer]);

  } else if (type === 'audio' && payload.data) {
    const { decodeType, audioType } = payload;
    const audioKey = createAudioPlayerKey(decodeType, audioType);

    // once, send out the negotiated audio metadata
    const meta = decodeTypeMap[decodeType];
    if (meta && !audioInfoSent) {
      audioInfoSent = true;
      const codecStr = meta.format ?? meta.mimeType ?? `type ${decodeType}`;
      self.postMessage({
        type: 'audioInfo',
        payload: {
          codec:      codecStr,
          sampleRate: meta.frequency,
          channels:   meta.channel,
          bitDepth:   meta.bitDepth,
        }
      });
    }

    // push raw Int16 PCM into RingBuffer
    if (audioBuffers[audioKey]) {
      audioBuffers[audioKey].push(payload.data);
    } else {
      if (!pendingAudio[audioKey]) pendingAudio[audioKey] = [];
      pendingAudio[audioKey].push(payload.data);
      payload.data = undefined;
      self.postMessage({ type: 'getAudioPlayer', message: { ...payload } });
    }

    // downmix
    {
      const buffer = payload.data instanceof ArrayBuffer ? payload.data : payload.data.buffer;
      const int16 = new Int16Array(buffer);

      const numFrames = Math.floor(int16.length / 2);
      const float32 = new Float32Array(numFrames);

      for (let i = 0; i < numFrames; i++) {
        const left = int16[i * 2];
        const right = int16[i * 2 + 1];   
        const mono = (left + right) / 2;
        float32[i] = mono / 32768.0; 
      }

      // Send to main thread
      self.postMessage({
        type: 'pcmData',
        payload: float32.buffer,
      }, [float32.buffer]);
    }

  } else {
    self.postMessage(message);
  }
};

onmessage = async (event: MessageEvent<Command>) => {
  switch (event.data.type) {
    case 'initialise':
      if (carplayWeb) return;
      videoPort = event.data.payload.videoPort;
      microphonePort = event.data.payload.microphonePort;
      microphonePort.onmessage = ev => {
        if (carplayWeb) {
          const data = new SendAudio(ev.data);
          carplayWeb.dongleDriver.send(data);
        }
      };
      break;

    case 'audioPlayer': {
      const { sab, decodeType, audioType } = event.data.payload;
      const audioKey = createAudioPlayerKey(decodeType, audioType);
      audioBuffers[audioKey] = new RingBuffer(sab, Int16Array);
      if (pendingAudio[audioKey]) {
        pendingAudio[audioKey].forEach(buf => audioBuffers[audioKey].push(buf));
        pendingAudio[audioKey] = [];
      }
      break;
    }

    case 'start':
      if (carplayWeb) return;
        config = event.data.payload.config;
        const device = await findDevice();
        if (device) {
          carplayWeb = new CarplayWeb(config);
          carplayWeb.onmessage = handleMessage;
          await carplayWeb.start(device);

          const dongle = device as USBDevice;
          self.postMessage({
            type: 'dongleInfo',
            payload: {
              serial:       dongle.serialNumber     ?? 'unknown',
              manufacturer: dongle.manufacturerName ?? 'unknown',
              product:      dongle.productName      ?? 'unknown',
              fwVersion:    `${dongle.deviceVersionMajor}.${dongle.deviceVersionMinor}`
           }
         });    
       }
     break;

    case 'touch': {
      if (config && carplayWeb) {
        const { x, y, action } = event.data.payload;
        const data = new SendTouch(x, y, action);
        carplayWeb.dongleDriver.send(data);
      }
      break;
    }

    case 'stop':
      await carplayWeb?.stop();
      carplayWeb = null;
      break;

    case 'frame':
      if (carplayWeb) {
        const data = new SendCommand('frame');
        carplayWeb.dongleDriver.send(data);
      }
      break;

    case 'keyCommand': {
      const cmd: KeyCommand = event.data.command;
      const data = new SendCommand(cmd);
      if (carplayWeb) carplayWeb.dongleDriver.send(data);
      break;
    }
  }
};

export {};