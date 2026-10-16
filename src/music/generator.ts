import {
  ADVANCED_KEYS,
  DEFAULT_CUSTOM,
  INTERMEDIATE_KEYS,
  KEY_C_MAJOR,
  METERS,
  churchKeys,
  isOnBeat,
  isTriplet,
  keySignatureCount,
  type CustomOptions,
  type KeyInfo,
  type Level,
  type Meter,
  type MeterId,
  type Mode,
  type Score,
  type ScoreNote,
} from './score'

/**
 * 8小節の旋律の自動生成。
 * - 初級: ハ長調・4/4、最短は八分音符。
 * - 中級: 4/4と3/4、調号3つまでの長調・短調。シンコペーション(タイを伴うもの、小節をまたぐものを含む)や三連符を含む。
 * - 上級: 4/4・3/4・6/8、調号5つまでの長調・短調。十六分音符や付点のリズム、シンコペーション、三連符(6/8を除く)を含む。
 *
 * 楽典の考え方に沿って作る。
 * - 構造: 動機(2小節) → 前楽節(4小節、半終止) + 後楽節(4小節、完全終止) の大楽節。
 *   平行楽節(同じ動機で始まる)と対照楽節(後半で別のリズムを使う)をランダムに選ぶ。
 * - 和声: 小節ごとに I・IV・V(短調では i・iv・V)を割り当て、強拍には和声音を置く。長い音は和声音に限る。
 * - 非和声音: 経過音・刺繍音として弱拍に順次進行で置く。傾向音(第4音・導音)は解決させる。
 * - 短調: 属和音(V)の小節では第7音を半音上げて導音にする(和声的短音階)。
 *   第6音と上がった第7音の間(増2度)は歌いにくいので、順次進行で行き来しない。
 * - 動きの自然さ: 順次進行が中心、大きな跳躍の後は反対方向へ順次進行で戻る。
 * - 終止: 4小節目は第5音か第2音で半終止、7小節目は第2音か導音で終わって最後の主音へ解決する。
 * - 全体の形: たくさん候補を作り、山(クライマックス)や音域、ジグザグ具合などで採点して選ぶ。
 */

/** 負の値は休符(長さは絶対値) */
type Rhythm = number[]
/** タイで次の音と結ぶ音符: [動機の何小節目(0か1), 小節内の何番目の音符か] */
type Ties = [number, number][]
type Motif = [Rhythm, Rhythm] | [Rhythm, Rhythm, Ties]

/** 動機の指定した小節で、タイで次と結ぶ音符の番号 */
const tiesOf = (m: Motif, barInMotif: number): number[] =>
  (m[2] ?? []).filter(([b]) => b === barInMotif).map(([, i]) => i)

const T = 1 / 3 // 八分三連符
const Q = 2 / 3 // 四分三連符

/** 2小節のリズム動機。1小節目で問い、2小節目は長い音で収まる */
const BASIC_MOTIFS: [Motif, number][] = [
  [[[1, 1, 1, 1], [1, 1, 2]], 3],
  [[[1, 1, 2], [1, 1, 2]], 3],
  [[[2, 1, 1], [2, 2]], 2],
  [[[1.5, 0.5, 1, 1], [1.5, 0.5, 2]], 3],
  [[[1, 0.5, 0.5, 1, 1], [1, 0.5, 0.5, 2]], 3],
  [[[0.5, 0.5, 1, 1, 1], [0.5, 0.5, 1, 2]], 2],
  [[[1, 1, 1, 0.5, 0.5], [1, 1, 2]], 2],
  [[[1, 0.5, 0.5, 1, 1], [1, 1, 2]], 2],
  [[[1, 1, 1, 1], [1, 1, 1, 1]], 1.5],
  [[[2, 1, 0.5, 0.5], [1, 1, 2]], 1.5],
]

/** 中級: シンコペーション(拍の裏から始まる音)を含む動機(4/4) */
const SYNCOPATED_MOTIFS: [Motif, number][] = [
  [[[0.5, 1, 1, 1, 0.5], [1, 1, 2]], 3],
  [[[1, 0.5, 1, 0.5, 1], [1, 1, 2]], 3],
  [[[0.5, 1, 0.5, 1, 1], [2, 2]], 2],
  [[[1.5, 1.5, 1], [1.5, 0.5, 2]], 3],
  [[[1, 1, 0.5, 1, 0.5], [1, 1, 2]], 2],
  [[[0.5, 1, 1.5, 1], [1, 1, 2]], 2],
  [[[1.5, 0.5, 1, 1], [0.5, 1, 0.5, 2]], 2],
  [[[0.5, 1, 0.5, 0.5, 0.5, 1], [0.5, 1, 0.5, 2]], 3],
  [[[0.5, 0.5, 1, 0.5, 0.5, 1], [1, 0.5, 0.5, 2]], 3],
  [[[1.5, 0.5, 0.5, 0.5, 0.5, 0.5], [0.5, 1, 0.5, 2]], 2],
]

/** 中級: 三連符を含む動機(4/4)。三連符は拍の頭から始まり、1拍(八分三連)か2拍(四分三連)でまとまる */
const TRIPLET_MOTIFS: [Motif, number][] = [
  [[[1, T, T, T, 1, 1], [1, 1, 2]], 3],
  [[[1, 1, 1, T, T, T], [2, 2]], 2],
  [[[Q, Q, Q, 1, 1], [1, 1, 2]], 2],
  [[[T, T, T, 1, 1, 1], [1, 1, 1, 1]], 2],
  [[[1, 1, Q, Q, Q], [1, 1, 2]], 2],
  [[[1, T, T, T, 2], [1, T, T, T, 2]], 2],
  [[[T, T, T, T, T, T, 1, 1], [1, 1, 2]], 1],
  [[[0.5, 0.5, T, T, T, 1, 1], [1, T, T, T, 2]], 3],
  [[[T, T, T, 0.5, 0.5, T, T, T, 1], [0.5, 0.5, T, T, T, 2]], 3],
]

