#!/bin/bash
set -euo pipefail

# ----------------------------------------
# pi-carplay Installer & Shortcut Creator
# ----------------------------------------

# Paths
USER_HOME="$HOME"
APPIMAGE_PATH="$USER_HOME/pi-carplay/pi-carplay.AppImage"
APPIMAGE_DIR="$(dirname "$APPIMAGE_PATH")"

# 1) Create target directory if it doesn't exist
echo "Creating directory $APPIMAGE_DIR"
if [ ! -d "$APPIMAGE_DIR" ]; then
  mkdir -p "$APPIMAGE_DIR"
fi

# 2) Create udev rule for Carlinkit device
echo "Creating udev rule"
UDEV_FILE="/etc/udev/rules.d/52-carplay.rules"
sudo tee "$UDEV_FILE" > /dev/null <<EOF
SUBSYSTEM=="usb", ATTR{idVendor}=="1314", ATTR{idProduct}=="152*", MODE="0660", GROUP="plugdev"
EOF

echo " → Written udev rule to $UDEV_FILE"

# 3) Check for and install fuse and libfuse2
for pkg in fuse libfuse2; do
  echo -n "Checking for $pkg: "
  if dpkg-query -W --showformat='${Status}\n' "$pkg" 2>/dev/null | grep -q "install ok installed"; then
    echo "installed"
  else
    echo "not found, installing..."
    sudo apt-get update
    sudo apt-get --yes install "$pkg"
  fi
done

# 4) Download the latest ARM64 AppImage from GitHub
echo "Fetching latest release from GitHub"
latest_url=$(curl -s https://api.github.com/repos/f-io/pi-carplay/releases/latest \
  | grep "browser_download_url" \
  | grep "arm64.AppImage" \
  | cut -d '"' -f 4)

if [ -z "$latest_url" ]; then
  echo "Error: Could not find download URL." >&2
  exit 1
fi

echo "Download URL: $latest_url"
curl -L "$latest_url" --output "$APPIMAGE_PATH"
echo "Download complete: $APPIMAGE_PATH"

# 5) Make the AppImage executable
chmod +x "$APPIMAGE_PATH"
echo "Set executable permission on $APPIMAGE_PATH"

# 6) Create per-user autostart entry
echo "Creating autostart entry"
AUTOSTART_DIR="$USER_HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/pi-carplay.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=pi-carplay
Exec=$APPIMAGE_PATH
X-GNOME-Autostart-enabled=true
EOF
echo " → Autostart entry at $AUTOSTART_DIR/pi-carplay.desktop"

# 7) Create Desktop shortcut (respect XDG, fallback to ~/Desktop)
echo "Creating desktop shortcut"

# Use xdg-user-dir if available for correct DESKTOP path
if command -v xdg-user-dir >/dev/null 2>&1; then
  DESKTOP_DIR=$(xdg-user-dir DESKTOP)
else
  raw_dir=$(grep XDG_DESKTOP_DIR "$USER_HOME/.config/user-dirs.dirs" 2>/dev/null \
    | cut -d '=' -f2- | tr -d '"')
  # Expand literal $HOME if present
  DESKTOP_DIR="${raw_dir/\$HOME/$USER_HOME}"
  DESKTOP_DIR=${DESKTOP_DIR:-"$USER_HOME/Desktop"}
fi

mkdir -p "$DESKTOP_DIR"
desktop_file="$DESKTOP_DIR/pi-carplay.desktop"
cat > "$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=pi-carplay
Comment=Launch pi-carplay AppImage
Exec=$APPIMAGE_PATH
Icon=pi-carplay
Terminal=false
Categories=Utility;
StartupNotify=false
EOF

chmod +x "$desktop_file"
echo " → Desktop shortcut created at $desktop_file"

echo "Done!"
