import { useEffect, useRef } from 'react'
import type { PitchFrame } from './audio/mic'
import type { EvalResult } from './eval/evaluate'

const fold = (d: number) => d - 12 * Math.round(d / 12)

/**
 * 期待した音(灰色の帯。高さは±50セントの許容範囲)と、実際に出した音の高さの軌跡(点)を重ねて見せる。
 * 軌跡はオクターブ違いを同じ高さとして、期待した音の近くに折り返して描く。
 */
export function ResultTimeline({
  result,
  frames,
  latencyMs,
}: {
  result: EvalResult
  frames: PitchFrame[]
  latencyMs: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    const { width: w, height: h } = canvas
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    g.clearRect(0, 0, w, h)
    g.fillStyle = dark ? '#1c1c1e' : '#f4f4f6'
    g.fillRect(0, 0, w, h)

    const notes = result.expected.filter((e) => !e.isRest)
    if (notes.length === 0) return
    const t0 = result.expected[0].start
    const last = result.expected[result.expected.length - 1]
    const t1 = last.start + last.dur
    const lo = Math.min(...notes.map((n) => n.midi!)) - 2.5
    const hi = Math.max(...notes.map((n) => n.midi!)) + 2.5
    const x = (t: number) => ((t - t0) / (t1 - t0)) * w
    const y = (m: number) => h - ((m - lo) / (hi - lo)) * h

    // 期待した音
    g.fillStyle = dark ? '#48484a' : '#c7c7cc'
    for (const n of notes) {
      g.fillRect(x(n.start), y(n.midi! + 0.5), Math.max(2, x(n.start + n.dur) - x(n.start) - 2), y(n.midi! - 0.5) - y(n.midi! + 0.5))
    }

    // 実際に出した音の軌跡
    const lat = latencyMs / 1000
    for (const f of frames) {
      if (f.freq === null) continue
      const t = f.t - lat
      if (t < t0 - 0.2 || t > t1 + 0.5) continue
      const m = 69 + 12 * Math.log2(f.freq / 440)
      // その時刻に最も近い期待音の高さの近くへ折り返す
      let near = notes[0]
      for (const n of notes) if (Math.abs(n.start + n.dur / 2 - t) < Math.abs(near.start + near.dur / 2 - t)) near = n
      const mm = near.midi! + fold(m - near.midi!)
      const inTol = t >= near.start && t <= near.start + near.dur && Math.abs(mm - near.midi!) <= 0.5
      g.fillStyle = inTol ? '#1e9e5a' : '#d93025'
      g.fillRect(x(t) - 1, y(mm) - 1.5, 3, 3)
    }
  }, [result, frames, latencyMs])

  return <canvas ref={ref} className="history" width={640} height={200} aria-label="期待した音と実際の音の高さ" />
}