/** 上級: 十六分音符・付点のリズムを含む動機(4/4) */
const SIXTEENTH_MOTIFS: [Motif, number][] = [
  // 付点八分+十六分、十六分の連打、三連符を織り交ぜた、音符の細かい動機。2小節目も細かく、終止の音(最後)だけが長い
  [[[0.75, 0.25, 0.75, 0.25, 1, 1], [0.75, 0.25, 0.5, 0.5, 1, 1]], 4],
  [[[0.5, 0.25, 0.25, 0.5, 0.25, 0.25, 1, 1], [1, 0.5, 0.25, 0.25, 2]], 4],
  [[[1, T, T, T, 0.75, 0.25, 1], [T, T, T, 1, 2]], 3],
  [[[0.25, 0.25, 0.25, 0.25, 0.75, 0.25, 0.5, 0.5, 1], [0.75, 0.25, 0.5, 0.5, 1, 1]], 3],
  [[[T, T, T, 0.75, 0.25, 0.5, 0.5, 1], [0.5, 0.25, 0.25, 0.75, 0.25, 2]], 3],
  [[[0.5, 0.75, 0.25, 0.5, 0.5, 0.5, 1], [0.75, 0.25, 1.5, 0.5, 1]], 3],
  [[[1.5, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5], [1, 0.5, 0.25, 0.25, 2]], 2],
  [[[0.75, 0.25, T, T, T, 0.5, 0.5, 1], [0.75, 0.25, 0.5, 0.5, 1, 1]], 3],
  [[[Q, Q, Q, 0.75, 0.25, 1], [1, 0.5, 0.25, 0.25, 2]], 2],
  [[[0.5, 0.25, 0.25, 1, 0.75, 0.25, 1], [0.75, 0.25, 0.5, 0.5, 1, 1]], 3],
  [[[0.25, 0.5, 0.25, 1, 0.5, 0.25, 0.25, 1], [0.75, 0.25, 1.5, 0.5, 1]], 3],
]

/** 3/4(1小節=3拍) */
const BASIC_MOTIFS_34: [Motif, number][] = [
  [[[1, 1, 1], [1, 2]], 3],
  [[[2, 1], [1, 2]], 2],
  [[[1, 1, 1], [3]], 1.5],
  [[[1.5, 0.5, 1], [1, 2]], 3],
  [[[1, 0.5, 0.5, 1], [1, 2]], 3],
  [[[0.5, 0.5, 1, 1], [2, 1]], 2],
]
const SYNCOPATED_MOTIFS_34: [Motif, number][] = [
  [[[0.5, 1, 1, 0.5], [1, 2]], 3],
  [[[1, 0.5, 1, 0.5], [2, 1]], 3],
  [[[1.5, 1.5], [1, 2]], 2],
]
const TRIPLET_MOTIFS_34: [Motif, number][] = [
  [[[1, T, T, T, 1], [1, 2]], 3],
  [[[Q, Q, Q, 1], [1, 2]], 2],
  [[[T, T, T, 1, 1], [2, 1]], 2],
]
const SIXTEENTH_MOTIFS_34: [Motif, number][] = [
  [[[0.75, 0.25, 0.75, 0.25, 1], [0.75, 0.25, 2]], 4],
  [[[0.5, 0.25, 0.25, T, T, T, 1], [1, 0.5, 0.25, 0.25, 1]], 3],
  [[[0.25, 0.25, 0.5, 0.75, 0.25, 1], [T, T, T, 2]], 3],
  [[[T, T, T, 0.75, 0.25, 1], [0.75, 0.25, 2]], 3],
  [[[0.5, 0.25, 0.25, 0.5, 0.5, 1], [1, 0.5, 0.25, 0.25, 1]], 3],
]

/** 6/8(1小節=付点4分音符2拍。長さは4分音符=1の単位なので、1小節=3) */
const BASIC_MOTIFS_68: [Motif, number][] = [
  [[[1.5, 1.5], [1.5, 1.5]], 3],
  [[[1, 0.5, 1.5], [1.5, 1.5]], 3],
  [[[0.5, 0.5, 0.5, 1.5], [1, 0.5, 1.5]], 2],
  [[[1.5, 0.5, 0.5, 0.5], [1.5, 1.5]], 2],
  [[[1, 0.5, 1, 0.5], [1.5, 1.5]], 2],
  [[[0.5, 0.5, 0.5, 0.5, 0.5, 0.5], [1, 0.5, 1.5]], 1.5],
]
const SYNCOPATED_MOTIFS_68: [Motif, number][] = [
  [[[0.5, 1, 0.5, 1], [1.5, 1.5]], 3],
  [[[1, 1, 1], [1.5, 1.5]], 2],
  [[[0.5, 1, 1.5], [1, 0.5, 1.5]], 2],
]
const SIXTEENTH_MOTIFS_68: [Motif, number][] = [
  [[[0.75, 0.25, 0.5, 0.5, 0.5, 0.5], [0.75, 0.25, 0.5, 1.5]], 4],
  [[[0.5, 0.25, 0.25, 0.5, 0.5, 0.75, 0.25], [0.5, 0.25, 0.25, 0.5, 1.5]], 3],
  [[[0.25, 0.25, 0.5, 0.75, 0.25, 0.5, 0.5], [0.75, 0.25, 0.5, 1.5]], 3],
  [[[0.75, 0.25, 1.5, 0.5], [1, 0.5, 1.5]], 3],
]

