import type { Score, ScoreNote } from './score'

/** 負の値は休符(長さは絶対値) */
type Rhythm = number[]

// 初級: ハ長調・4/4・最短は八分音符。八分音符は拍の頭から2つ組で置く
const NORMAL_RHYTHMS: [Rhythm, number][] = [
  [[1, 1, 1, 1], 4],
  [[2, 1, 1], 2],
  [[1, 1, 2], 2],
  [[2, 2], 2],
  [[1, 0.5, 0.5, 1, 1], 2],
  [[0.5, 0.5, 1, 1, 1], 2],
  [[1, 1, 0.5, 0.5, 1], 2],
  [[1.5, 0.5, 1, 1], 2],
  [[1, 1, 1.5, 0.5], 1.5],
  [[0.5, 0.5, 0.5, 0.5, 1, 1], 1],
  [[3, 1], 1],
  [[4], 0.5],
]
const REST_RHYTHMS: [Rhythm, number][] = [
  [[1, 1, 1, -1], 1],
  [[3, -1], 1],
]
const FINAL_RHYTHMS: [Rhythm, number][] = [
  [[4], 0.65],
  [[3, -1], 0.35],
]

// 各小節の和音(I=0, IV=3, V=4)。前半は属音で問い、後半は主音で答えて終わる
const BAR_ROOTS = [0, 3, 0, 4, 0, 3, 4, 0]
const CHORD_TONES = (root: number) => new Set([root % 7, (root + 2) % 7, (root + 4) % 7])

const STEP_LO = -2
const STEP_HI = 7

const mod = (n: number, m: number) => ((n % m) + m) % m

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number

function weighted<T>(rng: Rng, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [v, w] of items) {
    r -= w
    if (r <= 0) return v
  }
  return items[items.length - 1][0]
}

const sameRhythm = (a: Rhythm, b: Rhythm) => a.length === b.length && a.every((v, i) => v === b[i])

function rhythmPlan(rng: Rng): Rhythm[] {
  const noRestStart = (list: [Rhythm, number][]) => list.filter(([r]) => r[0] > 0)
  // 小節末が短い音符・休符のものは終止の小節に置かない
  const cadence = NORMAL_RHYTHMS.filter(([r]) => r[r.length - 1] >= 1)
  const all = [...NORMAL_RHYTHMS, ...REST_RHYTHMS]

  const r0 = weighted(rng, noRestStart(NORMAL_RHYTHMS))
  const r1 = rng() < 0.6 ? r0 : weighted(rng, noRestStart(NORMAL_RHYTHMS))
  const r2 = weighted(rng, all)
  const r3 = weighted(rng, cadence)
  const r4 = rng() < 0.7 ? r0 : weighted(rng, noRestStart(NORMAL_RHYTHMS))
  const r5 = rng() < 0.5 ? r1 : weighted(rng, all)
  const r6 = weighted(rng, cadence)
  const r7 = weighted(rng, FINAL_RHYTHMS)
  return [r0, r1, r2, r3, r4, r5, r6, r7]
}

function intervalWeight(d: number, beats: number): number {
  const a = Math.abs(d)
  const base = [1.2, 6, 3, 1, 0.5, 0.2][a] ?? 0
  // 八分音符では跳躍を控えめに
  return beats <= 0.5 && a >= 2 ? base * 0.3 : base
}

export function generateScore(seed = Math.floor(Math.random() * 2 ** 31)): Score {
  const rng = mulberry32(seed)
  const rhythms = rhythmPlan(rng)
  const bars: ScoreNote[][] = []

  let prev: number | null = null
  let prevInterval = 0

  const chooseStep = (
    beats: number,
    strong: boolean,
    barIndex: number,
    isLastInBar: boolean,
    isTwoBack: boolean,
  ): number => {
    if (prev === null) {
      return weighted(rng, [[0, 3], [2, 2], [4, 2]] as [number, number][])
    }
    const from = prev
    const chord = CHORD_TONES(BAR_ROOTS[barIndex])
    const build = (leapRule: boolean, cadenceRule: boolean) => {
      const cands: [number, number][] = []
      for (let s = STEP_LO; s <= STEP_HI; s++) {
        const d = s - from
        let w = intervalWeight(d, beats)
        if (w === 0) continue
        // 4度以上跳躍した後は、逆方向へ順次進行で戻る
        if (leapRule && Math.abs(prevInterval) >= 3) {
          if (Math.sign(d) !== -Math.sign(prevInterval) || Math.abs(d) > 2) continue
        }
        if (d === 0 && isTwoBack) continue
        const isChord = chord.has(mod(s, 7))
        w *= strong ? (isChord ? 5 : 0.3) : isChord ? 1.3 : 1
        if (cadenceRule && isLastInBar && barIndex === 3) {
          // 前半の終わりは属音(ソ)か2度(レ)で止まる
          const m = mod(s, 7)
          if (m !== 4 && m !== 1) continue
          if (m === 4) w *= 3
        }
        if (isLastInBar && barIndex === 6) {
          // 主音に解決しやすい音(レ・シ)を好む
          const m = mod(s, 7)
          w *= m === 1 || m === 6 ? 3 : m === 4 ? 1 : 0.5
        }
        cands.push([s, w])
      }
      return cands
    }
    // 条件を満たす音がないときは、まず跳躍後の進行の制約を、次に終止音の制約をゆるめる
    const found = [build(true, true), build(false, true), build(false, false)].find((c) => c.length)!
    return weighted(rng, found)
  }

  for (let b = 0; b < 8; b++) {
    // 前半の1小節目と同じリズムなら、旋律ごと反復することがある(AA')
    if (b === 4 && sameRhythm(rhythms[4], rhythms[0]) && rng() < 0.7) {
      const copy = bars[0].map((n) => ({ ...n }))
      bars.push(copy)
      const pitched = copy.filter((n) => n.step !== null)
      prev = pitched[pitched.length - 1].step
      prevInterval = pitched.length > 1 ? prev! - pitched[pitched.length - 2].step! : 0
      continue
    }

    const events = rhythms[b]
    const notes: ScoreNote[] = []
    const lastPitchedIdx = events.reduce((acc, e, i) => (e > 0 ? i : acc), -1)
    let pos = 0
    let twoBack: number | null = null
    events.forEach((e, i) => {
      const beats = Math.abs(e)
      if (e < 0) {
        notes.push({ beats, step: null })
      } else if (b === 7) {
        // 最後は主音で終わる(音域内で直前に近いほう)
        const target = prev !== null && Math.abs(7 - prev) < Math.abs(0 - prev) ? 7 : 0
        notes.push({ beats, step: target })
      } else {
        const strong = pos % 2 === 0
        const step = chooseStep(beats, strong, b, i === lastPitchedIdx, twoBack !== null && twoBack === prev)
        twoBack = prev
        prevInterval = prev === null ? 0 : step - prev
        prev = step
        notes.push({ beats, step })
      }
      pos += beats
    })
    bars.push(notes)
  }

  return { key: 'C', beatsPerBar: 4, bars, seed }
}
