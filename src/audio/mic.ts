import * as Tone from 'tone'
import { detectPitch } from '../pitch'
import { setAudioSession } from './session'

export interface MicSettings {
  /** ソフトウェアでの増幅(iPhoneなど入力が小さい端末向け) */
  gain: number
  /** 自動音量調整 */
  agc: boolean
  /** ノイズ抑制 */
  ns: boolean
  /** 入力デバイス(空なら既定) */
  deviceId: string
}

export interface PitchFrame {
  /** AudioContextの時刻(秒)。解析した窓の中心 */
  t: number
  freq: number | null
  rms: number
}

export interface MicHandle {
  setGain(gain: number): void
  devices: MediaDeviceInfo[]
  stop(): void
}

const FFT_SIZE = 2048
/** 解析の間隔(ミリ秒) */
const FRAME_MS = 16
/** クリック音(2400Hz〜)より十分低く、歌や楽器の高めの音までを検出する範囲 */
const MIN_FREQ = 70
const MAX_FREQ = 1000

/**
 * マイクを開き、フレームごとの基本周波数を通知する。
 * 時刻の基準を揃えるため、メトロノームと同じAudioContext(Tone.js)を使う。
 */
export async function startMic(
  settings: MicSettings,
  onFrame: (frame: PitchFrame) => void,
): Promise<MicHandle> {
  await Tone.start()
  const ctx = Tone.getContext().rawContext as unknown as AudioContext
  // echoCancellation は常に切る。AGC/ノイズ抑制は端末によって効き方が違うので設定で切り替える
  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: false,
      noiseSuppression: settings.ns,
      autoGainControl: settings.agc,
      ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {}),
    },
  }
  // iPhoneのSafariでは、音声セッションの種類が録音に向かないもの(再生専用など)のままだと、
  // 「Audiosession category is not compatible with audio capture」でマイクを開けない。
  // 開く前に、録音と再生ができる種類にする。それでも失敗したら、既定に戻してもう一度試す
  setAudioSession('play-and-record')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints)
  } catch (e) {
    if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e
    setAudioSession('auto')
    await new Promise((resolve) => setTimeout(resolve, 150))
    setAudioSession('play-and-record')
    stream = await navigator.mediaDevices.getUserMedia(constraints)
  }
  // 許可後でないとデバイス名が取れない
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')

  const source = ctx.createMediaStreamSource(stream)
  const gainNode = ctx.createGain()
  gainNode.gain.value = settings.gain
  const analyser = ctx.createAnalyser()
  analyser.fftSize = FFT_SIZE
  source.connect(gainNode)
  gainNode.connect(analyser)

  const buf = new Float32Array(FFT_SIZE)
  let stopped = false
  const tick = () => {
    if (stopped) return
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    const r = detectPitch(buf, ctx.sampleRate, MIN_FREQ, MAX_FREQ)
    onFrame({ t: ctx.currentTime - FFT_SIZE / 2 / ctx.sampleRate, freq: r ? r.freq : null, rms })
  }
  // 描画の更新(requestAnimationFrame)に頼らず、一定間隔で標本を取る。画面の更新が間引かれても記録が欠けない
  const timer = setInterval(tick, FRAME_MS)
  tick()

  return {
    devices,
    setGain(g) {
      gainNode.gain.value = g
    },
    stop() {
      stopped = true
      clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      source.disconnect()
      gainNode.disconnect()
      // マイクを使い終えたら、音声セッションを既定に戻す(録音用のまま残さない)
      setAudioSession('auto')
    },
  }
}

export function micErrorMessage(e: unknown): string {
  if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
    return 'マイクの使用が許可されていません。ブラウザの設定で許可してください。'
  }
  return `マイクを開始できませんでした: ${e instanceof Error ? e.message : String(e)}`
}