/** カスタム「四分音符まで」: 最短が四分音符(6/8は付点四分音符を含む) */
const QUARTER_MOTIFS: [Motif, number][] = [
  [[[1, 1, 1, 1], [1, 1, 2]], 3],
  [[[1, 1, 2], [1, 1, 2]], 3],
  [[[2, 1, 1], [2, 2]], 2],
  [[[2, 2], [1, 1, 2]], 2],
  [[[1, 1, 2], [2, 2]], 2],
  [[[1, 1, 1, 1], [1, 1, 1, 1]], 1.5],
]
const QUARTER_MOTIFS_34: [Motif, number][] = [
  [[[1, 1, 1], [1, 2]], 3],
  [[[2, 1], [1, 2]], 2],
  [[[1, 1, 1], [3]], 1.5],
  [[[1, 2], [1, 2]], 2],
]
const QUARTER_MOTIFS_68: [Motif, number][] = [
  [[[1.5, 1.5], [1.5, 1.5]], 3],
  [[[3], [1.5, 1.5]], 2],
  [[[1, 1, 1], [1.5, 1.5]], 1.5],
]
/** 四分音符の単位でのシンコペーション: 2拍分の音が拍の裏(2拍目など)から始まる、または小節をまたいでタイで結ばれる */
const QUARTER_SYNC_MOTIFS: [Motif, number][] = [
  [[[1, 2, 1], [1, 1, 2]], 3],
  [[[1, 2, 1], [2, 2]], 2],
  [[[2, 1, 1], [1, 1, 2], [[0, 2]]], 3],
  [[[1, 1, 1, 1], [1, 1, 2], [[0, 3]]], 3],
]
const QUARTER_SYNC_MOTIFS_34: [Motif, number][] = [
  [[[1, 2], [1, 2]], 3],
  [[[1, 1, 1], [1, 2], [[0, 2]]], 3],
]
const QUARTER_SYNC_MOTIFS_68: [Motif, number][] = [
  [[[1, 2], [1.5, 1.5]], 2],
  [[[1.5, 1.5], [1.5, 1.5], [[0, 1]]], 3],
]

/**
 * タイを伴うシンコペーション(4/4)。拍の裏の短い音が、次の拍や小節の頭の音とタイで結ばれ、
 * 小節の頭や3拍目に新しい発音がない。小節をまたぐものも含む(タイは小節の前半側で指定)
 */
const TIED_MOTIFS: [Motif, number][] = [
  [[[1, 1, 1, 0.5, 0.5], [1, 1, 2], [[0, 4]]], 4],
  [[[1, 0.5, 0.5, 1, 1], [1, 1, 2], [[0, 2]]], 3],
  [[[1, 1, 0.5, 0.5, 1], [2, 2], [[0, 3]]], 3],
  [[[1, 1, 1, 0.5, 0.5], [1.5, 0.5, 2], [[0, 4]]], 3],
  [[[2, 1, 0.5, 0.5], [2, 2], [[0, 3]]], 3],
  [[[1.5, 1.5, 0.5, 0.5], [1, 1, 2], [[0, 3]]], 3],
]
const TIED_MOTIFS_34: [Motif, number][] = [
  [[[1, 1, 0.5, 0.5], [1, 2], [[0, 3]]], 4],
  [[[1, 0.5, 0.5, 1], [1, 2], [[0, 2]]], 3],
  [[[2, 0.5, 0.5], [1, 2], [[0, 2]]], 3],
]
const TIED_MOTIFS_68: [Motif, number][] = [
  [[[1.5, 1, 0.5], [1.5, 1.5], [[0, 2]]], 4],
  [[[1, 0.5, 1, 0.5], [1.5, 1.5], [[0, 3]]], 3],
]

/**
 * 上級: 十六分音符・付点のリズム・三連符と、小節をまたぐタイを組み合わせた動機。
 * 1小節目の最後の音符(拍の裏)が、2小節目の最初の音符とタイで結ばれ、小節の頭に新しい発音がない
 */
const TIED_RICH_MOTIFS: [Motif, number][] = [
  [[[0.5, 0.25, 0.25, 0.75, 0.25, 1, 0.5, 0.5], [1.5, 0.25, 0.25, 0.5, 1.5], [[0, 7]]], 4],
  [[[0.75, 0.25, T, T, T, 1, 0.5, 0.5], [1, 0.75, 0.25, 2], [[0, 7]]], 4],
  [[[1, 0.25, 0.25, 0.5, 0.75, 0.25, 0.5, 0.5], [1.5, 0.5, 1, 1], [[0, 7]]], 4],
  [[[Q, Q, Q, 0.75, 0.25, 0.5, 0.5], [1.5, 0.75, 0.25, 1.5], [[0, 6]]], 3],
  [[[0.5, 0.25, 0.25, 1, 1, 1], [1, 0.5, 0.25, 0.25, 2], [[0, 5]]], 4],
  [[[0.75, 0.25, 0.75, 0.25, 1, 0.5, 0.5], [2, 0.75, 0.25, 1], [[0, 6]]], 4],
]
const TIED_RICH_MOTIFS_34: [Motif, number][] = [
  [[[0.5, 0.25, 0.25, 0.75, 0.25, 0.5, 0.5], [1.5, 0.5, 1], [[0, 6]]], 4],
  [[[T, T, T, 0.75, 0.25, 1], [1, 0.5, 0.25, 0.25, 1], [[0, 5]]], 4],
  [[[1, 0.5, 0.25, 0.25, 0.5, 0.5], [1.5, 0.5, 1], [[0, 5]]], 4],
]
const TIED_RICH_MOTIFS_68: [Motif, number][] = [
  [[[0.75, 0.25, 0.5, 0.5, 0.5, 0.5], [1.5, 0.25, 0.25, 1], [[0, 5]]], 4],
  [[[1, 0.25, 0.25, 0.5, 0.5, 0.5], [1.5, 0.5, 1], [[0, 5]]], 4],
]

