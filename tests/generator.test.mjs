import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateScore, near, scoreLib } from './helpers.mjs'

const { soundedNotes, isTriplet, isOnBeat, keySignatureCount, noteMidi } = scoreLib

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
}

/** どの難易度・設定でも守られる、楽譜の基本の決まり */
function assertValid(score, label) {
  const where = `${label} seed=${score.seed}`
  assert.equal(score.bars.length, 8, where)
  score.bars.forEach((bar, i) => {
    assert.ok(near(bar.reduce((a, n) => a + n.beats, 0), score.meter.barLen), `${where} 小節${i + 1}の長さ`)
  })

  const flat = score.bars.flat()
  const pitched = flat.filter((n) => n.step !== null)
  for (const n of pitched) assert.ok(n.step >= -2 && n.step <= 7, `${where} 音域`)

  // 終止: 最後は主音(オクターブ上でもよい)、その前の音から順次進行で解決する
  const sounded = soundedNotes(score)
  const last = sounded[sounded.length - 1]
  assert.ok((last.step === 0 || last.step === 7) && !last.alter, `${where} 最後は主音`)
  assert.equal(Math.abs(sounded[sounded.length - 2].step - last.step), 1, `${where} 順次進行で解決`)
  // 前半の終わり(4小節目)は、第5音か第2音
  const b4 = score.bars[3].filter((n) => n.step !== null)
  assert.ok([1, 4].includes(((b4[b4.length - 1].step % 7) + 7) % 7), `${where} 半終止`)

  // タイ: 次の音符(同じ小節の次、または次の小節の最初)が、同じ高さ。最後の小節には、またぎがない
  flat.forEach((n, i) => {
    if (!n.tie) return
    const next = flat[i + 1]
    assert.ok(next && next.step === n.step && (next.alter ?? 0) === (n.alter ?? 0), `${where} タイは同じ高さ`)
  })
  assert.ok(!score.bars[7].at(-1).tie, `${where} 最後の小節はタイでまたがない`)

  // 音階: 調の旋法の音階の音だけ。短調は、属和音の導音(半音上げた第7音)だけ例外
  const scale = SCALES[score.key.mode]
  for (const n of pitched) {
    const pc = (((noteMidi(score, n) - score.key.tonicMidi) % 12) + 12) % 12
    const ok = scale.includes(pc) || (score.key.mode === 'minor' && pc === 11 && n.alter === 1)
    assert.ok(ok, `${where} ${score.key.ja} の音階外の音`)
  }
}

const features = (score) => {
  const sounded = soundedNotes(score)
  const notes = score.bars.flat().filter((n) => n.step !== null)
  let sixteenth = false
  let dottedPair = false
  let triplet = false
  score.bars.forEach((bar) =>
    bar.forEach((n, i) => {
      if (n.step === null) return
      if (isTriplet(n.beats)) triplet = true
      if (near(n.beats, 0.25)) sixteenth = true
      if (near(n.beats, 0.75) && bar[i + 1] && near(bar[i + 1].beats, 0.25)) dottedPair = true
    }),
  )
  // シンコペーション: 拍の裏(半拍の位置)から始まる、1拍以上の音
  const synco = sounded.some((n) => n.beats >= 1 - 1e-9 && near(n.pos % 1, 0.5))
  const barlineTie = score.bars.some((b) => b.length > 0 && b[b.length - 1].tie)
  const shortRatio = notes.filter((n) => n.beats < 1 - 1e-9).length / notes.length
  return { sixteenth, dottedPair, triplet, synco, barlineTie, shortRatio, minBeats: Math.min(...notes.map((n) => n.beats)) }
}

const seeds = (n) => Array.from({ length: n }, (_, i) => i + 1)

describe('初級', () => {
  it('ハ長調・4/4・八分音符まで。タイ・三連符・十六分音符は出ない', () => {
    for (const seed of seeds(150)) {
      const s = generateScore(seed, 'beginner')
      assertValid(s, '初級')
      assert.equal(s.key.vex, 'C')
      assert.equal(s.meter.id, '4/4')
      const f = features(s)
      assert.ok(!f.triplet && !f.sixteenth && !f.barlineTie, `seed=${seed}`)
      assert.ok(f.minBeats >= 0.5 - 1e-9, `seed=${seed} 最短は八分音符`)
    }
  })

  it('同じ番号からは、同じ楽譜ができる', () => {
    assert.deepEqual(generateScore(42, 'beginner'), generateScore(42, 'beginner'))
    assert.notDeepEqual(generateScore(42, 'beginner').bars, generateScore(43, 'beginner').bars)
  })
})

