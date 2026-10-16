export interface ScoreNote {
  /** 長さ(4分音符=1拍) */
  beats: number
  /** 主音からの音階上の位置(0=主音, 7=1オクターブ上, -1=1オクターブ下の7度)。休符は null */
  step: number | null
}

export interface Score {
  /** 調号(VexFlowの表記)。現在はハ長調のみ */
  key: 'C'
  beatsPerBar: number
  bars: ScoreNote[][]
  seed: number
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b']

/** ハ長調の主音は中央ド(MIDI 60) */
const TONIC_MIDI = 60

const mod = (n: number, m: number) => ((n % m) + m) % m

export function stepToMidi(step: number): number {
  return TONIC_MIDI + 12 * Math.floor(step / 7) + MAJOR_SCALE[mod(step, 7)]
}

/** VexFlowの音の表記("c/4"など)。ハ長調なので臨時記号は不要 */
export function stepToVexKey(step: number): string {
  return `${LETTERS[mod(step, 7)]}/${4 + Math.floor(step / 7)}`
}

const DURATIONS: Record<number, string> = {
  4: 'w',
  3: 'hd',
  2: 'h',
  1.5: 'qd',
  1: 'q',
  0.75: '8d',
  0.5: '8',
  0.25: '16',
}

export function beatsToVexDuration(beats: number): string {
  const d = DURATIONS[beats]
  if (!d) throw new Error(`未対応の音価: ${beats}`)
  return d
}