/** 拍子ごとの動機の一覧。triplet は6/8にはない */
interface MotifSet {
  basic: [Motif, number][]
  syncopated: [Motif, number][]
  triplet: [Motif, number][]
  tied: [Motif, number][]
  sixteenth: [Motif, number][]
  /** 十六分音符などと、小節をまたぐタイを組み合わせた動機(上級) */
  tiedRich: [Motif, number][]
  /** カスタム用: 最短が四分音符の動機と、その中のシンコペーション */
  quarter: [Motif, number][]
  quarterSync: [Motif, number][]
}
const MOTIF_SETS: Record<MeterId, MotifSet> = {
  '4/4': { basic: BASIC_MOTIFS, syncopated: SYNCOPATED_MOTIFS, triplet: TRIPLET_MOTIFS, tied: TIED_MOTIFS, sixteenth: SIXTEENTH_MOTIFS, tiedRich: TIED_RICH_MOTIFS, quarter: QUARTER_MOTIFS, quarterSync: QUARTER_SYNC_MOTIFS },
  '3/4': { basic: BASIC_MOTIFS_34, syncopated: SYNCOPATED_MOTIFS_34, triplet: TRIPLET_MOTIFS_34, tied: TIED_MOTIFS_34, sixteenth: SIXTEENTH_MOTIFS_34, tiedRich: TIED_RICH_MOTIFS_34, quarter: QUARTER_MOTIFS_34, quarterSync: QUARTER_SYNC_MOTIFS_34 },
  '6/8': { basic: BASIC_MOTIFS_68, syncopated: SYNCOPATED_MOTIFS_68, triplet: [], tied: TIED_MOTIFS_68, sixteenth: SIXTEENTH_MOTIFS_68, tiedRich: TIED_RICH_MOTIFS_68, quarter: QUARTER_MOTIFS_68, quarterSync: QUARTER_SYNC_MOTIFS_68 },
}

/** 最後の小節(主音で終わる) */
const FINAL_RHYTHMS: Record<MeterId, [Rhythm, number][]> = {
  '4/4': [[[4], 0.65], [[3, -1], 0.35]],
  '3/4': [[[3], 0.65], [[2, -1], 0.35]],
  '6/8': [[[3], 0.65], [[1.5, -1.5], 0.35]],
}

// 各小節の和音の根音(I=0, IV=3, V=4)。1-2小節目と5-6小節目の和音は揃える
const CHORD_PLANS: number[][] = [
  [0, 3, 0, 4, 0, 3, 4, 0],
  [0, 0, 3, 4, 0, 0, 4, 0],
  [0, 3, 4, 4, 0, 3, 4, 0],
]

const chordTones = (root: number) => new Set([root % 7, (root + 2) % 7, (root + 4) % 7])

const STEP_LO = -2
const STEP_HI = 7
const CANDIDATES = 300

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

// ---------------------------------------------------------------- 旋律の歩み

interface State {
  prev: number | null
  prev2: number | null
  /** 直前の音が、半音上げた第7音(短調の導音)か */
  prevRaised: boolean
  /** 直前の音(傾向音)の次に許される音程。なければ null */
  pending: Set<number> | null
}

interface EventCtx {
  beats: number
  strong: boolean
  chord: Set<number>
  mode: Mode
  /** この小節の和音が属和音(V)か */
  dominant: boolean
  /** 模倣する動機の、同じ位置の音程 */
  guideInterval?: number
  guideWeight: number
  /** この音に許される高さの制限(最初の音・終止の音) */
  onlySteps?: Set<number>
  /** 和声音に限る(タイで長く保持される音) */
  requireChord?: boolean
}

function stepWeight(d: number, beats: number): number {
  const a = Math.abs(d)
  const base = [0.6, 6, 3, 1, 0.5][a] ?? 0
  // 短い音符(八分音符・三連符)では跳躍を控えめに
  return beats <= 0.5 && a >= 2 ? base * 0.3 : base
}

