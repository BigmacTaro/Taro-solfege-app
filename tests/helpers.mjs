// テスト用の共通部品: コンパイル済みのロジックの読み込みと、合成した「演奏」の作成。
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const { generateScore } = require('../.test-build/music/generator.js')
export const scoreLib = require('../.test-build/music/score.js')
export const evalLib = require('../.test-build/eval/evaluate.js')

export const near = (a, b) => Math.abs(a - b) < 1e-6
export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12)
export const FRAME_DT = 0.016

export const BASE = { tempo: 90, t0: 10, transpose: 0, latencyMs: 0 }

/** 最短の(発音される)音符の許容(秒) */
export function toleranceOf(score, params = BASE) {
  const shortest = Math.min(...scoreLib.soundedNotes(score).map((n) => n.beats))
  return (shortest / score.meter.beatLen) * (60 / params.tempo)
}

/**
 * 楽譜どおりの音を鳴らした、マイクのフレーム列を合成する(ビブラートつき)。
 * opts: allLate(全体の遅れ秒), cents({k: セント}), late({k: 秒}), missing([k]), short([k]), octaves(true), breakRest(true)
 */
export function perform(score, params, opts = {}) {
  const expected = evalLib.buildExpected(score, params)
  const frames = []
  for (let t = params.t0; t < params.t0 + 90; t += FRAME_DT) frames.push({ t, freq: null, rms: 0.001 })
  const at = (t) => frames[Math.round((t - params.t0) / FRAME_DT)]
  let k = 0
  for (const e of expected) {
    if (e.isRest) {
      if (opts.breakRest) {
        for (let t = e.start + 0.3 * e.dur; t < e.start + 0.9 * e.dur; t += FRAME_DT) {
          const f = at(t)
          if (f) {
            f.freq = midiToFreq(60 + params.transpose)
            f.rms = 0.1
          }
        }
      }
      continue
    }
    const idx = k++
    if (opts.missing?.includes(idx)) continue
    const late = opts.late?.[idx] ?? opts.allLate ?? 0
    const cents = opts.cents?.[idx] ?? 0
    const octave = opts.octaves ? 12 * ((idx % 3) - 1) : 0
    const dur = opts.short?.includes(idx) ? e.dur * 0.25 : e.dur * 0.95
    for (let t = e.start + late; t < e.start + late + dur; t += FRAME_DT) {
      const f = at(t)
      if (!f) continue
      const el = t - (e.start + late)
      const vibrato = 0.15 * Math.sin(el * 2 * Math.PI * 5.5)
      f.freq = midiToFreq(e.midi + cents / 100 + vibrato + octave)
      f.rms = 0.12 * Math.min(1, el / 0.05) * (el > dur - 0.06 ? 0.3 : 1)
    }
  }
  return frames
}

/** 音のある(休符でない)、タイの続きでない判定結果だけを並べる */
export const noteVerdicts = (result) => result.verdicts.flat().filter((v) => !v.isRest && !v.tiedCont)
