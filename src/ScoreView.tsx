import { useEffect, useRef } from 'react'
import { Barline, Beam, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow'
import { beatsToVexDuration, stepToVexKey, type Score } from './music/score'

const ROW_HEIGHT = 150
const STAVE_TOP = 30

export function ScoreView({ score }: { score: Score }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let lastWidth = 0
    const draw = () => {
      const width = Math.floor(el.clientWidth)
      if (width === lastWidth || width === 0) return
      lastWidth = width
      renderScore(el, score, width)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [score])

  return <div ref={ref} className="score" />
}

function renderScore(el: HTMLDivElement, score: Score, width: number) {
  el.replaceChildren()
  // 狭い画面では1段2小節にする
  const barsPerRow = width < 560 ? 2 : 4
  const rows = Math.ceil(score.bars.length / barsPerRow)

  const renderer = new Renderer(el, Renderer.Backends.SVG)
  renderer.resize(width, rows * ROW_HEIGHT)
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
    const y = row * ROW_HEIGHT + STAVE_TOP

    const stave = new Stave(x, y, w)
    if (col === 0) {
      stave.addClef('treble')
      if (row === 0) stave.addTimeSignature(`${score.beatsPerBar}/4`)
      stave.setMeasure(index + 1)
    }
    if (index === score.bars.length - 1) stave.setEndBarType(Barline.type.END)
    stave.setContext(ctx).draw()

    const notes = bar.map((n) => {
      const duration = beatsToVexDuration(n.beats)
      const note =
        n.step === null
          ? new StaveNote({ keys: ['b/4'], duration: `${duration}r` })
          : new StaveNote({ keys: [stepToVexKey(n.step)], duration, autoStem: true })
      if (duration.endsWith('d')) Dot.buildAndAttach([note], { all: true })
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
