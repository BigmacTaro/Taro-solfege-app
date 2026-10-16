import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { detectPitch, freqToNote, type NoteInfo } from './pitch'

const HISTORY_SEC = 6
const MIDI_MIN = 36 // C2
const MIDI_MAX = 84 // C6

interface Sample {
  t: number
  midi: number | null
}

export function App() {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState<NoteInfo | null>(null)
  const [freq, setFreq] = useState(0)
  const [level, setLevel] = useState(0)
  const [noteLang, setNoteLang] = useState<'ja' | 'en'>('ja')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  const start = async () => {
    setError('')
    try {
      // 歌声の解析には、ノイズ抑制や自動音量調整を切った生に近い音が向いている
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      const ctx = new AudioContext()
      await ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 4096
      source.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      const history: Sample[] = []
      let raf = 0
      let lastMidi: number | null = null

      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        setLevel(Math.sqrt(sum / buf.length))

        const r = detectPitch(buf, ctx.sampleRate)
        const now = performance.now() / 1000
        if (r) {
          const n = freqToNote(r.freq)
          lastMidi = n.midi
          setNote(n)
          setFreq(r.freq)
        } else {
          lastMidi = null
          setNote(null)
        }
        history.push({ t: now, midi: lastMidi })
        while (history.length && now - history[0].t > HISTORY_SEC) history.shift()
        drawHistory(canvasRef.current, history, now)
        raf = requestAnimationFrame(tick)
      }
      tick()

      stopRef.current = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        stopRef.current = null
      }
      setRunning(true)
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'マイクの使用が許可されていません。ブラウザの設定で許可してください。'
          : `マイクを開始できませんでした: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const stop = () => {
    stopRef.current?.()
    setRunning(false)
    setNote(null)
    setLevel(0)
  }

  // ブラウザの仕様上、音はユーザー操作の後でないと鳴らせない
  const playRef = async (name: string) => {
    await Tone.start()
    const synth = new Tone.Synth().toDestination()
    synth.triggerAttackRelease(name, '1', undefined, 0.6)
    setTimeout(() => synth.dispose(), 2000)
  }

  const cents = note?.cents ?? 0
  const inTolerance = Math.abs(cents) <= 50

  return (
    <main>
      <h1>ピッチ検出の試作</h1>
      <p className="muted">マイクに向かって歌う/演奏すると、音名とずれ(セント)が出ます。</p>

      <div className="row">
        {running ? (
          <button onClick={stop}>停止</button>
        ) : (
          <button onClick={start}>マイク開始</button>
        )}
        <label>
          音名{' '}
          <select value={noteLang} onChange={(e) => setNoteLang(e.target.value as 'ja' | 'en')}>
            <option value="ja">ドレミ</option>
            <option value="en">CDE</option>
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="readout" aria-live="off">
        <div className="note">
          {note ? `${noteLang === 'ja' ? note.ja : note.en}${note.octave}` : '—'}
        </div>
        <div className={`cents ${note && !inTolerance ? 'bad' : ''}`}>
          {note ? `${cents >= 0 ? '+' : ''}${cents.toFixed(0)} セント` : '音が検出されていません'}
        </div>
        <div className="meter">
          <div className="center" />
          {note && <div className="needle" style={{ left: `${50 + cents}%` }} />}
        </div>
        <div className="muted small">
          {note ? `${freq.toFixed(1)} Hz` : ''} 音量 {(level * 100).toFixed(0)}
        </div>
      </div>

      <canvas ref={canvasRef} className="history" width={640} height={240} />

      <h2>基準音を鳴らす</h2>
      <div className="row">
        {['C4', 'E4', 'G4', 'A4'].map((n) => (
          <button key={n} onClick={() => playRef(n)}>
            {n}
          </button>
        ))}
      </div>
    </main>
  )
}

function drawHistory(canvas: HTMLCanvasElement | null, history: Sample[], now: number) {
  const g = canvas?.getContext('2d')
  if (!canvas || !g) return
  const { width: w, height: h } = canvas
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  g.clearRect(0, 0, w, h)
  g.fillStyle = dark ? '#1c1c1e' : '#f4f4f6'
  g.fillRect(0, 0, w, h)

  const y = (m: number) => h - ((m - MIDI_MIN) / (MIDI_MAX - MIDI_MIN)) * h
  g.font = '12px system-ui'
  g.textAlign = 'left'
  for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
    if (m % 12 !== 0) continue
    g.strokeStyle = dark ? '#3a3a3c' : '#d0d0d4'
    g.beginPath()
    g.moveTo(0, y(m))
    g.lineTo(w, y(m))
    g.stroke()
    g.fillStyle = dark ? '#8e8e93' : '#6c6c70'
    g.fillText(`C${m / 12 - 1}`, 4, y(m) - 3)
  }

  g.strokeStyle = '#0a84ff'
  g.lineWidth = 2
  g.beginPath()
  let pen = false
  for (const s of history) {
    if (s.midi === null) {
      pen = false
      continue
    }
    const x = w - ((now - s.t) / HISTORY_SEC) * w
    if (pen) g.lineTo(x, y(s.midi))
    else g.moveTo(x, y(s.midi))
    pen = true
  }
  g.stroke()
}