/** 次の音を選ぶ。条件を満たす音がなければ null */
function nextStep(rng: Rng, st: State, ev: EventCtx): number | null {
  const prev = st.prev
  const cands: [number, number][] = []
  for (let s = STEP_LO; s <= STEP_HI; s++) {
    if (ev.onlySteps && !ev.onlySteps.has(s)) continue
    const m = mod(s, 7)
    let w = 1
    let d = 0
    if (prev !== null) {
      d = s - prev
      w = stepWeight(d, ev.beats)
      if (w === 0) continue
      // 傾向音の次は、解決・経過・刺繍の動きだけ
      if (st.pending && !st.pending.has(d)) continue
      // 4度以上の跳躍の後は、反対方向へ順次進行で戻る
      const lastD = st.prev2 === null ? 0 : prev - st.prev2
      if (Math.abs(lastD) >= 3 && (Math.sign(d) !== -Math.sign(lastD) || Math.abs(d) !== 1)) continue
      // 同じ音を3回続けない
      if (d === 0 && lastD === 0 && st.prev2 !== null) continue
      // 短調: 第6音と、半音上げた第7音の間(増2度)は行き来しない
      if (ev.mode === 'minor' && Math.abs(d) === 1) {
        const raisedHere = ev.dominant && m === 6
        if (raisedHere && mod(prev, 7) === 5) continue
        if (st.prevRaised && m === 5) continue
      }
      // 順次進行の後は同じ方向へ進みやすい(順次進行の慣性)
      if (Math.abs(lastD) === 1 && Math.abs(d) === 1) w *= Math.sign(d) === Math.sign(lastD) ? 1.5 : 0.8
    }

    const isChord = ev.chord.has(m)
    if (ev.requireChord && !isChord) continue
    // 長い音は和声音、強拍も和声音を好む
    if (ev.beats >= 2 && !isChord) continue
    w *= ev.strong ? (isChord ? 5 : 0.15) : isChord ? 1.2 : 1
    if (ev.beats >= 1.5 && !isChord) w *= 0.3

    // 傾向音(第4音、長調の導音)が和声音でないときは、順次進行で入り、強拍では短く置く
    if (isTendency(m, isChord, ev.mode)) {
      if (prev !== null && Math.abs(d) !== 1) continue
      if (ev.strong && ev.beats > 1) continue
    }

    // 声域の中心(ミ〜ソあたり)に寄せる
    w *= Math.exp(-((s - 2.5) ** 2) / 18)

    // 動機の模倣
    if (ev.guideInterval !== undefined && prev !== null && d === ev.guideInterval) w *= ev.guideWeight
    if (w > 0) cands.push([s, w])
  }
  return cands.length ? weighted(rng, cands) : null
}

/**
 * 解決が必要な傾向音か。
 * - 第4音: リディア旋法(第4音が半音高い)以外では、第3音へ下がりたがる。
 * - 導音(長7度): 長調とリディアでは、主音へ上がりたがる。短調の自然な第7音や、他の旋法の短7度は傾向音にしない。
 */
function isTendency(m: number, isChord: boolean, mode: Mode): boolean {
  if (isChord) return false
  if (m === 3) return mode !== 'lydian'
  if (m === 6) return mode === 'major' || mode === 'lydian'
  return false
}

/** 和声音でない傾向音の次に許される音程 */
function pendingAfter(
  s: number,
  prev: number | null,
  isChord: boolean,
  strong: boolean,
  mode: Mode,
): Set<number> | null {
  const m = mod(s, 7)
  if (prev === null || !isTendency(m, isChord, mode)) return null
  const d = s - prev
  if (m === 3) return strong ? new Set([-1]) : d > 0 ? new Set([1, -1]) : new Set([-1, 1])
  return strong ? new Set([1]) : d > 0 ? new Set([1]) : new Set([-1, 1])
}

interface Walked {
  bars: ScoreNote[][]
  intervals: (number | undefined)[]
}

/**
 * 指定した小節を歩く。失敗(条件を満たす音がない)なら null。
 * guide: 模倣元の音程列、startSteps: 最初の音の制限、endSteps: 最後の音に課す終止の制約
 */
function walk(
  rng: Rng,
  st: State,
  rhythms: Rhythm[],
  ties: number[][],
  barRoots: number[],
  mode: Mode,
  meter: Meter,
  opts: {
    guide?: (number | undefined)[]
    guideWeight?: number
    startSteps?: Set<number>
    endSteps?: Set<number>
  },
): Walked | null {
  const bars: ScoreNote[][] = []
  const intervals: (number | undefined)[] = []
  let k = 0
  /** 直前の音符がタイで結ばれているときの高さ。次の音符はその続き(同じ高さ)になる */
  let tiedFrom: { step: number; alter: number } | null = null
  for (let b = 0; b < rhythms.length; b++) {
    const events = rhythms[b]
    const dominant = barRoots[b] === 4
    const chord = chordTones(barRoots[b])
    const lastPitched = events.reduce((acc, e, i) => (e > 0 ? i : acc), -1)
    const notes: ScoreNote[] = []
    let pos = 0
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      const beats = Math.abs(e)
      if (e < 0) {
        notes.push({ beats, step: null })
        tiedFrom = null
        pos += beats
        continue
      }
      const tieHere = (ties[b] ?? []).includes(i)
      if (tiedFrom) {
        // タイの続きの音符: 新しい高さは選ばず、同じ高さを置く
        const note: ScoreNote = tiedFrom.alter
          ? { beats, step: tiedFrom.step, alter: tiedFrom.alter }
          : { beats, step: tiedFrom.step }
        if (tieHere) note.tie = true
        else tiedFrom = null
        notes.push(note)
        pos += beats
        continue
      }
      // 強拍: 拍子ごとの強拍の頭(4/4は1・3拍目、3/4は1拍目、6/8は1・4拍目)。
      // 拍の裏から始まる1拍以上の音(シンコペーション)も、長さで目立つので強拍として扱う
      const onStrong = meter.strong.some((sp) => Math.abs(pos - sp) < 1e-6)
      const onPulse = isOnBeat(pos / meter.beatLen)
      const onHalf = Math.abs(pos * 2 - Math.round(pos * 2)) < 1e-6
      const strong = onStrong || (!onPulse && onHalf && beats >= 1)
      const ev: EventCtx = {
        beats,
        strong,
        chord,
        mode,
        dominant,
        guideInterval: opts.guide?.[k],
        guideWeight: opts.guideWeight ?? 1,
      }
      if (st.prev === null && opts.startSteps) ev.onlySteps = opts.startSteps
      if (b === rhythms.length - 1 && i === lastPitched && opts.endSteps) ev.onlySteps = opts.endSteps
      if (tieHere) {
        // タイで長く保持される音は和声音。小節をまたぐときは、前後の小節の和音に共通する音に限る
        ev.requireChord = true
        if (i === events.length - 1) {
          if (b + 1 >= rhythms.length) return null
          const nextChord = chordTones(barRoots[b + 1])
          ev.chord = new Set([...chord].filter((x) => nextChord.has(x)))
          if (ev.chord.size === 0) return null
        }
      }
      const s = nextStep(rng, st, ev)
      if (s === null) return null
      const m = mod(s, 7)
      // 短調の属和音の小節では、第7音を半音上げる
      const alter = mode === 'minor' && dominant && m === 6 ? 1 : 0
      intervals.push(st.prev === null ? undefined : s - st.prev)
      st.pending = pendingAfter(s, st.prev, chord.has(m), strong, mode)
      st.prev2 = st.prev
      st.prev = s
      st.prevRaised = alter === 1
      const note: ScoreNote = alter ? { beats, step: s, alter } : { beats, step: s }
      if (tieHere) {
        note.tie = true
        tiedFrom = { step: s, alter }
      }
      notes.push(note)
      pos += beats
      k++
    }
    bars.push(notes)
  }
  return { bars, intervals }
}

