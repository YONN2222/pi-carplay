import { parentPort } from 'worker_threads'
import usb from 'usb'

if (!parentPort) throw new Error('No parent port found')

function findDongle() {
  const devices = usb.getDeviceList()
  const dongle = devices.find(d =>
    d.deviceDescriptor.idVendor === 0x1314 &&
    [0x1520, 0x1521].includes(d.deviceDescriptor.idProduct)
  )
  return dongle
}

parentPort.on('message', (msg) => {
  if (msg === 'check-dongle') {
    const dongle = findDongle()
    if (dongle) {
      parentPort?.postMessage({
        type: 'dongle-status',
        connected: true,
        vendorId: dongle.deviceDescriptor.idVendor,
        productId: dongle.deviceDescriptor.idProduct,
      })
    } else {
      parentPort?.postMessage({
        type: 'dongle-status',
        connected: false,
      })
    }
  }
})