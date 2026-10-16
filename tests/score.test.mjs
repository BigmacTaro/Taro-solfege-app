import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { scoreLib } from './helpers.mjs'

const { INTERMEDIATE_KEYS, ADVANCED_KEYS, churchKeys, KEY_C_MAJOR, METERS, noteMidi, noteVexKey, soundedNotes, beatsToVexDuration, isTriplet, keySignatureCount } = scoreLib

const keyOf = (vex) => ADVANCED_KEYS.find((k) => k.vex === vex)
const scoreIn = (key, bars = []) => ({ key, level: 'beginner', meter: METERS['4/4'], beatsPerBar: 4, bars, seed: 0 })

describe('調と音の綴り', () => {
  it('ハ長調の主音は中央ド(MIDI 60)', () => {
    assert.equal(KEY_C_MAJOR.tonicMidi, 60)
    assert.equal(noteMidi(scoreIn(KEY_C_MAJOR), { step: 0 }), 60)
    assert.equal(noteMidi(scoreIn(KEY_C_MAJOR), { step: 7 }), 72)
  })

  it('主音は、すべての調で MIDI 55〜66 に収まる', () => {
    for (const k of [...ADVANCED_KEYS, ...churchKeys(5)]) assert.ok(k.tonicMidi >= 55 && k.tonicMidi <= 66, k.ja)
  })

  it('変ロ長調の主音は "bb/3"', () => {
    assert.equal(noteVexKey(scoreIn(keyOf('Bb')), { step: 0 }), 'bb/3')
  })

  it('イ短調で、半音上げた第7音(導音)は "g#/4"', () => {
    assert.equal(noteVexKey(scoreIn(keyOf('Am')), { step: 6, alter: 1 }), 'g#/4')
  })

  it('嬰ヘ短調の導音は、嬰ヘ短調の主音の半音下の "e#/5"', () => {
    assert.equal(noteVexKey(scoreIn(keyOf('F#m')), { step: 6, alter: 1 }), 'e#/5')
  })

  it('調号の数: ハ長調0、ト長調1、変ホ長調3、ロ長調5', () => {
    assert.equal(keySignatureCount(KEY_C_MAJOR), 0)
    assert.equal(keySignatureCount(keyOf('G')), 1)
    assert.equal(keySignatureCount(keyOf('Eb')), 3)
    assert.equal(keySignatureCount(keyOf('B')), 5)
  })

  it('初級・中級の調は14調、上級は22調', () => {
    assert.equal(INTERMEDIATE_KEYS.length, 14)
    assert.equal(ADVANCED_KEYS.length, 22)
  })
})

describe('チャーチモード', () => {
  it('ロ・フリギアは、ト長調の第3音から始まる音階(調号は♯1つ)', () => {
    const k = churchKeys(3).find((x) => x.ja === 'ロ・フリギア')
    assert.ok(k)
    assert.equal(k.mode, 'phrygian')
    assert.equal(k.vex, 'G')
    assert.equal(k.tonicMidi % 12, 11)
    assert.equal(keySignatureCount(k), 1)
  })

  it('調号の上限を超える親の長調は、含まれない', () => {
    for (const k of churchKeys(3)) assert.ok(keySignatureCount(k) <= 3, k.ja)
    assert.ok(churchKeys(5).length > churchKeys(3).length)
  })

  it('音階の音だけが、旋法の音階に並ぶ(ニ・ドリアは、ドの白鍵だけ)', () => {
    const k = churchKeys(3).find((x) => x.ja === 'ニ・ドリア')
    const pcs = [0, 1, 2, 3, 4, 5, 6].map((step) => noteMidi(scoreIn(k), { step }) % 12)
    assert.deepEqual(pcs, [2, 4, 5, 7, 9, 11, 0])
  })
})

describe('音価', () => {
  it('三連符の音価を判別し、VexFlowの音価に変換できる', () => {
    assert.ok(isTriplet(1 / 3) && isTriplet(2 / 3))
    assert.ok(!isTriplet(0.5) && !isTriplet(1))
    assert.equal(beatsToVexDuration(1 / 3), '8')
    assert.equal(beatsToVexDuration(2 / 3), 'q')
    assert.equal(beatsToVexDuration(0.75), '8d')
    assert.equal(beatsToVexDuration(0.25), '16')
    assert.throws(() => beatsToVexDuration(0.6))
  })
})

describe('タイで結ばれた音符', () => {
  it('小節をまたぐタイは、1つの音にまとめられ、長さは合計になる', () => {
    const bars = [
      [
        { beats: 3, step: 0 },
        { beats: 0.5, step: 2 },
        { beats: 0.5, step: 4, tie: true },
      ],
      [
        { beats: 1.5, step: 4 },
        { beats: 2.5, step: 0 },
      ],
    ]
    const sounded = soundedNotes(scoreIn(KEY_C_MAJOR, bars))
    assert.equal(sounded.length, 4)
    const tied = sounded[2]
    assert.equal(tied.step, 4)
    assert.equal(tied.beats, 2)
    assert.equal(tied.pos, 3.5)
    assert.deepEqual(tied.cont, [{ bar: 1, index: 0 }])
  })

  it('休符をはさむと、タイは続かない', () => {
    const bars = [[{ beats: 2, step: 0, tie: true }, { beats: 1, step: null }, { beats: 1, step: 0 }]]
    assert.equal(soundedNotes(scoreIn(KEY_C_MAJOR, bars)).length, 2)
  })
})