// ---------------------------------------------------------------- 採点

/** リズムの細かさ・多彩さの得点(難しい難易度で、簡単なリズムばかりの楽譜を選ばないようにする) */
function rhythmBonus(bars: ScoreNote[][]): number {
  const notes = bars.flat().filter((n) => n.step !== null)
  const n = notes.length
  const shortRatio = notes.filter((x) => x.beats < 1 - 1e-9).length / n
  const kinds = new Set(notes.map((x) => Math.round(x.beats * 24))).size
  let dottedPair = false
  let triplet = false
  let sixteenth = false
  bars.forEach((bar) => {
    bar.forEach((x, i) => {
      if (x.step === null) return
      if (isTriplet(x.beats)) triplet = true
      if (Math.abs(x.beats - 0.25) < 1e-6) sixteenth = true
      // 付点八分音符+十六分音符の組み合わせ
      if (Math.abs(x.beats - 0.75) < 1e-6 && bar[i + 1] && Math.abs(bar[i + 1].beats - 0.25) < 1e-6) dottedPair = true
    })
  })
  return (
    Math.min(shortRatio, 0.7) * 14 +
    Math.min(kinds, 7) * 0.8 +
    (dottedPair ? 2 : 0) +
    (triplet ? 2 : 0) +
    (sixteenth ? 2 : 0) -
    Math.max(0, 0.4 - shortRatio) * 20
  )
}

/** 小節をまたぐタイ(小節の最後の音符が、次の小節の最初の音符と結ばれている)の数 */
const barlineTies = (bars: ScoreNote[][]) => bars.filter((b) => b.length > 0 && b[b.length - 1].tie).length

function scoreMelody(bars: ScoreNote[][], richness = 0, tieWeight = 0): number {
  const flat: { s: number; bar: number }[] = []
  // タイの続きの音符は同じ音の延長なので、旋律の動きとしては数えない
  let continued = false
  bars.forEach((b, bi) =>
    b.forEach((n) => {
      if (n.step !== null && !continued) flat.push({ s: n.step, bar: bi })
      continued = n.step !== null && !!n.tie
    }),
  )
  const steps = flat.map((f) => f.s)
  const n = steps.length
  let score = 0

  // ジグザグ(方向転換の多さ)を嫌う
  let reversals = 0
  let lastDir = 0
  let repeats = 0
  let leaps = 0
  let bigLeaps = 0
  for (let i = 1; i < n; i++) {
    const d = steps[i] - steps[i - 1]
    const dir = Math.sign(d)
    if (dir === 0) repeats++
    else {
      if (lastDir !== 0 && dir !== lastDir) reversals++
      lastDir = dir
    }
    if (Math.abs(d) >= 2) leaps++
    if (Math.abs(d) >= 4) bigLeaps++
  }
  score -= Math.max(0, reversals - n * 0.3) * 1.5
  score -= Math.max(0, repeats / n - 0.12) * 20
  score -= Math.max(0, leaps / n - 0.3) * 10
  score -= Math.max(0, 0.1 - leaps / n) * 10
  score -= Math.max(0, bigLeaps - 1) * 2

  // 音域: 6〜8度程度の広がりが歌いやすく、かつ単調でない
  const max = Math.max(...steps)
  const min = Math.min(...steps)
  const span = max - min
  score += span >= 5 && span <= 8 ? 3 : -Math.abs(span - 6.5) * 1.5

  // 山(クライマックス): 最高音が一度だけ現れる
  const peaks = flat.filter((f) => f.s === max)
  const peakBar = peaks[0].bar
  // 後楽節(5〜6小節目)に山が来ると最も収まりがよい
  score += peakBar >= 4 && peakBar <= 5 ? 4 : peakBar >= 2 && peakBar <= 3 ? 1 : peakBar === 0 || peakBar === 7 ? -4 : -1
  score -= Math.max(0, peaks.length - 2) * 1.5
  // 最低音も繰り返し現れすぎない
  score -= Math.max(0, flat.filter((f) => f.s === min).length - 3) * 1

  // 同じ音ばかりにならない
  const counts = new Map<number, number>()
  steps.forEach((s) => counts.set(mod(s, 7), (counts.get(mod(s, 7)) ?? 0) + 1))
  score += Math.min(counts.size, 6) * 0.5
  score -= Math.max(0, Math.max(...counts.values()) / n - 0.3) * 15

  // 隣り合う小節が全く同じ高さの並びになるのは単調
  for (let b = 1; b < 8; b++) {
    const a = bars[b - 1].map((x) => x.step).join()
    const c = bars[b].map((x) => x.step).join()
    if (a === c) score -= 1
  }
  // 難しい難易度ほど、音符が細かく多彩なリズムを高く評価する
  if (richness > 0) score += richness * rhythmBonus(bars)
  // この楽譜で小節をまたぐタイを入れると決めたときは、タイのある候補を高く評価する(2か所まで)
  if (tieWeight > 0) score += tieWeight * Math.min(2, barlineTies(bars))
  return score
}

