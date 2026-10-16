import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { micErrorMessage, startMic, type MicHandle } from './audio/mic'
import { freqToNote, type NoteInfo } from './pitch'
import type { Settings } from './useSettings'

const HISTORY_SEC = 6
const MIDI_MIN = 36 // C2
const MIDI_MAX = 84 // C6

interface Sample {
  t: number
  midi: number | null
}

/** マイク入力の確認用。音名とセントのずれをリアルタイムに表示する */
export function PitchLab({ s, onLock }: { s: Settings; onLock: (locked: boolean) => void }) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState<NoteInfo | null>(null)
  const [written, setWritten] = useState<NoteInfo | null>(null)
  const [freq, setFreq] = useState(0)
  const [level, setLevel] = useState(0)
  const [noteLang, setNoteLang] = useState<'ja' | 'en'>('ja')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const micRef = useRef<MicHandle | null>(null)
  const offsetRef = useRef(s.instrument.offset)
  offsetRef.current = s.instrument.offset

  useEffect(() => micRef.current?.setGain(s.mic.gain), [s.mic.gain])
  useEffect(() => onLock(running), [running, onLock])
  useEffect(
    () => () => {
      micRef.current?.stop()
    },
    [],
  )

  const start = async () => {
    setError('')
    const history: Sample[] = []
    try {
      const mic = await startMic(s.mic, (f) => {
        setLevel(f.rms)
        if (f.freq !== null) {
          setNote(freqToNote(f.freq))
          // 移調楽器では、実音から記譜音(楽譜に書く音)も求める
          setWritten(freqToNote(f.freq / 2 ** (offsetRef.current / 12)))
          setFreq(f.freq)
        } else {
          setNote(null)
          setWritten(null)
        }
        history.push({ t: f.t, midi: f.freq === null ? null : freqToNote(f.freq).midi })
        while (history.length && f.t - history[0].t > HISTORY_SEC) history.shift()
        drawHistory(canvasRef.current, history, f.t)
      })
      micRef.current = mic
      s.setDevices(mic.devices)
      setRunning(true)
    } catch (e) {
      setError(micErrorMessage(e))
    }
  }

  const stop = () => {
    micRef.current?.stop()
    micRef.current = null
    setRunning(false)
    setNote(null)
    setWritten(null)
    setLevel(0)
  }

  // ブラウザの仕様上、音はユーザー操作の後でないと鳴らせない
  const playRef = async (name: string) => {
    await Tone.start()
    const synth = new Tone.Synth().toDestination()
    synth.triggerAttackRelease(name, '1', undefined, 0.6)
    setTimeout(() => synth.dispose(), 2000)
  }

  const label = (n: NoteInfo) => `${noteLang === 'ja' ? n.ja : n.en}${n.octave}`
  const cents = note?.cents ?? 0
  const inTolerance = Math.abs(cents) <= 50
  const transposing = s.instrument.offset !== 0

  return (
    <section>
      <p className="muted">マイクに向かって歌う/演奏すると、音名とずれ(セント)が出ます。</p>

      <div className="row">
        {running ? (
          <button className="danger" onClick={stop}>
            ■ 停止
          </button>
        ) : (
          <button onClick={start}>🎤 マイク開始</button>
        )}
        <label className="inline">
          音名{' '}
          <select value={noteLang} onChange={(e) => setNoteLang(e.target.value as 'ja' | 'en')}>
            <option value="ja">ドレミ</option>
            <option value="en">CDE</option>
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="readout">
        <div className="note">{note ? label(note) : '—'}</div>
        {transposing && (
          <div className="muted">{written ? `記譜: ${label(written)}(実音を表示中)` : '記譜: —'}</div>
        )}
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
          <button key={n} className="secondary" onClick={() => playRef(n)}>
            {n}
          </button>
        ))}
      </div>
    </section>
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
