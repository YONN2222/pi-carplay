import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Typography } from '@mui/material'
import { useLocation, useNavigate } from 'react-router-dom'
import { CommandMapping } from '../../../main/carplay/messages/common'
import { ExtraConfig } from '../../../main/Globals'
import { useCarplayStore, useStatusStore } from '../store/store'
import { InitEvent } from './worker/render/RenderEvents'
import useCarplayAudio from './useCarplayAudio'
import { useCarplayTouch } from './useCarplayTouch'
import type { CarPlayWorker, KeyCommand } from './worker/types'

const videoChannel = new MessageChannel()
const micChannel = new MessageChannel()
const RETRY_DELAY_MS = 3000

interface CarplayProps {
  receivingVideo: boolean
  setReceivingVideo: (v: boolean) => void
  settings: ExtraConfig
  command: KeyCommand
  commandCounter: number
}

function useStreamingState() {
  const isStreaming = useStatusStore(s => s.isStreaming)
  const setStreaming = useStatusStore(s => s.setStreaming)
  useEffect(() => {
    console.log('[UI] isStreaming state changed:', isStreaming)
  }, [isStreaming])
  return { isStreaming, setStreaming }
}

function useDeviceState(deviceFound: boolean) {
  useEffect(() => {
    console.log('[UI] deviceFound state changed:', deviceFound)
  }, [deviceFound])
}

const Carplay: React.FC<CarplayProps> = ({
  receivingVideo,
  setReceivingVideo,
  settings,
  command,
  commandCounter,
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname

  const { isStreaming, setStreaming } = useStreamingState()
  const setDongleConnected = useStatusStore(s => s.setDongleConnected)
  const resetInfo = useCarplayStore(s => s.resetInfo)
  const setDeviceInfo = useCarplayStore(s => s.setDeviceInfo)
  const setNegotiatedResolution = useCarplayStore(s => s.setNegotiatedResolution)
  const setAudioInfo = useCarplayStore(s => s.setAudioInfo)
  const setPcmData = useCarplayStore(s => s.setPcmData)

  const [deviceFound, setDeviceFound] = useState(false)
  useDeviceState(deviceFound)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null)
  const mainElem = useRef<HTMLDivElement>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasStartedRef = useRef(false)

  const configRef = useRef(settings)
  const config = configRef.current

  useEffect(() => {
    configRef.current = settings
  }, [settings])

  useLayoutEffect(() => {
    if (canvasRef.current) setCanvasElement(canvasRef.current)
  }, [])

  const renderWorker = useMemo(() => {
    if (!canvasElement) return
    const worker = new Worker(
      new URL('./worker/render/Render.worker.ts', import.meta.url),
      { type: 'module' }
    )
    const offscreen = canvasElement.transferControlToOffscreen()
    worker.postMessage(new InitEvent(offscreen, videoChannel.port2), [offscreen, videoChannel.port2])
    return worker
  }, [canvasElement])

  const carplayWorker = useMemo(() => {
    const w = new Worker(new URL('./worker/CarPlay.worker.ts', import.meta.url), { type: 'module' }) as CarPlayWorker
    w.postMessage(
      {
        type: 'initialise',
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

  
  const sendTouchEvent = useCarplayTouch(carplayWorker)

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    const handler = (ev: MessageEvent<any>) => {
      const { type, payload, message } = ev.data
      switch (type) {
        case 'plugged':
          setDongleConnected(true)
          break
        case 'unplugged':
          hasStartedRef.current = false
          setDongleConnected(false)
          setStreaming(false)
          setReceivingVideo(false)
          resetInfo()
          break
        case 'requestBuffer':
          clearRetryTimeout()
          getAudioPlayer(message)
          break
        case 'audio':
          clearRetryTimeout()
          processAudio(message)
          break
        case 'audioInfo':
          setAudioInfo(payload)
          break
        case 'pcmData':
          setPcmData(new Float32Array(payload as ArrayBuffer))
          break
        case 'command': {
          const val = (message as any).value
          if (val === CommandMapping.startRecordAudio) startRecording()
          if (val === CommandMapping.stopRecordAudio) stopRecording()
          if (val === CommandMapping.requestHostUI) navigate('/settings')
          break
        }
        case 'dongleInfo':
          setDeviceInfo(payload)
          break
        case 'resolution':
          setNegotiatedResolution(payload.width, payload.height)
          setStreaming(true)
          setReceivingVideo(true)
          hasStartedRef.current = true
          break
        case 'failure':
          hasStartedRef.current = false
          if (!retryTimeoutRef.current) {
            retryTimeoutRef.current = setTimeout(() => window.location.reload(), RETRY_DELAY_MS)
          }
          break
      }
    }
    carplayWorker.addEventListener('message', handler)
    return () => carplayWorker.removeEventListener('message', handler)
  }, [
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
    resetInfo,
    setReceivingVideo,
  ])

  useEffect(() => {
    const onUsbConnect = async () => {
      if (!hasStartedRef.current) {
        console.log('[Carplay] USB dongle plugged in — starting immediately.')
        resetInfo()
        setDeviceFound(true)
        setDongleConnected(true)
        hasStartedRef.current = true
        carplayWorker.postMessage({ type: 'start', payload: { config } })
      }
    }

    const onUsbDisconnect = () => {
      clearRetryTimeout()
      setDeviceFound(false)
      setReceivingVideo(false)
      setStreaming(false)
      setDongleConnected(false)
      hasStartedRef.current = false
      resetInfo()
      carplayWorker.postMessage({ type: 'stop' })
      if (canvasRef.current) {
        canvasRef.current.style.width = '0'
        canvasRef.current.style.height = '0'
      }
      navigate('/')
    }

    const handler = (_event: any, data: { type: string }) => {
      if (data.type === 'plugged') {
        onUsbConnect()
      } else if (data.type === 'unplugged') {
        onUsbDisconnect()
      }
    }

    window.carplay.usb.listenForEvents(handler)
    return () => {
      window.electron?.ipcRenderer?.removeListener('usb-event', handler)
    }
  }, [setReceivingVideo, setDongleConnected, setStreaming, config, clearRetryTimeout, navigate, resetInfo])

  useEffect(() => {
    const elem = mainElem.current
    if (!elem) return
    const obs = new ResizeObserver(() => carplayWorker.postMessage({ type: 'frame' }))
    obs.observe(elem)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    carplayWorker.postMessage({ type: 'keyCommand', command })
  }, [commandCounter])

  useEffect(() => {
    return () => {
      carplayWorker.terminate()
      renderWorker?.terminate()
    }
  }, [])

  const isLoading = !isStreaming

  return (
    <div
      id="main"
      ref={mainElem}
      className="App"
      style={
        pathname === '/' ? { height: '100%', width: '100%', touchAction: 'none' } : { display: 'none' }
      }
    >
      {(!deviceFound || isLoading) && pathname === '/' && (
        <div
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
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
          height: '100%',
          width: '100%',
          padding: 0,
          margin: 0,
          display: 'flex',
          visibility: receivingVideo ? 'visible' : 'hidden',
          zIndex: receivingVideo ? 1 : -1,
        }}
      >
        <canvas
          ref={canvasRef}
          id="video"
          style={{ width: receivingVideo ? '100%' : '0', height: receivingVideo ? '100%' : '0' }}
        />
      </div>
    </div>
  )
}

export default React.memo(Carplay)