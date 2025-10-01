import { decodeTypeMap } from "../../../../main/carplay/messages";
import { AudioPlayerKey } from "./types";
import { RingBuffer } from "ringbuf.js";
import { createAudioPlayerKey } from "./utils";

const audioBuffers: Record<AudioPlayerKey, RingBuffer> = {};
const pendingAudio: Record<AudioPlayerKey, Int16Array[]> = {};
const remainders: Record<AudioPlayerKey, Int16Array | undefined> = {};

let microphonePort: MessagePort | undefined;

let isNewStream = true;
let lastPcmTimestamp = Date.now();
const PCM_TIMEOUT = 2000;

function processAudioData(audioData: any) {
  const { decodeType, audioType } = audioData;
  const meta = decodeTypeMap[decodeType];

  // normalize to Int16Array
  let int16: Int16Array;
  if (audioData.data instanceof Int16Array) {
    int16 =
      audioData.data.byteOffset % 2 === 0 &&
      audioData.data.buffer.byteLength >=
        audioData.data.byteOffset + audioData.data.byteLength
        ? audioData.data
        : new Int16Array(audioData.data);
  } else if (audioData.buffer instanceof ArrayBuffer) {
    int16 = new Int16Array(audioData.buffer);
  } else {
    console.error("[CARPLAY.WORKER] PCM - cannot interpret PCM data:", audioData);
    return;
  }

  const now = Date.now();
  if (now - lastPcmTimestamp > PCM_TIMEOUT) isNewStream = true;

  if (isNewStream && meta) {
    isNewStream = false;

    (self as unknown as Worker).postMessage({
      type: "audioInfo",
      payload: {
        codec: meta.format ?? meta.mimeType ?? String(decodeType),
        sampleRate: meta.frequency,
        channels: meta.channel,
        bitDepth: meta.bitDepth,
      },
    });

    const keyInit = createAudioPlayerKey(decodeType, audioType);
    remainders[keyInit] = undefined;
  }

  // downmix for UI/FFT
  if (meta) {
    const chUI = Math.max(1, meta.channel ?? 2);
    const framesUI = Math.floor(int16.length / chUI);
    const float32 = new Float32Array(framesUI);
    for (let i = 0; i < framesUI; i++) {
      let sum = 0;
      for (let c = 0; c < chUI; c++) sum += int16[i * chUI + c] || 0;
      float32[i] = (sum / chUI) / 32768;
    }
    (self as unknown as Worker).postMessage(
      { type: "pcmData", payload: float32.buffer, decodeType },
      [float32.buffer]
    );
  }

  // write to audio ring: frame-aligned
  const key = createAudioPlayerKey(decodeType, audioType);
  const channels = Math.max(1, meta?.channel ?? 2);

  // prepend remainder
  let src = int16;
  const prev = remainders[key];
  if (prev && prev.length) {
    const merged = new Int16Array(prev.length + int16.length);
    merged.set(prev, 0);
    merged.set(int16, prev.length);
    src = merged;
    remainders[key] = undefined;
  }

  // push only whole frames
  const framesTotal = Math.floor(src.length / channels);
  const samplesAligned = framesTotal * channels;

  if (samplesAligned > 0) {
    const aligned = samplesAligned === src.length ? src : src.subarray(0, samplesAligned);
    if (audioBuffers[key]) {
      audioBuffers[key].push(aligned);
    } else {
      pendingAudio[key] = pendingAudio[key] || [];
      pendingAudio[key].push(aligned);
      (self as unknown as Worker).postMessage({
        type: "requestBuffer",
        message: { decodeType, audioType },
      });
    }
  }

  // keep leftover for next chunk
  const leftover = src.length - samplesAligned;
  if (leftover > 0) remainders[key] = src.subarray(samplesAligned);

  lastPcmTimestamp = now;
}

function setupPorts(mPort: MessagePort) {
  try {
    mPort.onmessage = (ev) => {
      try {
        const data = ev.data as any;
        if (data.type === "audio" && data.buffer) processAudioData(data);
      } catch (e) {
        console.error("[CARPLAY.WORKER] error processing audio message:", e);
      }
    };
    mPort.start?.();
  } catch (e) {
    console.error("[CARPLAY.WORKER] port setup failed:", e);
    (self as unknown as Worker).postMessage({ type: "failure", error: "Port setup failed" });
  }
}

(self as unknown as Worker).onmessage = (ev: MessageEvent) => {
  const data = ev.data as any;
  switch (data.type) {
    case "initialise": {
      microphonePort = data.payload.microphonePort;
      if (microphonePort) setupPorts(microphonePort);
      else console.error("[CARPLAY.WORKER] missing microphonePort in initialise payload");
      break;
    }
    case "audioPlayer": {
      const { sab, decodeType, audioType } = data.payload as {
        sab: SharedArrayBuffer;
        decodeType: number;
        audioType: number;
      };
      const key = createAudioPlayerKey(decodeType, audioType);
      audioBuffers[key] = new RingBuffer(sab, Int16Array);

      const pend = pendingAudio[key] || [];
      for (const buf of pend) audioBuffers[key].push(buf);
      delete pendingAudio[key];
      break;
    }
    case "stop":
      isNewStream = true;
      break;
    default:
      break;
  }
};

export {};
