import { useEffect, useRef } from 'react'
import {
  Accidental,
  Annotation,
  Barline,
  Beam,
  Dot,
  Formatter,
  Fraction,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Tuplet,
  Voice,
} from 'vexflow/bravura'
import type { NoteVerdict } from './eval/evaluate'
import { beatsToVexDuration, isTriplet, keySignatureCount, noteVexKey, type Score } from './music/score'

// VexFlowの五線は、指定した位置より約40px下から始まる(上の余白を含むため)。その分を差し引く
const STAVE_TOP = -20
// 1段目の上の余白。三連符の括弧と数字、連桁、高い音の符幹は五線の上に描かれ、SVGの外にはみ出すと切れて見えない
const TOP_PAD = 24

const COLORS = {
  ok: '#1e9e5a',
  pitch: '#d93025',
  timing: '#e8710a',
  missed: '#9aa0a6',
}

export function ScoreView({ score, verdicts }: { score: Score; verdicts?: NoteVerdict[][] }) {
  const ref = useRef<HTMLDivElement>(null)
  const lastWidth = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const draw = () => {
      const width = Math.floor(el.clientWidth)
      if (width === 0) return
      lastWidth.current = width
      renderScore(el, score, width, verdicts)
    }
    draw()
    const ro = new ResizeObserver(() => {
      if (Math.floor(el.clientWidth) !== lastWidth.current) draw()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [score, verdicts])

  return <div ref={ref} className="score" />
}

/** 音符の色: 緑=正解、赤=音高が違う、橙=タイミング/長さに指摘、灰=聞き取れず */
function colorOf(v: NoteVerdict): string {
  if (v.missed) return COLORS.missed
  if (!v.pitchOk) return COLORS.pitch
  if (!v.timingOk || v.duration) return COLORS.timing
  return COLORS.ok
}

/** 音符の下に出す小さな文字。ずれの量を伝える */
function labelsOf(v: NoteVerdict): string[] {
  // タイの続きの音符は、先頭の音符の結果を色で示すだけにする(文字は先頭にだけ付ける)
  if (v.tiedCont) return []
  if (v.isRest) return v.restBroken ? ['休めてない'] : []
  if (v.missed) return ['聞こえず']
  const out: string[] = []
  const cents = Math.round(v.centsOff!)
  const signed = `${cents >= 0 ? '+' : ''}${cents}`
  // 外れたときは、実際に出した音名も添える。単位(セント)は凡例に書く
  out.push(v.pitchOk ? signed : `${v.sungName}${signed}`)
  if (v.merged) out.push('連打')
  if (!v.timingOk) {
    const b = Math.abs(v.timingErrBeats!).toFixed(1)
    out.push(v.timingErrBeats! > 0 ? `遅${b}拍` : `早${b}拍`)
  }
  if (v.duration === 'short') out.push('短い')
  if (v.duration === 'long') out.push('長い')
  return out
}

function renderScore(el: HTMLDivElement, score: Score, width: number, verdicts?: NoteVerdict[][]) {
  el.replaceChildren()
  // 狭い画面では1段2小節にする
  const barsPerRow = width < 560 ? 2 : 4
  const rows = Math.ceil(score.bars.length / barsPerRow)
  const rowHeight = verdicts ? 134 : 92

  const renderer = new Renderer(el, Renderer.Backends.SVG)
  renderer.resize(width, rows * rowHeight + TOP_PAD)
  const ctx = renderer.getContext()

  const margin = 8
  const usable = width - margin * 2
  // 段頭は音部記号・調号(・拍子記号)の分だけ広げる
  const headExtra = (row: number) => 40 + keySignatureCount(score.key) * 11 + (row === 0 ? 24 : 0)
  const baseWidth = (row: number) => (usable - headExtra(row)) / barsPerRow

  // タイを描くため、描いた音符を(小節, 番号)で覚えておく
  const drawn = new Map<string, StaveNote>()

  score.bars.forEach((bar, index) => {
    const row = Math.floor(index / barsPerRow)
    const col = index % barsPerRow
    const bw = baseWidth(row)
    const x = margin + (col === 0 ? 0 : headExtra(row) + col * bw)
    const w = col === 0 ? bw + headExtra(row) : bw
    const y = TOP_PAD + row * rowHeight + STAVE_TOP

    const stave = new Stave(x, y, w)
    if (col === 0) {
      stave.addClef('treble')
      stave.addKeySignature(score.key.vex)
      if (row === 0) stave.addTimeSignature(`${score.meter.num}/${score.meter.den}`)
      stave.setMeasure(index + 1)
    }
    if (index === score.bars.length - 1) stave.setEndBarType(Barline.type.END)
    stave.setContext(ctx).draw()

    const notes = bar.map((n, i) => {
      const duration = beatsToVexDuration(n.beats)
      const note =
        n.step === null
          ? new StaveNote({ keys: ['b/4'], duration: `${duration}r` })
          : new StaveNote({ keys: [noteVexKey(score, { step: n.step, alter: n.alter })], duration, autoStem: true })
      if (duration.endsWith('d')) Dot.buildAndAttach([note], { all: true })
      drawn.set(`${index}:${i}`, note)

      const v = verdicts?.[index]?.[i]
      if (v) {
        const labels = labelsOf(v)
        const color = v.isRest ? (v.restBroken ? COLORS.pitch : '#000') : colorOf(v)
        note.setStyle({ fillStyle: color, strokeStyle: color })
        labels.forEach((text, k) => {
          const a = new Annotation(text)
            .setFont('system-ui', 9)
            .setVerticalJustification(Annotation.VerticalJustify.BOTTOM)
          if (k === 0) a.setStyle({ fillStyle: color, strokeStyle: color })
          else a.setStyle({ fillStyle: COLORS.timing, strokeStyle: COLORS.timing })
          note.addModifier(a, 0)
        })
      }
      return note
    })

    // 三連符は3つ1組(八分三連=1拍、四分三連=2拍)でくくる
    const tuplets: Tuplet[] = []
    for (let i = 0; i < bar.length; ) {
      if (isTriplet(bar[i].beats)) {
        tuplets.push(new Tuplet(notes.slice(i, i + 3), { numNotes: 3, notesOccupied: 2 }))
        i += 3
      } else i++
    }

    const voice = new Voice({ numBeats: score.meter.num, beatValue: score.meter.den })
    voice.addTickables(notes)
    // 調号に含まれる音には臨時記号を付けず、それ以外(短調の導音など)には付ける
    Accidental.applyAccidentals([voice], score.key.vex)
    // 連桁は拍ごとにまとめる(4/4と3/4は4分音符ごと、6/8は付点4分音符=八分音符3つごと)
    const beamGroup = score.meter.den === 8 ? new Fraction(3, 8) : new Fraction(1, 4)
    const beams = Beam.generateBeams(notes, { groups: [beamGroup] })
    new Formatter().joinVoices([voice]).format([voice], stave.getNoteEndX() - stave.getNoteStartX() - 16)
    voice.draw(ctx, stave)
    beams.forEach((b) => b.setContext(ctx).draw())
    tuplets.forEach((t) => t.setContext(ctx).draw())
  })

  // タイ: 同じ段の中は弧でつなぎ、段をまたぐときは、段末と次の段頭に半分ずつ描く
  const ctxDraw = (t: StaveTie) => t.setContext(ctx).draw()
  score.bars.forEach((bar, b) => {
    bar.forEach((n, i) => {
      if (!n.tie) return
      const nb = i + 1 < bar.length ? b : b + 1
      const ni = i + 1 < bar.length ? i + 1 : 0
      const first = drawn.get(`${b}:${i}`)
      const last = drawn.get(`${nb}:${ni}`)
      if (!first || !last) return
      if (Math.floor(b / barsPerRow) === Math.floor(nb / barsPerRow)) {
        ctxDraw(new StaveTie({ firstNote: first, lastNote: last, firstIndexes: [0], lastIndexes: [0] }))
      } else {
        ctxDraw(new StaveTie({ firstNote: first, lastNote: null, firstIndexes: [0], lastIndexes: [0] }))
        ctxDraw(new StaveTie({ firstNote: null, lastNote: last, firstIndexes: [0], lastIndexes: [0] }))
      }
    })
  })
}