import { useEffect, useState } from 'react'
import { findInstrument, type Instrument } from './instruments'
import type { MicSettings } from './audio/mic'
import { load, save } from './storage'

export interface Settings {
  mic: MicSettings
  /** 打ち込み・発音の遅れの補正(ミリ秒)。マイク入力やBluetoothの遅延を打ち消す */
  latencyMs: number
  instrument: Instrument
  /** マイクを開いたときに取得した入力デバイスの一覧 */
  devices: MediaDeviceInfo[]
  setDevices(v: MediaDeviceInfo[]): void
  setGain(v: number): void
  setAgc(v: boolean): void
  setNs(v: boolean): void
  setDeviceId(v: string): void
  setLatencyMs(v: number): void
  setInstrumentId(id: string): void
}

/** マイク・楽器の設定。端末に保存する */
export function useSettings(): Settings {
  const [gain, setGain] = useState(() => load('gain', 1))
  const [agc, setAgc] = useState(() => load('agc', true))
  const [ns, setNs] = useState(() => load('ns', false))
  const [deviceId, setDeviceId] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [latencyMs, setLatencyMs] = useState(() => load('latencyMs', 0))
  const [instrumentId, setInstrumentId] = useState(() => load('instrument', 'c'))

  useEffect(() => save('gain', gain), [gain])
  useEffect(() => save('agc', agc), [agc])
  useEffect(() => save('ns', ns), [ns])
  useEffect(() => save('latencyMs', latencyMs), [latencyMs])
  useEffect(() => save('instrument', instrumentId), [instrumentId])

  return {
    mic: { gain, agc, ns, deviceId },
    latencyMs,
    instrument: findInstrument(instrumentId),
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
