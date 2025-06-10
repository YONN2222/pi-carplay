// Based on https://github.com/codewithpassion/foxglove-studio-h264-extension/tree/main
// MIT License
import { getDecoderConfig, isKeyFrame } from './lib/utils'
import { InitEvent, WorkerEvent } from './RenderEvents'
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
  private decoder: VideoDecoder

  constructor() {
    this.decoder = new VideoDecoder({
      output: this.onVideoDecoderOutput,
      error: this.onVideoDecoderOutputError,
    })
  }

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
    console.error(`[RENDER.WORKER] Decoder error`, err)
  }

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

    this.videoPort.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      this.onRawFrame(ev.data)
    }

    this.videoPort.start()
    self.postMessage({ type: 'render-ready' })
    console.debug('[RENDER.WORKER] render-ready')


    if (event.reportFps) {
      setInterval(() => {
        if (this.decoder.state === 'configured') {
          console.debug(`[RENDER.WORKER] FPS: ${this.fps.toFixed(2)}`)
        }
      }, 5000)
    }
  }

  private onRawFrame = (buffer: ArrayBuffer) => {
    if (!buffer || buffer.byteLength === 0) {
      console.warn('[RENDER.WORKER] Empty buffer received.')
      return
    }

    const frameData = new Uint8Array(buffer)

    if (this.decoder.state === 'unconfigured') {
      const decoderConfig = getDecoderConfig(frameData)
      console.debug('[RENDER.WORKER] Decoder config:', decoderConfig)

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
        console.warn('[RENDER.WORKER] Failed to configure decoder (missing SPS?)')
        return
      }
    }

    if (this.decoder.state === 'configured') {
      try {
        const chunk = new EncodedVideoChunk({
          type: isKeyFrame(frameData) ? 'key' : 'delta',
          data: frameData,
          timestamp: this.timestamp++,
        })
        this.decoder.decode(chunk)
      } catch (e) {
        console.error('[RENDER.WORKER] Decode error:', e)
      }
    }
  }
}

const worker = new RendererWorker()
scope.addEventListener('message', (event: MessageEvent<WorkerEvent>) => {
  if (event.data.type === 'init') {
    worker.init(event.data as InitEvent)
  }
})

export {}
