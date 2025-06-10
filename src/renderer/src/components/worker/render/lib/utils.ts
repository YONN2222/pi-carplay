import { Bitstream, NALUStream, SPS, StreamType } from './h264-utils'

export enum NaluTypes {
  NDR = 1,
  IDR = 5,
  SEI = 6,
  SPS = 7,
  PPS = 8,
  AUD = 9,
}

export interface GetNaluResult {
  nalu: Uint8Array
  rawNalu: Uint8Array
  type: NaluTypes
}

export function getNaluFromStream(
  buffer: Uint8Array,
  type: NaluTypes,
  streamType: StreamType = 'annexB'
): GetNaluResult | null {
  const stream = new NALUStream(buffer, { type: streamType })

  for (const nalu of stream.nalus()) {
    if (!nalu?.nalu || nalu.nalu.length < 4) continue

    const bitstream = new Bitstream(nalu.nalu)
    bitstream.seek(3)
    const nal_unit_type = bitstream.u(5)

    if (nal_unit_type === type) {
      return {
        nalu: nalu.nalu,
        rawNalu: nalu.rawNalu!,
        type: nal_unit_type,
      }
    }
  }

  return null
}

export function getDecoderConfig(data: Uint8Array): VideoDecoderConfig | null {
  for (const type of ['annexB', 'packet'] as StreamType[]) {
    try {
      const result = getNaluFromStream(data, NaluTypes.SPS, type)
      if (result) {
        const sps = new SPS(result.nalu)
        return {
          codec: sps.MIME,
          codedHeight: sps.picHeight,
          codedWidth: sps.picWidth,
          hardwareAcceleration: 'prefer-software',
        }
      }
    } catch (e) {
      console.warn(`[DecoderConfig] Failed to parse SPS from ${type} stream:`, e)
    }
  }

  return null
}

export function isKeyFrame(data: Uint8Array): boolean {
  return !!getNaluFromStream(data, NaluTypes.IDR)
}
