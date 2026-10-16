import type { PitchFrame } from '../audio/mic'
import { noteMidi, type Score } from '../music/score'
import { NOTE_NAMES_JA } from '../pitch'

export interface EvalParams {
  tempo: number
  /** カウントインの最初の拍の時刻(秒) */
  t0: number
  /** 実音 − 記譜音 の半音数(移調楽器) */
  transpose: number
  /** 入力の遅れの補正(ミリ秒)。録音された音が実際より遅れて届く分を打ち消す */
  latencyMs: number
  /** 課題の本編中もクリックを鳴らしていたか(カウントインは常に鳴る)。スピーカーから回り込んだクリック音を除くために使う */
  clickDuringBars?: boolean
  /** 上級者モード: 音が短すぎる(期待の半分未満)ことも指摘する。標準では評価しない */
  checkShort?: boolean
}

export interface ExpectedNote {
  bar: number
  /** 小節内の何番目の音符/休符か */
  index: number
  isRest: boolean
  /** 実音のMIDI番号(休符は null) */
  midi: number | null
  beats: number
  start: number
  dur: number
}

/** 聞き取れた1つの音(同じ高さが続く区間) */
export interface Observed {
  onset: number
  end: number
  /** 代表の高さ(MIDI番号、小数)。オクターブは当てにならない */
  midi: number
}

export interface NoteVerdict {
  isRest: boolean
  expectedMidi: number | null
  /** 対応する音が聞き取れなかった */
  missed: boolean
  /** 実際の音高の、期待との差(セント、オクターブ違いは同じ扱い)。±50セント以内で正解 */
  centsOff: number | null
  /** 実際に出した音の名前(ドレミ) */
  sungName: string | null
  pitchOk: boolean
  /** 発音タイミングのずれ(秒、正は遅れ) */
  timingErrSec: number | null
  /** 同(拍) */
  timingErrBeats: number | null
  timingOk: boolean
  /** 音が短すぎる / 休符のはずなのに音が続いた */
  duration: 'short' | 'long' | null
  /** 休符で休めていない(休符のみ) */
  restBroken: boolean
  /** 同じ高さの連打が1つの音にまとまって聞こえ、区切りを確かめられなかった(正解扱い) */
  merged: boolean
}

export interface Summary {
  noteCount: number
  pitchOk: number
  timingOk: number
  missed: number
  /** 楽譜にない余計な音の数 */
  extra: number
  durationIssues: number
  restBroken: number
  /** 音高とタイミングの正解率(0〜100) */
  percent: number
}

export interface EvalResult {
  verdicts: NoteVerdict[][]
  summary: Summary
  expected: ExpectedNote[]
  observed: Observed[]
  /** タイミングの許容(秒): その楽譜で使われた最短の音符1つ分 */
  tolSec: number
}

const FRAME_DT = 0.016
/** これより長い無声の隙間は、そこで音が切れたとみなす(子音程度の隙間はつなぐ) */
const MAX_GAP = 0.06
/** 短い隙間でも、その前後で高さが少しでも変わっていれば別の音とみなす */
const SHORT_GAP = 0.03
const SHORT_GAP_JUMP = 0.3
const JUMP_SEMITONES = 0.7
const JUMP_FRAMES = 3
const MIN_SEGMENT = 0.06
const PITCH_TOL_CENTS = 50
/** クリック音がマイクに回り込んだものとみなす条件: クリックの後この時間内に始まり、この長さより短い */
const BLEED_WINDOW = 0.35
const BLEED_MAX_DUR = 0.12