describe('中級', () => {
  const scores = seeds(300).map((seed) => generateScore(seed, 'intermediate'))

  it('4/4か3/4。14調が使われ、短調は和声的短音階になる', () => {
    const keys = new Set()
    for (const s of scores) {
      assertValid(s, '中級')
      assert.ok(['4/4', '3/4'].includes(s.meter.id))
      assert.ok(keySignatureCount(s.key) <= 3)
      keys.add(s.key.ja)
    }
    assert.equal(keys.size, 14)
  })

  it('ほぼ全曲(95%以上)に、シンコペーションか三連符かタイが含まれる(十六分音符は出ない)', () => {
    // 残りは、シンコペーションではなく、八分音符が多い、密なリズムの楽譜
    let special = 0
    for (const s of scores) {
      const f = features(s)
      if (f.synco || f.triplet || f.barlineTie) special++
      assert.ok(!f.sixteenth, `seed=${s.seed}`)
    }
    assert.ok(special / scores.length >= 0.95, `special=${special / scores.length}`)
  })

  it('小節をまたぐタイが入る楽譜は、おおよそ4割(2.5〜5.5割)', () => {
    const share = scores.filter((s) => features(s).barlineTie).length / scores.length
    assert.ok(share > 0.25 && share < 0.55, `share=${share}`)
  })

  it('音符が細かい楽譜が選ばれる(四分音符より短い音符が、平均4割以上)', () => {
    const avg = scores.reduce((a, s) => a + features(s).shortRatio, 0) / scores.length
    assert.ok(avg > 0.4, `avg=${avg}`)
  })
})

describe('上級', () => {
  const scores = seeds(300).map((seed) => generateScore(seed, 'advanced'))

  it('4/4・3/4・6/8がすべて出て、22調が使われる', () => {
    const meters = new Set()
    const keys = new Set()
    for (const s of scores) {
      assertValid(s, '上級')
      assert.ok(keySignatureCount(s.key) <= 5)
      if (s.meter.id === '6/8') assert.ok(!features(s).triplet, '6/8に三連符はない')
      meters.add(s.meter.id)
      keys.add(s.key.ja)
    }
    assert.equal(meters.size, 3)
    assert.equal(keys.size, 22)
  })

  it('全曲に十六分音符が含まれ、大半に付点八分+十六分の組み合わせがある', () => {
    for (const s of scores) assert.ok(features(s).sixteenth, `seed=${s.seed}`)
    const dotted = scores.filter((s) => features(s).dottedPair).length / scores.length
    assert.ok(dotted > 0.9, `dotted=${dotted}`)
  })

  it('音符が細かい(四分音符より短い音符が、平均6割以上)', () => {
    const avg = scores.reduce((a, s) => a + features(s).shortRatio, 0) / scores.length
    assert.ok(avg > 0.6, `avg=${avg}`)
  })

  it('小節をまたぐタイが入る楽譜は、おおよそ6.5割(5〜8割)', () => {
    const share = scores.filter((s) => features(s).barlineTie).length / scores.length
    assert.ok(share > 0.5 && share < 0.8, `share=${share}`)
  })
})

describe('カスタム(全128通りの組み合わせ)', () => {
  const combos = []
  for (const meter of ['4/4', '3/4', '6/8', 'random'])
    for (const shortest of ['quarter', 'eighth', 'triplet', 'sixteenth'])
      for (const syncopation of [false, true])
        for (const keys of ['c-major', 'major', 'major-minor', 'church'])
          combos.push({ meter, shortest, syncopation, keys, maxAccidentals: 3 })

  const LIMIT = { quarter: 0.99, eighth: 0.49, triplet: 0.32, sixteenth: 0.24 }
  const CHURCH = new Set(['dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian'])

  it('どの組み合わせでも、選んだ設定が守られ、基本の決まりを満たす', () => {
    for (const c of combos) {
      for (const seed of seeds(4)) {
        const s = generateScore(seed, 'custom', c)
        const label = JSON.stringify(c)
        assertValid(s, label)
        if (c.meter !== 'random') assert.equal(s.meter.id, c.meter, label)
        assert.ok(keySignatureCount(s.key) <= c.maxAccidentals, label)

        const f = features(s)
        // 最短の音符の制限
        assert.ok(f.minBeats >= LIMIT[c.shortest] - 1e-6 || s.meter.id === '6/8', `${label} 最短 ${f.minBeats}`)
        if (c.shortest === 'eighth') assert.ok(!f.triplet && !f.sixteenth && !f.dottedPair, label)
        if (c.shortest === 'triplet') assert.ok(!f.sixteenth && !f.dottedPair, label)
        if (c.shortest === 'quarter' && s.meter.id !== '6/8') assert.ok(f.minBeats >= 1 - 1e-6, label)

        // 調の選択
        if (c.keys === 'c-major') assert.equal(s.key.vex, 'C', label)
        if (c.keys === 'major') assert.equal(s.key.mode, 'major', label)
        if (c.keys === 'major-minor') assert.ok(['major', 'minor'].includes(s.key.mode), label)
        if (c.keys === 'church') assert.ok(CHURCH.has(s.key.mode), label)

        // シンコペーションなしのとき: タイと、拍の裏から始まる長い音がない(6/8は、拍の数え方が違うので除く)
        if (!c.syncopation && s.meter.id !== '6/8') assert.ok(!f.barlineTie && !f.synco, `${label} シンコペーションなし`)
      }
    }
  })

  it('調号の上限が5つのとき、5つまでの調が使われる', () => {
    const seen = new Set()
    for (const seed of seeds(120)) {
      const s = generateScore(seed, 'custom', { meter: '4/4', shortest: 'eighth', syncopation: true, keys: 'major-minor', maxAccidentals: 5 })
      assertValid(s, 'カスタム5')
      seen.add(keySignatureCount(s.key))
    }
    assert.ok(seen.has(4) || seen.has(5))
  })
})
