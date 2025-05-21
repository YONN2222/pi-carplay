# pi‑carplay

pi‑carplay brings Apple CarPlay functionality to the Raspberry Pi.
While it started as a fork of react-carplay, it has since evolved into a standalone implementation with a different focus.

🎯 Optimized for embedded Raspberry Pi setups and ultra-low-resolution displays

> **Requirements:** A Carlinkit **CPC200-CCPA** (wireless & wired) or **CPC200-CCPW** (wired only) adapter.


## 📦 Installation

```bash
git clone https://github.com/f-io/pi-carplay.git
cd pi-carplay
./setup-pi.sh
```

The `setup-pi.sh` script will:

1. Install required dependencies
2. Configure udev rules
3. Download the latest AppImage
4. Create an autostart entry

## 📷 Images
<p align="center">
  <img src="documentation/images/carplay.png"
       alt="CarPlay"
       width="45%" />
</p>

<p align="center">
  <img src="documentation/images/settings.png"
       alt="Settings"
       width="45%" />
  &emsp;&emsp;
  <img src="documentation/images/info.png"
       alt="Info"
       width="45%" />
</p>


## 📦 Build Environment

```bash
node -v
v22.15.0

npm -v
10.9.2
```

---

### 🧱 System Requirements

Make sure the following packages and tools are installed on your system before building:

- **Python 3.x** (for native module builds via `node-gyp`)
- **build-essential** (Linux: includes `gcc`, `g++`, `make`, etc.)
- **libusb-1.0-0-dev** (required for `node-usb`)
- **libudev-dev** (optional but recommended for USB detection on Linux)
- **fuse** (required to run AppImages)

---

### 🔨 Clone & Build

```bash
git clone --branch main --single-branch https://github.com/f-io/pi-carplay.git \
  && cd pi-carplay \
  && npm install \
  && npm run build \
  && npm run build:armLinux
```

## 🔗 Links

* **Repository & Issue Tracker:** [f-io/pi-carplay](https://github.com/f-io/pi-carplay)
* **Inspired by:** [react-carplay](https://github.com/rhysmorgan134/react-carplay)

## ⚠️ Disclaimer

** _Apple and CarPlay are trademarks of Apple Inc. This project is not affiliated with or endorsed by Apple in any way. All trademarks are the property of their respective owners._


## 📝 License

This project is licensed under the MIT License.