interface VFrame {
  t: number
  midi: number
  rel: number
  rms: number
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/** 12の倍数(オクターブ)を無視した差。-6〜+6半音 */
const fold = (d: number) => d - 12 * Math.round(d / 12)

/** 声や楽器の自然な発音(再発音)で音量が一度落ちて戻る所で分割する(同音連打) */
function splitByEnergy(fr: VFrame[]): VFrame[][] {
  const n = fr.length
  if (n < 20) return [fr]
  const sm = fr.map((_, i) => {
    const a = fr.slice(Math.max(0, i - 1), i + 2)
    return a.reduce((s, x) => s + x.rms, 0) / a.length
  })
  const cuts: number[] = []
  for (let i = 6; i < n - 6; i++) {
    let isMin = true
    for (let k = -6; k <= 6; k++) {
      if (sm[i + k] < sm[i]) {
        isMin = false
        break
      }
    }
    if (!isMin) continue
    const left = Math.max(...sm.slice(Math.max(0, i - 14), i + 1))
    const right = Math.max(...sm.slice(i, Math.min(n, i + 15)))
    if (sm[i] < 0.55 * Math.min(left, right) && (cuts.length === 0 || i - cuts[cuts.length - 1] > 8)) cuts.push(i)
  }
  const pieces: VFrame[][] = []
  let from = 0
  for (const c of [...cuts, n]) {
    pieces.push(fr.slice(from, c))
    from = c
  }
  return pieces
}

function pushSegments(frames: VFrame[], out: Observed[]) {
  for (const piece of splitByEnergy(frames)) {
    if (piece.length === 0) continue
    const dur = piece[piece.length - 1].t - piece[0].t + FRAME_DT
    if (dur < MIN_SEGMENT) continue
    const base = piece[0].midi
    // 出だしは音程が定まらないことが多いので、頭の4分の1を除いた中央値を使う
    let used = piece.slice(Math.floor(piece.length * 0.25))
    if (used.length < 3) used = piece
    const rel = median(used.map((x) => fold(x.midi - base)))
    out.push({ onset: piece[0].t, end: piece[piece.length - 1].t + FRAME_DT, midi: base + rel })
  }
}

/** ピッチの時系列を、1音ずつの区間に分ける */
export function segmentFrames(frames: PitchFrame[]): Observed[] {
  const out: Observed[] = []
  let cur: VFrame[] = []
  let pending: VFrame[] = []
  let lastT = -Infinity

  const close = () => {
    if (cur.length) pushSegments(cur, out)
    cur = []
    pending = []
  }

  for (const f of frames) {
    if (f.freq === null) continue
    const midi = 69 + 12 * Math.log2(f.freq / 440)
    const gap = f.t - lastT
    if (cur.length) {
      const relNow = fold(midi - cur[0].midi)
      const recentNow = median(cur.slice(-5).map((x) => x.rel))
      if (gap > MAX_GAP || (gap > SHORT_GAP && Math.abs(relNow - recentNow) > SHORT_GAP_JUMP)) close()
    }
    lastT = f.t
    if (cur.length === 0) {
      cur = [{ t: f.t, midi, rel: 0, rms: f.rms }]
      continue
    }
    const rel = fold(midi - cur[0].midi)
    const recent = median(cur.slice(-5).map((x) => x.rel))
    if (Math.abs(rel - recent) > JUMP_SEMITONES) {
      // 高さが数フレーム続けて変わったら、次の音とみなす
      pending.push({ t: f.t, midi, rel, rms: f.rms })
      if (pending.length >= JUMP_FRAMES) {
        const next = pending
        pending = []
        pushSegments(cur, out)
        cur = next.map((x) => ({ ...x, rel: fold(x.midi - next[0].midi) }))
      }
      continue
    }
    pending = []
    cur.push({ t: f.t, midi, rel, rms: f.rms })
  }
  close()
  return out
}

export function buildExpected(score: Score, p: Pick<EvalParams, 'tempo' | 't0' | 'transpose'>): ExpectedNote[] {
  const spb = 60 / p.tempo
  const { beatLen, countIn } = score.meter
  const bars0 = p.t0 + countIn * spb // カウントインのあと
  const out: ExpectedNote[] = []
  score.bars.forEach((bar, b) => {
    let pos = 0
    bar.forEach((n, i) => {
      out.push({
        bar: b,
        index: i,
        isRest: n.step === null,
        midi: n.step === null ? null : noteMidi(score, { step: n.step, alter: n.alter }) + p.transpose,
        beats: n.beats,
        // 音符の長さ・位置は4分音符=1の単位。メトロノームの1拍(beatLen)で割って秒にする
        start: bars0 + (b * score.beatsPerBar + pos / beatLen) * spb,
        dur: (n.beats / beatLen) * spb,
      })
      pos += n.beats
    })
  })
  return out
}

/** 期待する音(順番どおり)と聞き取れた音(順番どおり)を、ずれが最小になるよう対応づける */
function matchNotes(notes: ExpectedNote[], segs: Observed[], window: number): number[] {
  const MISS = 1
  const EXTRA = 0.6
  const N = notes.length
  const M = segs.length
  const dp = Array.from({ length: N + 1 }, () => new Array<number>(M + 1).fill(Infinity))
  const from = Array.from({ length: N + 1 }, () => new Array<number>(M + 1).fill(0))
  dp[0][0] = 0
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= M; j++) {
      const here = dp[i][j]
      if (here === Infinity) continue
      if (i < N && here + MISS < dp[i + 1][j]) {
        dp[i + 1][j] = here + MISS
        from[i + 1][j] = 1
      }
      if (j < M && here + EXTRA < dp[i][j + 1]) {
        dp[i][j + 1] = here + EXTRA
        from[i][j + 1] = 2
      }
      if (i < N && j < M) {
        const dev = Math.abs(segs[j].onset - notes[i].start)
        if (dev <= window) {
          // 時間が近いほど、また高さが同じほど、対応づけやすい(遅れた音と次の音を取り違えにくくする)
          const pitchMiss = Math.abs(fold(segs[j].midi - notes[i].midi!)) > 0.6 ? 0.35 : 0
          const c = here + (dev / window) * 0.6 + pitchMiss
          if (c < dp[i + 1][j + 1]) {
            dp[i + 1][j + 1] = c
            from[i + 1][j + 1] = 3
          }
        }
      }
    }
  }
  const matchOf = new Array<number>(N).fill(-1)
  let i = N
  let j = M
  while (i > 0 || j > 0) {
    const f = from[i][j]
    if (f === 3) {
      matchOf[i - 1] = j - 1
      i--
      j--
    } else if (f === 1) i--
    else j--
  }
  return matchOf
}

