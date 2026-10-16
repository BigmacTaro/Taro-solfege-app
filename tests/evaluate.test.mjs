import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BASE, FRAME_DT, evalLib, generateScore, midiToFreq, noteVerdicts, perform, scoreLib, toleranceOf } from './helpers.mjs'

const { evaluate, buildExpected } = evalLib

const LEVELS = ['beginner', 'intermediate', 'advanced']
const seeds = (n) => Array.from({ length: n }, (_, i) => i + 1)
/** 3つの難易度 × 複数の楽譜(拍子・調・リズムがさまざま)に対して、同じ確認をする */
const eachScore = (fn, count = 12) => {
  for (const level of LEVELS) for (const seed of seeds(count)) fn(generateScore(seed, level), `${level} seed=${seed}`)
}

describe('正しい演奏', () => {
  it('完璧に演奏すると100点で、聞こえず・余計な音・指摘がない', () => {
    eachScore((score, label) => {
      const r = evaluate(score, perform(score, BASE), BASE)
      assert.deepEqual(
        { percent: r.summary.percent, missed: r.summary.missed, extra: r.summary.extra, rest: r.summary.restBroken, dur: r.summary.durationIssues },
        { percent: 100, missed: 0, extra: 0, rest: 0, dur: 0 },
        label,
      )
    })
  })

  it('移調楽器(B♭管)で、実音を出せば100点', () => {
    eachScore((score, label) => {
      const p = { ...BASE, transpose: -2 }
      assert.equal(evaluate(score, perform(score, p), p).summary.percent, 100, label)
    })
  })

  it('オクターブ違いの音は、正解になる', () => {
    eachScore((score, label) => {
      const r = evaluate(score, perform(score, BASE, { octaves: true }), BASE)
      assert.equal(r.summary.pitchOk, r.summary.noteCount, label)
    })
  })
})

describe('タイミング', () => {
  it('最短の音符の許容内(70%)の遅れは、正解になる', () => {
    eachScore((score, label) => {
      const r = evaluate(score, perform(score, BASE, { allLate: 0.7 * toleranceOf(score) }), BASE)
      assert.equal(r.summary.timingOk, r.summary.noteCount, label)
    })
  })

  it('録音の遅れは、補正で打ち消せる', () => {
    eachScore((score, label) => {
      const p = { ...BASE, latencyMs: 400 }
      assert.equal(evaluate(score, perform(score, BASE, { allLate: 0.4 }), p).summary.percent, 100, label)
    })
  })
})

describe('個々の誤り', () => {
  it('±50セント以内は正解、80セントずれると不正解で、ずれの量が出る', () => {
    eachScore((score, label) => {
      const r = evaluate(score, perform(score, BASE, { cents: { 2: 30, 3: 80, 4: -45 } }), BASE)
      const v = noteVerdicts(r)
      assert.ok(v[2].pitchOk && v[4].pitchOk, `${label} 範囲内`)
      assert.ok(!v[3].pitchOk, `${label} 80セント`)
      assert.ok(Math.abs(v[3].centsOff - 80) < 30, `${label} ずれの量 ${v[3].centsOff}`)
      assert.ok(v[0].pitchOk && v[1].pitchOk, `${label} ほかは正解`)
    })
  })

  it('弾かなかった音は「聞こえず」になる', () => {
    eachScore((score, label) => {
      // 前後と高さが違う音を選ぶ(同じ高さの連打の一部は、区切りが聞こえないので、まとまりとして認められる)
      const sounded = scoreLib.soundedNotes(score)
      const k = sounded.findIndex(
        (n, i) => i >= 3 && i < sounded.length - 2 && n.step !== sounded[i - 1].step && n.step !== sounded[i + 1].step,
      )
      assert.ok(k >= 0, label)
      const r = evaluate(score, perform(score, BASE, { missing: [k] }), BASE)
      assert.ok(noteVerdicts(r)[k].missed, `${label} k=${k}`)
      assert.equal(r.summary.missed, 1, label)
    })
  })

  it('音が短いことは、標準では指摘せず、上級者モードで指摘する', () => {
    // 十分に長い音符(四分音符以上)で確かめる
    const score = generateScore(1, 'beginner')
    const p = { ...BASE, tempo: 60 }
    const idx = scoreLib.soundedNotes(score).findIndex((n) => n.beats >= 1)
    const frames = perform(score, p, { short: [idx] })
    assert.ok(noteVerdicts(evaluate(score, frames, p))[idx].duration === null)
    assert.equal(noteVerdicts(evaluate(score, frames, { ...p, checkShort: true }))[idx].duration, 'short')
  })

  it('休符で音を出し続けると「休めてない」になる', () => {
    let tested = 0
    eachScore((score, label) => {
      if (!score.bars.some((b) => b.some((n) => n.step === null))) return
      tested++
      const r = evaluate(score, perform(score, BASE, { breakRest: true }), BASE)
      assert.ok(r.summary.restBroken >= 1, label)
    }, 40)
    assert.ok(tested > 0)
  })

  it('何も演奏しないと、すべて聞こえずで0点', () => {
    const score = generateScore(3, 'intermediate')
    const silent = []
    for (let t = BASE.t0; t < BASE.t0 + 60; t += FRAME_DT) silent.push({ t, freq: null, rms: 0 })
    const r = evaluate(score, silent, BASE)
    assert.equal(r.summary.missed, r.summary.noteCount)
    assert.equal(r.summary.percent, 0)
  })
})

