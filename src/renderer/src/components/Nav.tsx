import React from 'react'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import PhonelinkOffIcon from '@mui/icons-material/PhonelinkOff'
import PhonelinkIcon from '@mui/icons-material/Phonelink'
import TuneIcon from '@mui/icons-material/Tune'
import HelpCenterIcon from '@mui/icons-material/HelpCenter'
import CameraIcon from '@mui/icons-material/Camera'
import CloseIcon from '@mui/icons-material/Close'
import { Link, useLocation } from 'react-router-dom'
import { useStatusStore } from '../store/store'
import { useTheme } from '@mui/material/styles'
import { ExtraConfig } from '../../../main/Globals'

interface NavProps {
  settings: ExtraConfig | null
}

export default function Nav({ settings }: NavProps) {
  const theme = useTheme()
  const { pathname } = useLocation()

  const isDongleConnected = useStatusStore((s) => s.isDongleConnected)
  const isStreaming = useStatusStore((s) => s.isStreaming)

  if (isStreaming && pathname === '/') {
    return null
  }

  const routeToIndex: Record<string, number> = {
    '/': 0,
    '/settings': 1,
    '/info': 2,
    '/camera': 3,
  }
  const value = routeToIndex[pathname] ?? 0

  let icon: React.ReactNode
  let color: string
  if (!isDongleConnected) {
    icon = <PhonelinkOffIcon />
    color = theme.palette.text.disabled
  } else if (!isStreaming) {
    icon = <PhonelinkIcon />
    color = theme.palette.text.primary
  } else {
    icon = <PhonelinkIcon />
    color = theme.palette.success.main
  }

  const quit = () => {
    window.electron.api.quit().catch((err: any) => console.error('Quit failed:', err))
  }

  return (
    <Tabs
      value={value}
      aria-label="Navigation Tabs"
      variant="fullWidth"
      textColor="inherit"
      indicatorColor="secondary"
    >
      <Tab
        icon={icon}
        component={Link}
        to="/"
        sx={{
          '& svg': {
            color,
          },
        }}
      />
      <Tab icon={<TuneIcon />} component={Link} to="/settings" />
      <Tab icon={<HelpCenterIcon />} component={Link} to="/info" />
      {settings?.camera && (
        <Tab icon={<CameraIcon />} component={Link} to="/camera" />
      )}
      <Tab icon={<CloseIcon />} onClick={quit} />
    </Tabs>
  )
}
