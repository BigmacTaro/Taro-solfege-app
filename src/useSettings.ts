import { useEffect, useState } from 'react'
import { findInstrument, type Instrument } from './instruments'
import type { MicSettings } from './audio/mic'
import { load, save } from './storage'

/** マイク感度(増幅)の上限。以前の保存値がこれを超えていても、ここに収める */
export const MAX_GAIN = 5

export interface Settings {
  mic: MicSettings
  /** 打ち込み・発音の遅れの補正(ミリ秒)。マイク入力やBluetoothの遅延を打ち消す */
  latencyMs: number
  instrument: Instrument
  /** 上級者モード: 短すぎる音も指摘する */
  checkShort: boolean
  /** マイクを開いたときに取得した入力デバイスの一覧 */
  devices: MediaDeviceInfo[]
  setDevices(v: MediaDeviceInfo[]): void
  setGain(v: number): void
  setAgc(v: boolean): void
  setNs(v: boolean): void
  setDeviceId(v: string): void
  setLatencyMs(v: number): void
  setInstrumentId(id: string): void
  setCheckShort(v: boolean): void
}

/** タッチ操作の端末(スマホ・タブレット)か。iPadのSafariは、Macと同じ表示でも、複数のタッチ点を持つ */
function isTouchDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1
  } catch {
    return false
  }
}

/** マイク感度の初期値: スマホ・タブレットは、入力が小さいので×3.0、パソコンは×1.0 */
const defaultGain = () => (isTouchDevice() ? 3 : 1)

/** マイク・楽器の設定。端末に保存する */
export function useSettings(): Settings {
  const [gain, setGain] = useState(() => Math.min(MAX_GAIN, Math.max(1, load('gain', defaultGain()))))
  const [agc, setAgc] = useState(() => load('agc', true))
  const [ns, setNs] = useState(() => load('ns', false))
  const [deviceId, setDeviceId] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [latencyMs, setLatencyMs] = useState(() => load('latencyMs', 0))
  const [checkShort, setCheckShort] = useState(() => load('checkShort', false))
  const [instrumentId, setInstrumentId] = useState(() => load('instrument', 'c'))

  useEffect(() => save('gain', gain), [gain])
  useEffect(() => save('agc', agc), [agc])
  useEffect(() => save('ns', ns), [ns])
  useEffect(() => save('latencyMs', latencyMs), [latencyMs])
  useEffect(() => save('instrument', instrumentId), [instrumentId])
  useEffect(() => save('checkShort', checkShort), [checkShort])

  return {
    mic: { gain, agc, ns, deviceId },
    latencyMs,
    instrument: findInstrument(instrumentId),
    checkShort,
    setCheckShort,
    devices,
    setDevices,
    setGain,
    setAgc,
    setNs,
    setDeviceId,
    setLatencyMs,
    setInstrumentId,
  }
}