// ---------------------------------------------------------------- 生成

/** 動機の選び方: 主題(1小節目から使う動機)と、後半の対照楽節も含めた候補 */
interface Plan {
  theme: [Motif, number][]
  pool: [Motif, number][]
  /** リズムの細かさをどれだけ重く採点するか(0=採点しない) */
  richness: number
}

const scaled = (list: [Motif, number][], k: number): [Motif, number][] => list.map(([m, w]) => [m, w * k])

function buildPlan(level: Level, meter: Meter, custom: CustomOptions): Plan {
  const set = MOTIF_SETS[meter.id]
  // 小節をまたぐタイを伴うシンコペーションは、中級で少し(約1.7倍)、上級でかなり増やす(ただし、そればかりにはしない)
  const characteristic: [Motif, number][] = [...set.syncopated, ...set.triplet, ...scaled(set.tied, 1.7)]
  if (level === 'advanced') {
    // 十六分音符・付点八分+十六分・三連符を織り交ぜた動機を主題にし、基本のリズムはほとんど使わない。
    // 主題のおよそ半分は、小節をまたぐタイを伴う動機にする
    const theme = [...set.sixteenth, ...scaled(set.tiedRich, 1.5)]
    return {
      theme,
      pool: [...theme, ...scaled([...set.syncopated, ...set.triplet, ...set.tied], 0.5), ...scaled(set.basic, 0.1)],
      richness: 1,
    }
  }
  if (level === 'intermediate') {
    return { theme: characteristic, pool: [...characteristic, ...scaled(set.basic, 0.25)], richness: 0.5 }
  }
  if (level === 'custom') {
    const order = { quarter: 0, eighth: 1, triplet: 2, sixteenth: 3 }[custom.shortest]
    const basic = [...set.quarter, ...(order >= 1 ? set.basic : [])]
    const extras = [...(order >= 2 ? set.triplet : []), ...(order >= 3 ? set.sixteenth : [])]
    const sync = custom.syncopation
      ? [...set.quarterSync, ...(order >= 1 ? [...set.syncopated, ...set.tied] : []), ...(order >= 3 ? set.tiedRich : [])]
      : []
    const special = [...sync, ...extras]
    return {
      theme: special.length ? special : basic,
      pool: special.length ? [...special, ...scaled(basic, 0.4)] : basic,
      richness: [0, 0.3, 0.6, 1][order],
    }
  }
  return { theme: set.basic, pool: set.basic, richness: 0 }
}

function sampleOnce(rng: Rng, plan: Plan, mode: Mode, meter: Meter): ScoreNote[][] | null {
  const parallel = rng() < 0.55
  const roots = CHORD_PLANS[Math.floor(rng() * CHORD_PLANS.length)]

  const A = weighted(rng, plan.theme)
  const B = parallel ? A : weighted(rng, plan.pool.filter(([m]) => m !== A))

  // 4小節目は、ときどきフレーズ末に休符(息継ぎ)を入れる
  let r4 = B[1]
  const last = r4[r4.length - 1]
  if (last >= 1.5 && rng() < 0.2) {
    const rest = last >= 2 ? 1 : 0.5
    r4 = [...r4.slice(0, -1), last - rest, -rest]
  }

  // 7小節目は、終止へ向かう音で終わるので、最後の音符がタイで次の小節へ続くリズムは使わない
  const b0Last = B[0].length - 1
  // 小節の最後の音符が、タイの続き(同じ高さの延長)になるリズムも避ける(終止の音を選べなくなるため)
  const b0Ties = tiesOf(B, 0)
  const useB0 = B[0][b0Last] >= 1 && !b0Ties.includes(b0Last) && !b0Ties.some((t) => t + 1 === b0Last)
  const r7 = useB0 ? B[0] : A[1]
  const rhythms: Rhythm[] = [A[0], A[1], B[0], r4, A[0], A[1], r7]
  const ties: number[][] = [
    tiesOf(A, 0), tiesOf(A, 1), tiesOf(B, 0), tiesOf(B, 1),
    tiesOf(A, 0), tiesOf(A, 1), useB0 ? tiesOf(B, 0) : tiesOf(A, 1),
  ]

  const st: State = { prev: null, prev2: null, prevRaised: false, pending: null }
  const first = walk(rng, st, rhythms.slice(0, 2), ties.slice(0, 2), roots.slice(0, 2), mode, meter, { startSteps: new Set([0, 2, 4]) })
  if (!first) return null

  // 前楽節の後半: 平行楽節なら動機を模倣する。終わりは第5音か第2音(半終止)
  const second = walk(rng, st, rhythms.slice(2, 4), ties.slice(2, 4), roots.slice(2, 4), mode, meter, {
    guide: parallel ? first.intervals : undefined,
    guideWeight: 5,
    endSteps: new Set([1, 4]),
  })
  if (!second) return null

  // 後楽節の前半: 動機をそのまま、または模倣して再現する
  let third: Walked | null
  const chordsSame = roots[0] === roots[4] && roots[1] === roots[5]
  if (chordsSame && rng() < 0.5) {
    const bars = first.bars.map((b) => b.map((n) => ({ ...n })))
    const pitched = bars.flat().filter((n) => n.step !== null)
    if (Math.abs(pitched[0].step! - st.prev!) > 4) return null
    st.prev2 = pitched[pitched.length - 2].step!
    st.prev = pitched[pitched.length - 1].step!
    st.prevRaised = (pitched[pitched.length - 1].alter ?? 0) === 1
    st.pending = null
    third = { bars, intervals: first.intervals }
  } else {
    third = walk(rng, st, rhythms.slice(4, 6), ties.slice(4, 6), roots.slice(4, 6), mode, meter, { guide: first.intervals, guideWeight: 6 })
  }
  if (!third) return null

  // 終止の前: 最後の主音へ順次進行で解決する音(第2音か導音)で止まる
  const fourth = walk(rng, st, rhythms.slice(6, 7), ties.slice(6, 7), roots.slice(6, 7), mode, meter, {
    guide: parallel ? second.intervals : undefined,
    guideWeight: 2,
    endSteps: new Set([1, -1, 6]),
  })
  if (!fourth) return null

  const lastStep = st.prev!
  const tonic = Math.abs(lastStep - 7) < Math.abs(lastStep) ? 7 : 0
  const finalRhythm = weighted(rng, FINAL_RHYTHMS[meter.id])
  const finalBar = finalRhythm.map((e) => (e < 0 ? { beats: -e, step: null } : { beats: e, step: tonic }))

  return [...first.bars, ...second.bars, ...third.bars, ...fourth.bars, finalBar]
}

