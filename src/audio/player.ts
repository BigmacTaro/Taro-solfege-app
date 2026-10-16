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
  /** 旋律(お手本)を鳴らす */
  melody: boolean
  /** 本編中もクリックを鳴らす。カウントインは常に鳴る */
  click: boolean
  onBeat?: (info: BeatInfo) => void
  onEnd?: () => void
}

export interface PlayHandle {
  stop(): void
}

/** カウントイン(1小節)のあと、楽譜の全小節を再生する */
export function playScore(score: Score, opts: PlayOptions): PlayHandle {
  const spb = 60 / opts.tempo
  const perBar = score.beatsPerBar
  const draw = Tone.getDraw()

  const clickSynth = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
    volume: -14,
  }).toDestination()
  const melodySynth = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.25 },
    volume: -6,
  }).toDestination()

  const t0 = Tone.now() + 0.15
  const click = (beatIndex: number, accent: boolean) =>
    clickSynth.triggerAttackRelease(accent ? 1760 : 1175, 0.03, t0 + beatIndex * spb)
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
        const freq = Tone.Frequency(stepToMidi(n.step), 'midi').toFrequency()
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
      clickSynth.dispose()
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
    stop() {
      if (stopped) return
      stopped = true
      draw.cancel()
      clearTimeout(disposeTimer)
      clickSynth.dispose()
      melodySynth.dispose()
      opts.onEnd?.()
    },
  }
}
