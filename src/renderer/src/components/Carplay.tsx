import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { findDevice, CommandMapping } from "node-carplay/web"
import { CarPlayWorker } from "./worker/types"
import useCarplayAudio from "./useCarplayAudio"
import { useCarplayTouch } from "./useCarplayTouch"
import { useLocation, useNavigate } from "react-router-dom"
import { ExtraConfig } from "../../../main/Globals"
import { useCarplayStore, useStatusStore } from "../store/store"
import { InitEvent } from "./worker/render/RenderEvents"
import FFTSpectrum from "./FFT"
import { Typography } from "@mui/material"

const videoChannel = new MessageChannel()
const micChannel = new MessageChannel()
const RETRY_DELAY_MS = 3000

interface CarplayProps {
  receivingVideo: boolean
  setReceivingVideo: (receivingVideo: boolean) => void
  settings: ExtraConfig
  command: string
  commandCounter: number
}

const Carplay: React.FC<CarplayProps> = ({
  receivingVideo,
  setReceivingVideo,
  settings,
  command,
  commandCounter,
}) => {
  //Flags from store
  const isDongleConnected = useStatusStore(s => s.isDongleConnected)
  const setDongleConnected = useStatusStore(s => s.setDongleConnected)
  const isStreaming = useStatusStore(s => s.isStreaming)
  const setStreaming = useStatusStore(s => s.setStreaming)
  const [isResettingDongle, setIsResettingDongle] = useState(false)

  // Fallback
  const [deviceFound, setDeviceFound] = useState(false)

  // Carplay-Store-Setter
  const setDeviceInfo = useCarplayStore(s => s.setDeviceInfo)
  const setNegotiatedResolution = useCarplayStore(s => s.setNegotiatedResolution)
  const setAudioInfo = useCarplayStore(s => s.setAudioInfo)
  const setPcmData = useCarplayStore(s => s.setPcmData)

  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null)
  const mainElem = useRef<HTMLDivElement>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const configRef = useRef({
    fps: settings.fps,
    width: settings.width,
    height: settings.height,
    dpi: settings.dpi,
    format: settings.format,
    mediaDelay: settings.mediaDelay,
  })
  const config = configRef.current

  useEffect(() => {
    configRef.current = {
      fps: settings.fps,
      width: settings.width,
      height: settings.height,
      dpi: settings.dpi,
      format: settings.format,
      mediaDelay: settings.mediaDelay,
    }
  }, [settings])

  // Render-Worker
  const renderWorker = useMemo(() => {
    if (!canvasElement) return
    const worker = new Worker(
      new URL("./worker/render/Render.worker.ts", import.meta.url),
      { type: "module" }
    )
    const offscreen = canvasElement.transferControlToOffscreen()
    worker.postMessage(
      new InitEvent(offscreen, videoChannel.port2),
      [offscreen, videoChannel.port2]
    )
    return worker
  }, [canvasElement])

  useLayoutEffect(() => {
    if (canvasRef.current) {
      setCanvasElement(canvasRef.current)
    }
  }, [])

  // CarPlay-Worker
  const carplayWorker = useMemo(() => {
    const w = new Worker(
      new URL("./worker/CarPlay.worker.ts", import.meta.url),
      { type: "module" }
    ) as CarPlayWorker
    w.postMessage(
      {
        type: "initialise",
        payload: {
          videoPort: videoChannel.port1,
          microphonePort: micChannel.port1,
        },
      },
      [videoChannel.port1, micChannel.port1]
    )
    return w
  }, [])

  const { processAudio, getAudioPlayer, startRecording, stopRecording } =
    useCarplayAudio(carplayWorker, micChannel.port2)

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
  }, [])

  // Message-Loop
  useEffect(() => {
    const handler = (ev: MessageEvent<any>) => {
      const { type, payload, message } = ev.data
      switch (type) {
        case "plugged":
          setStreaming(true)
          break
        case "unplugged":
          setStreaming(false)
          break
        case "requestBuffer":
          clearRetryTimeout()
          getAudioPlayer(message)
          break
        case "audio":
          clearRetryTimeout()
          processAudio(message)
          break
        case "audioInfo":
          setAudioInfo({
            codec: payload.codec,
            sampleRate: payload.sampleRate,
            channels: payload.channels,
            bitDepth: payload.bitDepth,
          })
          break
        case "pcmData":
          setPcmData(new Float32Array(payload as ArrayBuffer))
          break
        case "command": {
          const val = (message as any).value
          if (val === CommandMapping.startRecordAudio) startRecording()
          if (val === CommandMapping.stopRecordAudio) stopRecording()
          if (val === CommandMapping.requestHostUI) navigate("/settings")
          break
        }
        case "dongleInfo":
          setDeviceInfo(payload)
          setDongleConnected(true)
          break
        case "resolution":
          setNegotiatedResolution(payload.width, payload.height)
          break
        case "failure":
          if (!retryTimeoutRef.current) {
            retryTimeoutRef.current = setTimeout(() => window.location.reload(), RETRY_DELAY_MS)
          }
          break
      }
    }

    carplayWorker.addEventListener("message", handler)
    return () => {
      carplayWorker.removeEventListener("message", handler)
    }
  }, [
    carplayWorker,
    clearRetryTimeout,
    getAudioPlayer,
    processAudio,
    startRecording,
    stopRecording,
    navigate,
    setDeviceInfo,
    setNegotiatedResolution,
    setAudioInfo,
    setPcmData,
    setDongleConnected,
    setStreaming,
  ])


  useEffect(() => {
    const elem = mainElem.current
    if (!elem) return
    const obs = new ResizeObserver(() =>
      carplayWorker.postMessage({ type: "frame" })
    )
    obs.observe(elem)
    return () => obs.disconnect()
  }, [carplayWorker])

  // Key-Commands
  useEffect(() => {
    carplayWorker.postMessage({ type: "keyCommand", command })
  }, [commandCounter, carplayWorker])

  // USB Connect/Disconnect + Initial Check
  useEffect(() => {
    const onUsbConnect = async () => {
      const device = await findDevice()
      if (device) {
        setDeviceFound(true)
        setDongleConnected(true)
        setReceivingVideo(true)
        carplayWorker.postMessage({ type: "start", payload: { config } })
      }
    }
    const onUsbDisconnect = async () => {
      clearRetryTimeout()
      if (!(await findDevice())) {
        carplayWorker.postMessage({ type: "stop" })
        setDeviceFound(false)
        setReceivingVideo(false)
        setStreaming(false)
        setDongleConnected(false)
    
        if (canvasRef.current) {
          canvasRef.current.style.width = "0"
          canvasRef.current.style.height = "0"
        }

        if (!isResettingDongle) {
          navigate(pathname)
        }
    
        setIsResettingDongle(false)
      }
    }

    // Initial USB check
    ;(async () => {
      try {
        const devices = await navigator.usb.getDevices()
        const dongle = devices.find(
          (d) => d.vendorId === 5824 && d.productId === 1155
        )
        if (dongle) {
          setDeviceFound(true)
          setDongleConnected(true)
          setReceivingVideo(true)
          carplayWorker.postMessage({ type: "start", payload: { config } })
        }
      } catch (e) {
        console.error("initial USB check error", e)
      }
    })()

    navigator.usb.addEventListener("connect", onUsbConnect)
    navigator.usb.addEventListener("disconnect", onUsbDisconnect)

    return () => {
      navigator.usb.removeEventListener("connect", onUsbConnect)
      navigator.usb.removeEventListener("disconnect", onUsbDisconnect)
    }
  }, [
    carplayWorker,
    setReceivingVideo,
    setDongleConnected,
    setStreaming,
    config,
    navigate,
  ])

  // Cleanup
  useEffect(() => {
    return () => {
      carplayWorker.terminate()
    }
  }, [carplayWorker])

  // Render worker video resolution message
  useEffect(() => {
    if (!renderWorker) return
    const h = (ev: MessageEvent<any>) => {
      if (ev.data.type === "resolution") {
        setNegotiatedResolution(ev.data.payload.width, ev.data.payload.height)
      }
    }
    renderWorker.addEventListener("message", h)
    return () => {
      renderWorker.removeEventListener("message", h)
    }
  }, [renderWorker, setNegotiatedResolution])

  const sendTouchEvent = useCarplayTouch(carplayWorker)
  const isLoading = !isStreaming

  return (
    <div
      id="main"
      ref={mainElem}
      className="App"
      style={
        pathname === "/"
          ? { height: "100%", width: "100%", touchAction: "none" }
          : { display: "none" }
      }
    >
      {(!deviceFound || isLoading) && pathname === "/" && (
        <div
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {!deviceFound ? (
            <Typography>Searching For Dongle</Typography>
          ) : (
            <Typography>Searching For Phone</Typography>
          )}
        </div>
      )}
      <div
        id="videoContainer"
        onPointerDown={sendTouchEvent}
        onPointerMove={sendTouchEvent}
        onPointerUp={sendTouchEvent}
        onPointerCancel={sendTouchEvent}
        onPointerOut={sendTouchEvent}
        style={{
          height: "100%",
          width: "100%",
          padding: 0,
          margin: 0,
          display: "flex",
          visibility: isStreaming ? "visible" : "hidden",
          zIndex: isStreaming ? 1 : -1,
        }}
      >
        <canvas
          ref={canvasRef}
          id="video"
          style={{
            width: isStreaming ? "100%" : "0",
            height: isStreaming ? "100%" : "0",
            transform: "translateZ(0)",
          }}
        />
      </div>
    </div>
  )
}

export default React.memo(Carplay)