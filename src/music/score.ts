export type Level = 'beginner' | 'intermediate'
export type Mode = 'major' | 'minor'

export interface ScoreNote {
  /** 長さ(4分音符=1拍)。三連符は 1/3(八分三連)や 2/3(四分三連) */
  beats: number
  /** 主音からの音階上の位置(0=主音, 7=1オクターブ上, -1=1オクターブ下の7度)。休符は null */
  step: number | null
  /** 音階の音からの変化(半音)。短調の導音(第7音を半音上げる)で +1 */
  alter?: number
}

export interface KeyInfo {
  /** VexFlowの調号の指定("G"・"Bb"・"Em"・"F#m" など) */
  vex: string
  mode: Mode
  /** 主音の文字(0=C, 1=D, … 6=B) */
  tonicLetter: number
  /** 主音の変化記号(-1=♭, 0, +1=♯) */
  tonicAcc: number
  /** 主音のMIDI番号(55〜66の範囲で、歌いやすい高さに置く) */
  tonicMidi: number
  /** 日本語の調名 */
  ja: string
}

export interface Score {
  key: KeyInfo
  level: Level
  beatsPerBar: number
  bars: ScoreNote[][]
  seed: number
}

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b']
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11]
const SCALES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // 自然短音階
}

const mod = (n: number, m: number) => ((n % m) + m) % m

function makeKey(vex: string, mode: Mode, tonicLetter: number, tonicAcc: number, ja: string): KeyInfo {
  const pc = mod(NATURAL_PC[tonicLetter] + tonicAcc, 12)
  return { vex, mode, tonicLetter, tonicAcc, tonicMidi: 55 + mod(pc - 55, 12), ja }
}

/** 初級はハ長調のみ。中級は調号が3つまでの長調・短調 */
export const KEY_C_MAJOR = makeKey('C', 'major', 0, 0, 'ハ長調')
export const INTERMEDIATE_KEYS: KeyInfo[] = [
  KEY_C_MAJOR,
  makeKey('G', 'major', 4, 0, 'ト長調'),
  makeKey('D', 'major', 1, 0, 'ニ長調'),
  makeKey('A', 'major', 5, 0, 'イ長調'),
  makeKey('F', 'major', 3, 0, 'ヘ長調'),
  makeKey('Bb', 'major', 6, -1, '変ロ長調'),
  makeKey('Eb', 'major', 2, -1, '変ホ長調'),
  makeKey('Am', 'minor', 5, 0, 'イ短調'),
  makeKey('Em', 'minor', 2, 0, 'ホ短調'),
  makeKey('Bm', 'minor', 6, 0, 'ロ短調'),
  makeKey('F#m', 'minor', 3, 1, '嬰ヘ短調'),
  makeKey('Dm', 'minor', 1, 0, 'ニ短調'),
  makeKey('Gm', 'minor', 4, 0, 'ト短調'),
  makeKey('Cm', 'minor', 0, 0, 'ハ短調'),
]

/** 記譜上の音のMIDI番号(移調楽器の補正は含まない) */
export function noteMidi(score: Score, n: { step: number; alter?: number }): number {
  const k = score.key
  return k.tonicMidi + 12 * Math.floor(n.step / 7) + SCALES[k.mode][mod(n.step, 7)] + (n.alter ?? 0)
}

const ACCIDENTALS: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##' }

/** VexFlowの音の表記("f#/4"・"bb/3"など)。調号による臨時記号の省略は VexFlow 側に任せる */
export function noteVexKey(score: Score, n: { step: number; alter?: number }): string {
  const idx = mod(score.key.tonicLetter + n.step, 7)
  const midi = noteMidi(score, n)
  const nat = NATURAL_PC[idx]
  const oct = Math.round((midi - nat) / 12) - 1
  const acc = midi - (nat + 12 * (oct + 1))
  return `${LETTERS[idx]}${ACCIDENTALS[acc] ?? ''}/${oct}`
}

const DURATIONS: [number, string][] = [
  [4, 'w'],
  [3, 'hd'],
  [2, 'h'],
  [1.5, 'qd'],
  [1, 'q'],
  [0.75, '8d'],
  [2 / 3, 'q'], // 四分三連符
  [0.5, '8'],
  [1 / 3, '8'], // 八分三連符
  [0.25, '16'],
]

export function beatsToVexDuration(beats: number): string {
  const hit = DURATIONS.find(([b]) => Math.abs(b - beats) < 1e-6)
  if (!hit) throw new Error(`未対応の音価: ${beats}`)
  return hit[1]
}

/** 三連符の音価か(八分三連=1/3拍、四分三連=2/3拍) */
export function isTriplet(beats: number): boolean {
  return Math.abs(beats - 1 / 3) < 1e-6 || Math.abs(beats - 2 / 3) < 1e-6
}

/** 拍の位置が、拍の頭(1拍の整数位置)にあるか。浮動小数点の誤差を許す */
export function isOnBeat(pos: number): boolean {
  return Math.abs(pos - Math.round(pos)) < 1e-6
}

/** 調号に付く変化記号の数(楽譜の段頭の幅を決めるために使う) */
export function keySignatureCount(key: KeyInfo): number {
  const counts: Record<string, number> = {
    C: 0, G: 1, D: 2, A: 3, F: 1, Bb: 2, Eb: 3,
    Am: 0, Em: 1, Bm: 2, 'F#m': 3, Dm: 1, Gm: 2, Cm: 3,
  }
  return counts[key.vex] ?? 0
}