const isMajorKey = (k: KeyInfo) => k.mode === 'major'

function pickKey(rng: Rng, level: Level, custom: CustomOptions): KeyInfo {
  if (level === 'beginner') return KEY_C_MAJOR
  if (level === 'custom') {
    const max = custom.maxAccidentals
    const within = (k: KeyInfo) => keySignatureCount(k) <= max
    const pick = (keys: KeyInfo[]) => keys[Math.floor(rng() * keys.length)]
    if (custom.keys === 'c-major') return KEY_C_MAJOR
    if (custom.keys === 'church') return pick(churchKeys(max))
    const all = ADVANCED_KEYS.filter(within)
    if (custom.keys === 'major') return pick(all.filter(isMajorKey))
    // 長調と短調を同じ確率で、その中から選ぶ
    const wantMajor = rng() < 0.5
    return pick(all.filter((k) => (k.mode === 'major') === wantMajor))
  }
  // 長調と短調を同じ確率で、その中から調を選ぶ(上級は調号5つまで)
  const mode: Mode = rng() < 0.5 ? 'major' : 'minor'
  const keys = (level === 'advanced' ? ADVANCED_KEYS : INTERMEDIATE_KEYS).filter((k) => k.mode === mode)
  return keys[Math.floor(rng() * keys.length)]
}

function pickMeter(rng: Rng, level: Level, custom: CustomOptions): Meter {
  const random = () => METERS[weighted<MeterId>(rng, [['4/4', 0.4], ['3/4', 0.3], ['6/8', 0.3]])]
  if (level === 'beginner') return METERS['4/4']
  if (level === 'intermediate') return METERS[weighted<MeterId>(rng, [['4/4', 0.65], ['3/4', 0.35]])]
  if (level === 'custom') return custom.meter === 'random' ? random() : METERS[custom.meter]
  return random()
}

/**
 * 小節をまたぐタイを入れる楽譜の割合。中級は少し、上級はかなり多く(ただし、そればかりにはしない)。
 * カスタムは、シンコペーションが「あり」のとき、最短の音符が細かいほど多くする
 */
function tieProbability(level: Level, custom: CustomOptions): number {
  // (動機の選択だけでも、中級は約17%、上級は約49%の楽譜にタイが入るので、その分を差し引いた確率にしている)
  if (level === 'intermediate') return 0.28 // 全体で約40%の楽譜に入る
  if (level === 'advanced') return 0.3 // 全体で約65%の楽譜に入る
  if (level === 'custom' && custom.syncopation) return { quarter: 0.15, eighth: 0.2, triplet: 0.2, sixteenth: 0.3 }[custom.shortest]
  return 0
}

export function generateScore(
  seed = Math.floor(Math.random() * 2 ** 31),
  level: Level = 'beginner',
  custom: CustomOptions = DEFAULT_CUSTOM,
): Score {
  const rng = mulberry32(seed)
  const key = pickKey(rng, level, custom)
  const meter = pickMeter(rng, level, custom)
  const plan = buildPlan(level, meter, custom)
  const tieWeight = rng() < tieProbability(level, custom) ? 8 : 0
  let best: ScoreNote[][] | null = null
  let bestScore = -Infinity
  let found = 0
  for (let attempt = 0; attempt < CANDIDATES * 10 && found < CANDIDATES; attempt++) {
    const bars = sampleOnce(rng, plan, key.mode, meter)
    if (!bars) continue
    found++
    const sc = scoreMelody(bars, plan.richness, tieWeight)
    if (sc > bestScore) {
      best = bars
      bestScore = sc
    }
  }
  if (!best) throw new Error('楽譜を生成できませんでした')
  return { key, level, meter, beatsPerBar: meter.barLen / meter.beatLen, bars: best, seed }
}
