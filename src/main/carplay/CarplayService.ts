import { ipcMain, WebContents } from 'electron';
import { WebUSBDevice } from 'usb';
import {
  Plugged,
  Unplugged,
  VideoData,
  AudioData,
  MediaData,
  Command,
  SendCommand,
  SendTouch,
  SendAudio,
  DongleDriver,
  DongleConfig,
  DEFAULT_CONFIG,
  decodeTypeMap,
  AudioCommand,
} from './messages';
import fs from 'fs';
import path from 'path';
import usb from 'usb';
import NodeMicrophone from './node/NodeMicrophone';


export class CarplayService {
  private driver = new DongleDriver();
  private webContents: WebContents | null = null;
  private config: DongleConfig = DEFAULT_CONFIG;
  private pairTimeout: NodeJS.Timeout | null = null;
  private frameInterval: NodeJS.Timeout | null = null;
  private _mic: NodeMicrophone | null = null;
  private started = false;
  private audioInfoSent = false;

  constructor() {
    this.driver.on('message', msg => {
      if (!this.webContents) return;

      if (msg instanceof Plugged) {
        this.clearTimeouts();
        this.webContents.send('carplay-event', { type: 'plugged' });
      } else if (msg instanceof Unplugged) {
        this.webContents.send('carplay-event', { type: 'unplugged' });
      } else if (msg instanceof VideoData) {
        this.webContents.send('carplay-event', {
          type: 'resolution',
          payload: { width: msg.width, height: msg.height },
        });
        this.sendChunked('carplay-video-chunk', msg.data?.buffer, 512 * 1024);
      } else if (msg instanceof AudioData) {
        if (msg.data) {
          //console.debug('[CarplayService] Received AudioData chunk');
          this.sendChunked('carplay-audio-chunk', msg.data.buffer, 64 * 1024, { ...msg });

          if (!this.audioInfoSent) {
            const meta = decodeTypeMap[msg.decodeType];
            if (meta) {
              this.webContents.send('carplay-event', {
                type: 'audioInfo',
                payload: {
                  codec: meta.format ?? meta.mimeType,
                  sampleRate: meta.frequency,
                  channels: meta.channel,
                  bitDepth: meta.bitDepth,
                },
              });
              this.audioInfoSent = true;
            }
          }
        } else if (msg.command != null) {
          console.debug('[CarplayService] Received audio command:', msg.command);
          if (
            msg.command === AudioCommand.AudioSiriStart ||
            msg.command === AudioCommand.AudioPhonecallStart
          ) {
            if (!this._mic) {
              console.debug('[CarplayService] Initializing microphone');
              this._mic = new NodeMicrophone();
              this._mic = new NodeMicrophone();
              this._mic.on('data', (data: Buffer) => {
                console.debug('[CarplayService] Mic data received');
                this.driver.send(new SendAudio(new Int16Array(data.buffer)));
              });
            }
            console.debug('[CarplayService] Starting microphone');
            this._mic.start();
          } else if (
            msg.command === AudioCommand.AudioSiriStop ||
            msg.command === AudioCommand.AudioPhonecallStop
          ) {
            console.debug('[CarplayService] Stopping microphone');
            this._mic?.stop();
          }
        }
      } else if (msg instanceof MediaData) {
        this.webContents.send('carplay-event', { type: 'media', payload: msg });
      } else if (msg instanceof Command) {
        this.webContents.send('carplay-event', { type: 'command', message: msg });
      }
    });

    this.driver.on('failure', () => {
      this.webContents?.send('carplay-event', { type: 'failure' });
    });

    ipcMain.handle('carplay-start', async () => this.start());
    ipcMain.handle('carplay-stop', async () => this.stop());
    ipcMain.handle('carplay-sendframe', async () => this.driver.send(new SendCommand('frame')));
    ipcMain.on('carplay-touch', (_, data) => {
      this.driver.send(new SendTouch(data.x, data.y, data.action));
    });
    ipcMain.on('carplay-key-command', (_, command) => {
      this.driver.send(new SendCommand(command));
    });
  }

  public attachRenderer(webContents: WebContents) {
    this.webContents = webContents;
  }

  private async start() {
    if (this.started) return;
    try {
      const configPath = path.join(process.env.HOME || '', '.config/pi-carplay/config.json');
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      this.config = { ...this.config, ...userConfig };
    } catch {
      // ignore, use DEFAULT_CONFIG
    }
    const device = usb.getDeviceList().find(d =>
      d.deviceDescriptor.idVendor === 0x1314 &&
      (d.deviceDescriptor.idProduct === 0x1520 || d.deviceDescriptor.idProduct === 0x1521)
    );
    if (!device) return;
    const webUsbDevice = await WebUSBDevice.createInstance(device);
    await webUsbDevice.open();
    await this.driver.initialise(webUsbDevice);
    await this.driver.start(this.config);
    this.pairTimeout = setTimeout(() => {
      this.driver.send(new SendCommand('wifiPair'));
    }, 15000);
    this.started = true;
  }

  public async stop() {
    this.clearTimeouts();
    await this.driver.close();
    this._mic?.stop();
    this.started = false;
  }

  private clearTimeouts() {
    if (this.pairTimeout) clearTimeout(this.pairTimeout);
    if (this.frameInterval) clearInterval(this.frameInterval);
  }

  private sendChunked(
    channel: string,
    data?: ArrayBuffer,
    chunkSize = 512 * 1024,
    extra: Record<string, any> = {}
  ) {
    if (!this.webContents || !data) return;
    let offset = 0;
    const total = data.byteLength;
    let id = Math.random().toString(36).slice(2);

    while (offset < total) {
      const end = Math.min(offset + chunkSize, total);
      const chunk = data.slice(offset, end);
      this.webContents.send(channel, {
        id,
        offset,
        total,
        isLast: end >= total,
        chunk: Buffer.from(chunk),
        ...extra,
      });
      offset = end;
    }
  }
}
