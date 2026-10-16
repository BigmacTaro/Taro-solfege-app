export type Level = 'beginner' | 'intermediate' | 'advanced'
export type Mode = 'major' | 'minor'

export interface ScoreNote {
  /** 長さ(4分音符=1拍)。三連符は 1/3(八分三連)や 2/3(四分三連) */
  beats: number
  /** 主音からの音階上の位置(0=主音, 7=1オクターブ上, -1=1オクターブ下の7度)。休符は null */
  step: number | null
  /** 音階の音からの変化(半音)。短調の導音(第7音を半音上げる)で +1 */
  alter?: number
  /** 次の音符(同じ高さ。次の小節の最初でもよい)とタイで結ばれている。結ばれた音は1つの音として鳴らす */
  tie?: boolean
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

export type MeterId = '4/4' | '3/4' | '6/8'

/** 拍子。音符の長さ(beats)は、どの拍子でも4分音符=1の単位で表す */
export interface Meter {
  id: MeterId
  num: number
  den: number
  /** 1小節の長さ(4分音符の数) */
  barLen: number
  /** メトロノームの1拍の長さ(4分音符の数)。6/8は付点4分音符(1.5)で数える */
  beatLen: number
  /** 強拍の位置(小節の頭からの長さ、4分音符の数) */
  strong: number[]
  /** カウントインのクリック数(4/4は4つ、3/4は3つ、6/8は2拍×2小節で4つ) */
  countIn: number
}

export const METERS: Record<MeterId, Meter> = {
  '4/4': { id: '4/4', num: 4, den: 4, barLen: 4, beatLen: 1, strong: [0, 2], countIn: 4 },
  '3/4': { id: '3/4', num: 3, den: 4, barLen: 3, beatLen: 1, strong: [0], countIn: 3 },
  '6/8': { id: '6/8', num: 6, den: 8, barLen: 3, beatLen: 1.5, strong: [0, 1.5], countIn: 4 },
}

export interface Score {
  key: KeyInfo
  level: Level
  meter: Meter
  /** 1小節のメトロノームの拍の数(4/4は4、3/4は3、6/8は2) */
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

/** 調号4〜5つの調(上級で加わる) */
const ADVANCED_ONLY_KEYS: KeyInfo[] = [
  makeKey('E', 'major', 2, 0, 'ホ長調'),
  makeKey('Ab', 'major', 5, -1, '変イ長調'),
  makeKey('B', 'major', 6, 0, 'ロ長調'),
  makeKey('Db', 'major', 1, -1, '変ニ長調'),
  makeKey('C#m', 'minor', 0, 1, '嬰ハ短調'),
  makeKey('Fm', 'minor', 3, 0, 'ヘ短調'),
  makeKey('G#m', 'minor', 4, 1, '嬰ト短調'),
  makeKey('Bbm', 'minor', 6, -1, '変ロ短調'),
]
export const ADVANCED_KEYS: KeyInfo[] = [...INTERMEDIATE_KEYS, ...ADVANCED_ONLY_KEYS]

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
    E: 4, Ab: 4, B: 5, Db: 5, 'C#m': 4, Fm: 4, 'G#m': 5, Bbm: 5,
  }
  return counts[key.vex] ?? 0
}

/** 1拍(メトロノームの拍)の長さを秒で表すとき、4分音符1つ分の秒数 */
export function secondsPerQuarter(tempo: number, meter: Meter): number {
  return 60 / tempo / meter.beatLen
}

/** 実際に発音される音(タイで結ばれた音符は、1つにまとめる)。休符は含まない */
export interface SoundedNote {
  /** 先頭の音符の位置(小節番号、小節内の何番目か) */
  bar: number
  index: number
  step: number
  alter?: number
  /** タイで結ばれた分を含む長さ(4分音符=1) */
  beats: number
  /** 先頭の1小節目の頭からの位置(4分音符の数) */
  pos: number
  /** タイで結ばれた、後ろの音符の位置 */
  cont: { bar: number; index: number }[]
}

export function soundedNotes(score: Score): SoundedNote[] {
  const out: SoundedNote[] = []
  let last: SoundedNote | null = null
  let tied = false
  score.bars.forEach((bar, b) => {
    let pos = b * score.meter.barLen
    bar.forEach((n, i) => {
      if (n.step === null) {
        last = null
        tied = false
      } else if (tied && last) {
        // 前の音とタイで結ばれている続きの音符: 新しく鳴らさず、長さだけ足す
        last.beats += n.beats
        last.cont.push({ bar: b, index: i })
        tied = !!n.tie
      } else {
        last = { bar: b, index: i, step: n.step, alter: n.alter, beats: n.beats, pos, cont: [] }
        out.push(last)
        tied = !!n.tie
      }
      pos += n.beats
    })
  })
  return out
}
