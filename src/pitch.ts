export interface PitchResult {
  freq: number
  /** 1に近いほど周期性が明確(0〜1) */
  clarity: number
}

/** YINアルゴリズムによる基本周波数の推定。音が弱い/周期性が低いときは null */
export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  minFreq = 70,
  maxFreq = 1200,
  threshold = 0.15,
  minRms = 0.01,
): PitchResult | null {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  if (Math.sqrt(sum / buf.length) < minRms) return null

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq))
  const tauMax = Math.min(Math.floor(sampleRate / minFreq), buf.length >> 1)
  const w = buf.length - tauMax
  if (w <= 0 || tauMax <= tauMin) return null

  const cmnd = new Float32Array(tauMax + 1)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau <= tauMax; tau++) {
    let d = 0
    for (let i = 0; i < w; i++) {
      const diff = buf[i] - buf[i + tau]
      d += diff * diff
    }
    running += d
    cmnd[tau] = running === 0 ? 1 : (d * tau) / running
  }

  let tau = -1
  for (let t = tauMin; t < tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++
      tau = t
      break
    }
  }
  if (tau < 0) return null

  // 放物線補間でサンプル間の位置を求める
  const a = cmnd[tau - 1]
  const b = cmnd[tau]
  const c = cmnd[tau + 1]
  const denom = a - 2 * b + c
  const shift = denom === 0 ? 0 : (a - c) / (2 * denom)
  return { freq: sampleRate / (tau + shift), clarity: 1 - cmnd[tau] }
}

const NOTE_NAMES_JA = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ']
const NOTE_NAMES_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export interface NoteInfo {
  /** 小数を含むMIDIノート番号(A4=69) */
  midi: number
  /** 最も近い半音のMIDIノート番号 */
  nearest: number
  /** 最も近い半音からのずれ(セント、±50) */
  cents: number
  ja: string
  en: string
  octave: number
}

export function freqToNote(freq: number, a4 = 440): NoteInfo {
  const midi = 69 + 12 * Math.log2(freq / a4)
  const nearest = Math.round(midi)
  const pc = ((nearest % 12) + 12) % 12
  return {
    midi,
    nearest,
    cents: (midi - nearest) * 100,
    ja: NOTE_NAMES_JA[pc],
    en: NOTE_NAMES_EN[pc],
    octave: Math.floor(nearest / 12) - 1,
  }
}