describe('ミスタッチと回り込みへの寛容さ', () => {
  it('一瞬の別の音(直前・途中)は、減点せず無視される', () => {
    eachScore((score, label) => {
      const frames = perform(score, BASE)
      const expected = buildExpected(score, BASE).filter((e) => !e.isRest)
      const inject = (t0, t1, midi) => {
        for (let t = t0; t < t1; t += FRAME_DT) {
          const f = frames[Math.round((t - BASE.t0) / FRAME_DT)]
          if (f) {
            f.freq = midiToFreq(midi)
            f.rms = 0.12
          }
        }
      }
      expected.forEach((e, k) => {
        const prevOk = k > 0 && expected[k - 1].dur >= 0.4
        if (e.dur >= 0.4 && prevOk && k % 4 === 0) inject(e.start - 0.09, e.start - 0.01, e.midi + 4) // 直前
        if (e.dur >= 0.55 && k % 4 === 1) inject(e.start + 0.2, e.start + 0.28, e.midi + 3) // 途中
      })
      const r = evaluate(score, frames, BASE)
      assert.equal(r.summary.pitchOk, r.summary.noteCount, label)
      assert.equal(r.summary.timingOk, r.summary.noteCount, label)
      assert.equal(r.summary.extra, 0, label)
      assert.equal(r.summary.missed, 0, label)
    })
  })

  it('スピーカーのクリック音が回り込んだ短い断片は、余計な音にならない', () => {
    eachScore((score, label) => {
      const frames = perform(score, BASE)
      const spb = 60 / BASE.tempo
      const total = score.meter.countIn + score.beatsPerBar * 8
      for (let k = score.meter.countIn; k < total; k++) {
        for (let d = 0.12; d < 0.18; d += FRAME_DT) {
          const f = frames[Math.round((BASE.t0 + k * spb + d - BASE.t0) / FRAME_DT)]
          if (f && f.freq === null) {
            f.freq = 750
            f.rms = 0.05
          }
        }
      }
      const r = evaluate(score, frames, { ...BASE, clickDuringBars: true })
      assert.equal(r.summary.extra, 0, label)
    })
  })
})

describe('タイ', () => {
  it('タイで結ばれた音は1つの音として判定され、続きの音符は点数に数えない', () => {
    let found = 0
    for (const seed of seeds(60)) {
      const score = generateScore(seed, 'advanced')
      if (!score.bars.flat().some((n) => n.tie)) continue
      found++
      const r = evaluate(score, perform(score, BASE), BASE)
      assert.equal(r.summary.percent, 100, `seed=${seed}`)
      assert.equal(r.summary.noteCount, scoreLib.soundedNotes(score).length, `seed=${seed}`)
      // 続きの音符にも、先頭と同じ結果が写っている
      assert.ok(r.verdicts.flat().some((v) => v.tiedCont))
    }
    assert.ok(found > 0)
  })
})
