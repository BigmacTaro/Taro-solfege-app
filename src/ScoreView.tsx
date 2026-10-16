import { useEffect, useRef } from 'react'
import { Annotation, Barline, Beam, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow'
import type { NoteVerdict } from './eval/evaluate'
import { beatsToVexDuration, stepToVexKey, type Score } from './music/score'

// VexFlowの五線は、指定した位置より約40px下から始まる(上の余白を含むため)。その分を差し引く
const STAVE_TOP = -20

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
  if (v.isRest) return v.restBroken ? ['休めてない'] : []
  if (v.missed) return ['聞こえず']
  const out: string[] = []
  const cents = Math.round(v.centsOff!)
  const signed = `${cents >= 0 ? '+' : ''}${cents}`
  // 外れたときは、実際に出した音名も添える。単位(セント)は凡例に書く
  out.push(v.pitchOk ? signed : `${v.sungName}${signed}`)
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
  const rowHeight = verdicts ? 134 : 98

  const renderer = new Renderer(el, Renderer.Backends.SVG)
  renderer.resize(width, rows * rowHeight)
  const ctx = renderer.getContext()

  const margin = 8
  const usable = width - margin * 2
  // 段頭は音部記号・調号(・拍子記号)の分だけ広げる
  const headExtra = (row: number) => 40 + (row === 0 ? 24 : 0)
  const baseWidth = (row: number) => (usable - headExtra(row)) / barsPerRow

  score.bars.forEach((bar, index) => {
    const row = Math.floor(index / barsPerRow)
    const col = index % barsPerRow
    const bw = baseWidth(row)
    const x = margin + (col === 0 ? 0 : headExtra(row) + col * bw)
    const w = col === 0 ? bw + headExtra(row) : bw
    const y = row * rowHeight + STAVE_TOP

    const stave = new Stave(x, y, w)
    if (col === 0) {
      stave.addClef('treble')
      if (row === 0) stave.addTimeSignature(`${score.beatsPerBar}/4`)
      stave.setMeasure(index + 1)
    }
    if (index === score.bars.length - 1) stave.setEndBarType(Barline.type.END)
    stave.setContext(ctx).draw()

    const notes = bar.map((n, i) => {
      const duration = beatsToVexDuration(n.beats)
      const note =
        n.step === null
          ? new StaveNote({ keys: ['b/4'], duration: `${duration}r` })
          : new StaveNote({ keys: [stepToVexKey(n.step)], duration, autoStem: true })
      if (duration.endsWith('d')) Dot.buildAndAttach([note], { all: true })

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

    const voice = new Voice({ numBeats: score.beatsPerBar, beatValue: 4 })
    voice.addTickables(notes)
    const beams = Beam.generateBeams(notes)
    new Formatter().joinVoices([voice]).format([voice], stave.getNoteEndX() - stave.getNoteStartX() - 16)
    voice.draw(ctx, stave)
    beams.forEach((b) => b.setContext(ctx).draw())
  })
}
