"use strict";

declare const currentTime: number;
declare function registerProcessor(name: string, ctor: any): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: any);
}

const RENDER_QUANTUM_FRAMES = 128;
const RING_POINTERS_SIZE = 8;
const START_QUANTA = 3;

class RingBuffReader {
  private storage: Int16Array;
  private writePointer: Uint32Array;
  private readPointer: Uint32Array;

  constructor(buffer: SharedArrayBuffer) {
    const storageSize =
      (buffer.byteLength - RING_POINTERS_SIZE) / Int16Array.BYTES_PER_ELEMENT;
    this.storage = new Int16Array(buffer, RING_POINTERS_SIZE, storageSize);
    this.writePointer = new Uint32Array(buffer, 0, 1);
    this.readPointer = new Uint32Array(buffer, 4, 1);
  }

  readTo(target: Int16Array): number {
    const { readPos, available } = this.getReadInfo();
    if (available === 0) return 0;

    const readLength = Math.min(available, target.length);
    const first = Math.min(this.storage.length - readPos, readLength);
    const second = readLength - first;

    target.set(this.storage.subarray(readPos, readPos + first), 0);
    if (second > 0) target.set(this.storage.subarray(0, second), first);

    Atomics.store(this.readPointer, 0, (readPos + readLength) % this.storage.length);
    return readLength;
  }

  getReadInfo() {
    const readPos = Atomics.load(this.readPointer, 0);
    const writePos = Atomics.load(this.writePointer, 0);
    const available = (writePos + this.storage.length - readPos) % this.storage.length;
    return { readPos, writePos, available };
  }
}

class PCMWorkletProcessor extends AudioWorkletProcessor {
  private channels: number;
  private reader: RingBuffReader;
  private readerOutput: Int16Array;
  private primed = false;

  constructor(options: any) {
    super();
    const { sab, channels } = options.processorOptions as {
      sab: SharedArrayBuffer;
      channels: number;
    };
    this.channels = channels;
    this.reader = new RingBuffReader(sab);
    this.readerOutput = new Int16Array(RENDER_QUANTUM_FRAMES * channels);
  }

  private toFloat32(s16: number) {
    return s16 / 32768;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const outputChannels = outputs[0];
    const ch = this.channels;
    const frames = RENDER_QUANTUM_FRAMES;
    const needSamples = frames * ch;

    const { available } = this.reader.getReadInfo();

    // preroll
    if (!this.primed) {
      if (available >= START_QUANTA * needSamples) {
        this.primed = true;
      } else {
        for (let c = 0; c < outputChannels.length; c++) outputChannels[c].fill(0);
        return true;
      }
    }

    // not enough data -> silence
    if (available < needSamples) {
      for (let c = 0; c < outputChannels.length; c++) outputChannels[c].fill(0);
      return true;
    }

    // read one quantum
    const got = this.reader.readTo(this.readerOutput);
    if (got < needSamples) {
      for (let c = 0; c < outputChannels.length; c++) outputChannels[c].fill(0);
      return true;
    }

    // deinterleave by frames
    if (ch === 2) {
      const L = outputChannels[0];
      const R = outputChannels[1];
      for (let f = 0; f < frames; f++) {
        const i = f * 2;
        L[f] = this.toFloat32(this.readerOutput[i]);
        R[f] = this.toFloat32(this.readerOutput[i + 1]);
      }
    } else {
      const M = outputChannels[0];
      for (let f = 0; f < frames; f++) M[f] = this.toFloat32(this.readerOutput[f]);
      for (let c = 1; c < outputChannels.length; c++) outputChannels[c].fill(0);
    }

    return true;
  }
}

registerProcessor("pcm-worklet-processor", PCMWorkletProcessor);
