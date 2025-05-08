// Based on https://github.com/codewithpassion/foxglove-studio-h264-extension/tree/main
// MIT License
import { getDecoderConfig, isKeyFrame } from './lib/utils'
import { InitEvent, RenderEvent, WorkerEvent } from './RenderEvents'
import { WebGL2Renderer } from './WebGL2Renderer'
import { WebGLRenderer } from './WebGLRenderer'
import { WebGPURenderer } from './WebGPURenderer'

export interface FrameRenderer {
  draw(data: VideoFrame): void
}

// eslint-disable-next-line no-restricted-globals
const scope = self as unknown as Worker

export class RendererWorker {
  private renderer: FrameRenderer | null = null
  private videoPort: MessagePort | null = null
  private pendingFrame: VideoFrame | null = null
  private startTime: number | null = null
  private frameCount = 0
  private timestamp = 0
  private fps = 0

  constructor() {}

  private onVideoDecoderOutput = (frame: VideoFrame) => {
    if (this.startTime == null) {
      this.startTime = performance.now()
    } else {
      const elapsed = (performance.now() - this.startTime) / 1000
      this.fps = ++this.frameCount / elapsed
    }
    this.renderFrame(frame)
  }

  private renderFrame = (frame: VideoFrame) => {
    if (!this.pendingFrame) {
      requestAnimationFrame(this.renderAnimationFrame)
    } else {
      this.pendingFrame.close()
    }
    this.pendingFrame = frame
  }

  private renderAnimationFrame = () => {
    if (this.pendingFrame) {
      this.renderer?.draw(this.pendingFrame)
      this.pendingFrame = null
    }
  }

  private onVideoDecoderOutputError = (err: Error) => {
    console.error(`H264 Render worker decoder error`, err)
  }

  private decoder = new VideoDecoder({
    output: this.onVideoDecoderOutput,
    error: this.onVideoDecoderOutputError,
  })

  init = (event: InitEvent) => {
    switch (event.renderer) {
      case 'webgl':
        this.renderer = new WebGLRenderer(event.canvas)
        break
      case 'webgl2':
        this.renderer = new WebGL2Renderer(event.canvas)
        break
      case 'webgpu':
        this.renderer = new WebGPURenderer(event.canvas)
        break
    }

    this.videoPort = event.videoPort
    this.videoPort.onmessage = ev => this.onFrame(ev.data as RenderEvent)

    if (event.reportFps) {
      setInterval(() => {
        if (this.decoder.state === 'configured') {
          console.debug(`FPS: ${this.fps}`)
        }
      }, 5000)
    }
  }

  private onFrame = (event: RenderEvent) => {
    console.debug('[WORKER] onFrame() called')
    console.debug('[WORKER] event.frameData', event.frameData)
    console.debug('[WORKER] event.frameData.slice(0, 16)', Array.from(new Uint8Array(event.frameData.slice(0, 16))))
    const frameData = new Uint8Array(event.frameData)
    console.debug('[WORKER] Uint8Array frameData.slice(0, 16)', Array.from(frameData.slice(0, 16)))

    if (this.decoder.state === 'unconfigured') {
      const decoderConfig = getDecoderConfig(frameData)
      console.debug('[WORKER] decoderConfig', decoderConfig)

      if (decoderConfig) {
        this.decoder.configure(decoderConfig)
        self.postMessage({
          type: 'resolution',
          payload: {
            width: decoderConfig.codedWidth,
            height: decoderConfig.codedHeight,
          },
        })
      } else {
        console.warn('[WORKER] Failed to get decoder config (no SPS?)')
      }
    }

    if (this.decoder.state === 'configured') {
      try {
        const chunk = new EncodedVideoChunk({
          type: isKeyFrame(frameData) ? 'key' : 'delta',
          data: frameData,
          timestamp: this.timestamp++,
        })
        console.debug('[WORKER] decode chunk', chunk)
        this.decoder.decode(chunk)
      } catch (e) {
        console.error(`H264 Render Worker decode error`, e)
      }
    }
  }
}

// eslint-disable-next-line no-restricted-globals
const worker = new RendererWorker()
scope.addEventListener('message', (event: MessageEvent<WorkerEvent>) => {
  if (event.data.type === 'init') {
    worker.init(event.data as InitEvent)
  }
})

export {}