/** マイクの記録を楽譜と照合して評価する */
export function evaluate(score: Score, frames: PitchFrame[], p: EvalParams): EvalResult {
  const spb = 60 / p.tempo
  const expected = buildExpected(score, p)
  const noteEvents = expected.filter((e) => !e.isRest)
  const tol = (Math.min(...noteEvents.map((e) => e.beats)) / score.meter.beatLen) * spb
  const window = tol + 0.5 * spb
  const lat = p.latencyMs / 1000

  const bars0 = p.t0 + score.meter.countIn * spb
  const endOfPiece = bars0 + score.bars.length * score.beatsPerBar * spb
  // 録音の遅れを補正し、カウントインより前(クリック・準備の音)は対象にしない
  const shifted = frames
    .map((f) => ({ ...f, t: f.t - lat }))
    .filter((f) => f.t >= bars0 - window && f.t <= endOfPiece + 0.8)
  // スピーカーのクリック音が回り込んで音程として検出された、短い断片は無視する
  const clickTimes: number[] = []
  for (let k = 0; k < score.meter.countIn + (p.clickDuringBars ? score.beatsPerBar * score.bars.length : 0); k++) {
    clickTimes.push(p.t0 + k * spb)
  }
  const observed = segmentFrames(shifted).filter((o) => {
    const isBleed = o.end - o.onset < BLEED_MAX_DUR && clickTimes.some((c) => o.onset >= c - 0.05 && o.onset <= c + BLEED_WINDOW)
    return !isBleed
  })
  const matchOf = matchNotes(noteEvents, observed, window)

  // 同じ高さの連打は、息や舌で区切らないと1つの音にまとまって聞こえる(特に速い連打)。
  // 直前の音と同じ高さで、その音の長さが次の音まで続いているなら、区切りは確かめられないが演奏されたものとみなす
  const noteExpIndex = expected.flatMap((e, i) => (e.isRest ? [] : [i]))
  const mergedInto = new Map<number, number>()
  for (let i = 1; i < noteEvents.length; i++) {
    if (matchOf[i] >= 0) continue
    const prevIdx = i - 1
    const j = matchOf[prevIdx] >= 0 ? matchOf[prevIdx] : (mergedInto.get(prevIdx) ?? -1)
    if (j < 0) continue
    // 間に休符がなく、同じ高さの音どうし
    if (noteExpIndex[i] - noteExpIndex[prevIdx] !== 1) continue
    if (Math.abs(fold(noteEvents[i].midi! - noteEvents[prevIdx].midi!)) > 1e-6) continue
    const seg = observed[j]
    const e = noteEvents[i]
    if (seg.onset <= e.start + tol && seg.end >= e.start + 0.5 * e.dur) mergedInto.set(i, j)
  }

  const verdicts: NoteVerdict[][] = score.bars.map((b) => b.map(() => emptyVerdict()))
  let ni = 0
  const used = new Set<number>()
  expected.forEach((e, idx) => {
    const v = verdicts[e.bar][e.index]
    if (e.isRest) {
      v.isRest = true
      // 休符の長さに比例した範囲で、音が続いていないかを見る(短い休符でも判定できる)
      const lo = e.start + 0.3 * e.dur
      const hi = e.start + 0.9 * e.dur
      const inside = shifted.filter((f) => f.t >= lo && f.t <= hi)
      const voiced = inside.filter((f) => f.freq !== null).length
      v.restBroken = inside.length > 0 && voiced / inside.length > 0.4
      return
    }
    const noteIdx = ni++
    const merged = matchOf[noteIdx] < 0 ? mergedInto.get(noteIdx) : undefined
    const j = merged ?? matchOf[noteIdx]
    v.expectedMidi = e.midi
    if (j < 0) {
      v.missed = true
      return
    }
    if (merged !== undefined) {
      // 区切りが聞き取れなかった連打: 高さは同じ音なので正解、タイミングは測れないので正解扱い
      v.merged = true
      v.centsOff = 100 * fold(observed[j].midi - e.midi!)
      v.pitchOk = Math.abs(v.centsOff) <= PITCH_TOL_CENTS
      v.sungName = NOTE_NAMES_JA[((Math.round(observed[j].midi) % 12) + 12) % 12]
      v.timingErrSec = 0
      v.timingErrBeats = 0
      v.timingOk = true
      return
    }
    used.add(j)
    const seg = observed[j]
    const cents = 100 * fold(seg.midi - e.midi!)
    v.centsOff = cents
    v.pitchOk = Math.abs(cents) <= PITCH_TOL_CENTS
    v.sungName = NOTE_NAMES_JA[((Math.round(seg.midi) % 12) + 12) % 12]
    v.timingErrSec = seg.onset - e.start
    v.timingErrBeats = v.timingErrSec / spb
    v.timingOk = Math.abs(v.timingErrSec) <= tol
    // 長さ: (上級者モードのみ)期待の半分未満しか鳴っていなければ短すぎる。休符の前で伸ばしすぎは常に指摘
    const next = expected[idx + 1]
    if (p.checkShort && seg.end - seg.onset < 0.45 * e.dur) v.duration = 'short'
    else if (next?.isRest && seg.end > e.start + e.dur + 0.4 * spb) v.duration = 'long'
  })

  const flat = verdicts.flat().filter((v) => !v.isRest)
  const summary: Summary = {
    noteCount: flat.length,
    pitchOk: flat.filter((v) => v.pitchOk).length,
    timingOk: flat.filter((v) => v.timingOk).length,
    missed: flat.filter((v) => v.missed).length,
    extra: observed.length - used.size,
    durationIssues: flat.filter((v) => v.duration !== null).length,
    restBroken: verdicts.flat().filter((v) => v.restBroken).length,
    percent: 0,
  }
  summary.percent = Math.round((100 * (summary.pitchOk + summary.timingOk)) / (2 * summary.noteCount))
  return { verdicts, summary, expected, observed, tolSec: tol }
}

function emptyVerdict(): NoteVerdict {
  return {
    isRest: false,
    expectedMidi: null,
    missed: false,
    centsOff: null,
    sungName: null,
    pitchOk: false,
    timingErrSec: null,
    timingErrBeats: null,
    timingOk: false,
    duration: null,
    restBroken: false,
    merged: false,
  }
}
