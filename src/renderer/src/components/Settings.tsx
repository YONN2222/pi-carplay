import { ExtraConfig } from "../../../main/Globals"
import React, { useEffect, useMemo, useState } from "react"
import {
  Box,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Checkbox,
  FormControl,
  FormLabel,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  Slide,
  Stack,
  Grid,
  Slider,
  CircularProgress,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { TransitionProps } from '@mui/material/transitions'
import { KeyBindings } from "./KeyBindings"
import { useCarplayStore } from "../store/store"
import debounce from 'lodash.debounce'

interface SettingsProps {
  settings: ExtraConfig;
}

const Transition = React.forwardRef(function Transition(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export default function Settings({ settings }: SettingsProps) {
  const [activeSettings, setActiveSettings] = useState<ExtraConfig>({
    ...settings,
    audioVolume: settings.audioVolume ?? 1.0,
    navVolume: settings.navVolume ?? 1.0,
  });

  const [micLabel, setMicLabel] = useState<string>('sysdefault');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [openBindings, setOpenBindings] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string>("");
  const saveSettings = useCarplayStore(s => s.saveSettings);
  const theme = useTheme();

  const debouncedSave = useMemo(() => debounce((newSettings: ExtraConfig) => {
    saveSettings(newSettings)
  }, 300), [saveSettings])

  const settingsChange = (key: keyof ExtraConfig, value: any) => {
    const updated = { ...activeSettings, [key]: value }
    setActiveSettings(updated);
    if (key === 'audioVolume' || key === 'navVolume') {
      debouncedSave(updated)
    }
  };

  const requiresRestartParams: (keyof ExtraConfig)[] = [
    'width', 'height', 'fps', 'dpi', 'format', 
    'mediaDelay', 'phoneWorkMode', 'wifiType', 'micType',
    'camera'
  ];

  const handleSave = async () => {
    const needsRestart = Object.keys(activeSettings).some(
      (key) =>
        requiresRestartParams.includes(key as keyof ExtraConfig) &&
        activeSettings[key] !== settings[key]
    );

    setIsResetting(true);
    setResetMessage("Dongle Reset...");

    await saveSettings(activeSettings);

    if (!needsRestart) {
      setIsResetting(false);
      setResetMessage("");
      return;
    }

    try {
      const resetSuccess = await window.carplay.usb.forceReset();
      setResetMessage(resetSuccess ? "Dongle Reset - Success" : "Dongle Reset - Failed");
    } catch (error) {
      setResetMessage("Dongle Reset Error.");
    }

    setIsResetting(false);
  };

  useEffect(() => {
    window.carplay.usb.getSysdefaultPrettyName().then(label => {
      if (typeof label === 'string') {
        setMicLabel(label);

        // Auto-select sysdefault if no microphone is set yet
        if (!activeSettings.microphone) {
          const updated = { ...activeSettings, microphone: 'sysdefault' };
          setActiveSettings(updated);
          debouncedSave(updated);
        }
      }
    });
  }, []);


  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then(devices => {
        setCameras(devices.filter(d => d.kind === 'videoinput'));
      }).catch(() => {
        setCameras([]);
      });
  }, []);

  const renderField = (label: string, key: keyof ExtraConfig, min?: number, max?: number) => (
    <Grid size={{ xs: 3 }} key={String(key)}>
      <TextField
        label={label}
        type="number"
        fullWidth
        inputProps={{ ...(min !== undefined && { min }), ...(max !== undefined && { max }) }}
        value={activeSettings[key] as number | string}
        onChange={e => settingsChange(key, Number(e.target.value))}
        sx={{ mx: 1 }}
      />
    </Grid>
  );

  const renderSliderField = (label: string, key: keyof ExtraConfig) => (
    <Grid size={{ xs: 6 }} key={String(key)}>
     <FormControl fullWidth sx={{ px: 2 }}>
        <FormLabel>{label}</FormLabel>
       <Slider
         value={Math.round((activeSettings[key] as number) * 100)}
         min={0}
         max={100}
         step={5}
         marks
         valueLabelDisplay="auto"
         onChange={(_, val) => {
         if (typeof val === 'number') {
            settingsChange(key, val / 100)
         }
        }}
      />
      </FormControl>
    </Grid>
  )

  const renderCameras = () => (
    <Grid size={{ xs: 6 }}>
      <FormControl fullWidth>
        <FormLabel>Camera</FormLabel>
        <RadioGroup
          value={activeSettings.camera}
          onChange={e => settingsChange('camera', e.target.value)}
        >
          {cameras.map(cam => (
            <FormControlLabel
              key={cam.deviceId}
              value={cam.deviceId}
              control={<Radio />}
              label={cam.label || 'Camera'}
            />
          ))}
        </RadioGroup>
      </FormControl>
    </Grid>
  );

  return (
    <>
      <Box className={theme.palette.mode === 'dark' ? 'App-header-dark' : 'App-header-light'} p={2}>
        <Grid container spacing={2}>
          {renderField('WIDTH', 'width')}
          {renderField('HEIGHT', 'height')}
          {renderField('FPS', 'fps')}
          {renderField('DPI', 'dpi')}
          {renderField('FORMAT', 'format')}
          {renderField('IBOX VERSION', 'iBoxVersion')}
          {renderField('MEDIA DELAY', 'mediaDelay')}
          {renderField('PHONE WORK MODE', 'phoneWorkMode')}
          {renderSliderField('AUDIO VOLUME', 'audioVolume')}
          {renderSliderField('NAV VOLUME', 'navVolume')}

          <Grid size={{ xs: 3 }}>
            <Stack direction="column" spacing={1} sx={{ mx: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={activeSettings.kiosk}
                    onChange={e => settingsChange('kiosk', e.target.checked)}
                  />
                }
                label="KIOSK"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={activeSettings.nightMode}
                    onChange={e => settingsChange('nightMode', e.target.checked)}
                  />
                }
                label="DARK MODE"
              />
            </Stack>
          </Grid>

          <Grid size={{ xs: 3 }}>
            <FormControl component="fieldset" fullWidth sx={{ mx: 1 }}>
              <FormLabel component="legend">WIFI TYPE</FormLabel>
              <RadioGroup
                row
                value={activeSettings.wifiType}
                onChange={e => settingsChange('wifiType', e.target.value)}
              >
                <FormControlLabel value="2.4ghz" control={<Radio />} label="2.4G" />
                <FormControlLabel value="5ghz" control={<Radio />} label="5G" />
              </RadioGroup>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 3 }}>
            <FormControl component="fieldset" fullWidth sx={{ mx: 1 }}>
              <FormLabel component="legend">MIC TYPE</FormLabel>
              <RadioGroup
                row
                value={activeSettings.micType}
                onChange={e => settingsChange('micType', e.target.value)}
              >
                <FormControlLabel value="os" control={<Radio />} label="OS" />
                <FormControlLabel value="box" control={<Radio />} label="BOX" />
              </RadioGroup>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 3 }}>
            <FormControl component="fieldset" fullWidth sx={{ mx: 1 }}>
              <FormLabel component="legend">MICROPHONE</FormLabel>
              <RadioGroup
                value={activeSettings.microphone}
                onChange={e => settingsChange('microphone', e.target.value)}
              >
                <FormControlLabel
                  value={"sysdefault"}
                  control={<Radio />}
                  label={micLabel}
                />
              </RadioGroup>
            </FormControl>
          </Grid>

          {cameras.length > 0 && renderCameras()}

          <Grid size={{ xs: 12 }}>
            <Box display="flex" justifyContent="center" sx={{ mt: 2 }}>
              <Button variant="contained" onClick={handleSave} disabled={isResetting}>
                SAVE
              </Button>
              <Button variant="outlined" onClick={() => setOpenBindings(true)} sx={{ ml: 2 }}>
                BINDINGS
              </Button>
            </Box>
            {isResetting && (
              <Box display="flex" justifyContent="center" sx={{ mt: 2 }}>
                <CircularProgress />
              </Box>
            )}
            <Dialog open={!!resetMessage}>
              <DialogTitle>Reset Status</DialogTitle>
              <DialogContent>
                <Typography variant="body1">{resetMessage}</Typography>
              </DialogContent>
            </Dialog>
          </Grid>
        </Grid>
      </Box>

      <Dialog
        open={openBindings}
        TransitionComponent={Transition}
        keepMounted
        PaperProps={{ sx: { minHeight: '80%', minWidth: '80%' }}}
        onClose={() => setOpenBindings(false)}
      >
        <DialogTitle>Key Bindings</DialogTitle>
        <DialogContent>
          <KeyBindings settings={activeSettings} updateKey={settingsChange} />
        </DialogContent>
      </Dialog>
    </>
  );
}
