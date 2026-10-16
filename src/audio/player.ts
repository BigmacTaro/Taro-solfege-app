import * as Tone from 'tone'
import { stepToMidi, type Score } from '../music/score'

export interface BeatInfo {
  phase: 'countin' | 'play'
  /** 0始まりの小節番号(カウントインでは常に0) */
  bar: number
  /** 0始まりの拍番号 */
  beat: number
}

export interface PlayOptions {
  tempo: number
  /** 実音 − 記譜音 の半音数(移調楽器用)。旋律は実音で鳴らす */
  transpose?: number
  /** 最初の拍を鳴らすまでの余裕(秒)。マイクを開いた直後など、音の経路が落ち着くまで長めにとる */
  lead?: number
  /** 旋律(お手本)を鳴らす */
  melody: boolean
  /** 本編中もクリックを鳴らす。カウントインは常に鳴る */
  click: boolean
  onBeat?: (info: BeatInfo) => void
  onEnd?: () => void
}

export interface PlayHandle {
  stop(): void
  /** カウントインの最初の拍が鳴る時刻(AudioContextの時刻、秒) */
  startTime: number
}

/**
 * ウッドブロックの音を合成する。木の棒の響きに近い、整数倍でない倍音(1 : 2.76 : 5.4)が
 * 短時間で減衰する音に、打撃の瞬間のごく短いノイズを足している。
 * 音程の検出範囲(〜1000Hz)より上の帯域に主な成分があり、音程感も弱いので、
 * マイクに回り込んでも声や楽器の音と取り違えられにくい。
 */
const woodblockCache = new Map<string, AudioBuffer>()

function woodblockBuffer(sampleRate: number, accent: boolean): AudioBuffer {
  const key = `${sampleRate}:${accent}`
  const cached = woodblockCache.get(key)
  if (cached) return cached
  const f0 = accent ? 1500 : 1100
  const length = Math.floor(sampleRate * 0.14)
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext
  const buffer = raw.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  const partials: [number, number, number][] = [
    // [周波数の倍率, 振幅, 減衰の時定数(秒)]
    [1, 1, 0.022],
    [2.76, 0.55, 0.014],
    [5.4, 0.25, 0.008],
  ]
  let seed = 12345
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2147483648 - 1
  }
  let peak = 0
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    let v = 0
    for (const [ratio, amp, tau] of partials) v += amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f0 * ratio * t)
    v += 0.35 * Math.exp(-t / 0.002) * noise() // 打撃の瞬間
    data[i] = v
    peak = Math.max(peak, Math.abs(v))
  }
  const gain = 0.9 / peak
  for (let i = 0; i < length; i++) data[i] *= gain
  // 終わりのぷつっというノイズを避ける
  const fade = Math.floor(sampleRate * 0.01)
  for (let i = 0; i < fade; i++) data[length - 1 - i] *= i / fade
  woodblockCache.set(key, buffer)
  return buffer
}

/** カウントイン(1小節)のあと、楽譜の全小節を再生する */
export function playScore(score: Score, opts: PlayOptions): PlayHandle {
  const spb = 60 / opts.tempo
  const perBar = score.beatsPerBar
  const draw = Tone.getDraw()

  const rate = Tone.getContext().sampleRate
  const clickNormal = new Tone.Player(new Tone.ToneAudioBuffer(woodblockBuffer(rate, false))).toDestination()
  const clickAccent = new Tone.Player(new Tone.ToneAudioBuffer(woodblockBuffer(rate, true))).toDestination()
  clickNormal.volume.value = -3
  clickAccent.volume.value = -1
  const melodySynth = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.25 },
    volume: -6,
  }).toDestination()

  const t0 = Tone.now() + (opts.lead ?? 0.15)
  const click = (beatIndex: number, accent: boolean) =>
    (accent ? clickAccent : clickNormal).start(t0 + beatIndex * spb)
  const notify = (beatIndex: number, info: BeatInfo) =>
    draw.schedule(() => opts.onBeat?.(info), t0 + beatIndex * spb)

  for (let k = 0; k < perBar; k++) {
    click(k, k === 0)
    notify(k, { phase: 'countin', bar: 0, beat: k })
  }

  score.bars.forEach((bar, b) => {
    const barStart = perBar + b * perBar
    for (let k = 0; k < perBar; k++) {
      if (opts.click) click(barStart + k, k === 0)
      notify(barStart + k, { phase: 'play', bar: b, beat: k })
    }
    if (!opts.melody) return
    let pos = 0
    for (const n of bar) {
      if (n.step !== null) {
        const freq = Tone.Frequency(stepToMidi(n.step) + (opts.transpose ?? 0), 'midi').toFrequency()
        melodySynth.triggerAttackRelease(freq, n.beats * spb * 0.92, t0 + (barStart + pos) * spb)
      }
      pos += n.beats
    }
  })

  const total = perBar + score.bars.length * perBar
  let stopped = false
  let disposeTimer: ReturnType<typeof setTimeout> | undefined

  const cleanup = () => {
    // 余韻が切れないよう、少し待ってから片付ける
    disposeTimer = setTimeout(() => {
      clickNormal.dispose()
      clickAccent.dispose()
      melodySynth.dispose()
    }, 1500)
  }

  draw.schedule(() => {
    if (stopped) return
    stopped = true
    cleanup()
    opts.onEnd?.()
  }, t0 + total * spb)

  return {
    startTime: t0,
    stop() {
      if (stopped) return
      stopped = true
      draw.cancel()
      clearTimeout(disposeTimer)
      clickNormal.dispose()
      clickAccent.dispose()
      melodySynth.dispose()
      opts.onEnd?.()
    },
  }
}
