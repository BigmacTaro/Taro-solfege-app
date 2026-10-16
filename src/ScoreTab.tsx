import { useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { micErrorMessage, startMic, type MicHandle, type PitchFrame } from './audio/mic'
import { playScore, type BeatInfo, type PlayHandle } from './audio/player'
import { evaluate } from './eval/evaluate'
import { soundingNameOfWrittenC } from './instruments'
import { generateScore } from './music/generator'
import type { Score } from './music/score'
import { ResultTimeline } from './ResultTimeline'
import { ScoreView } from './ScoreView'
import { load, save } from './storage'
import type { Settings } from './useSettings'

type Mode = 'idle' | 'melody' | 'metronome' | 'practice' | 'judging'

interface Run {
  score: Score
  frames: PitchFrame[]
  t0: number
  tempo: number
  transpose: number
}

/** マイクを開いてから、カウントを鳴らし始めるまでの待ち時間 */
const MIC_SETTLE_MS = 1000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 録音を止めてから判定するまでの余白(最後の音の余韻・遅れて届く音を拾う) */
const TAIL_MS = 800

export function ScoreTab({ s, onLock }: { s: Settings; onLock: (locked: boolean) => void }) {
  const [score, setScore] = useState(() => generateScore())
  const [tempo, setTempo] = useState(() => load('tempo', 80))
  const [click, setClick] = useState(() => load('click', true))
  const [mode, setMode] = useState<Mode>('idle')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [run, setRun] = useState<Run | null>(null)

  const handleRef = useRef<PlayHandle | null>(null)
  const micRef = useRef<MicHandle | null>(null)
  const framesRef = useRef<PitchFrame[]>([])
  /** 開始のたびに増やす番号。中止・再開始された古い処理の続きが動かないようにする */
  const runIdRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => save('tempo', tempo), [tempo])
  useEffect(() => save('click', click), [click])
  useEffect(() => micRef.current?.setGain(s.mic.gain), [s.mic.gain])
  useEffect(() => onLock(mode === 'practice' || mode === 'judging'), [mode, onLock])
  useEffect(() => () => halt(), [])

  const busy = mode !== 'idle'

  /** 再生・録音をすべて止める(結果は捨てる) */
  function halt() {
    runIdRef.current++
    clearTimeout(timerRef.current)
    handleRef.current?.stop()
    handleRef.current = null
    micRef.current?.stop()
    micRef.current = null
  }

  const stop = () => {
    halt()
    setMode('idle')
    setStatus('')
  }

  const onBeat = (i: BeatInfo) =>
    setStatus(i.phase === 'countin' ? `カウント ${i.beat + 1}` : `${i.bar + 1}小節目`)

  const play = async (kind: 'melody' | 'metronome') => {
    halt()
    const myRun = runIdRef.current
    await Tone.start()
    if (runIdRef.current !== myRun) return
    setError('')
    setMode(kind)
    handleRef.current = playScore(score, {
      tempo,
      transpose: s.instrument.offset,
      melody: kind === 'melody',
      click: kind === 'metronome' || click,
      onBeat,
      onEnd: () => {
        handleRef.current = null
        setMode('idle')
        setStatus('')
      },
    })
  }

  const startPractice = async () => {
    halt()
    const myRun = runIdRef.current
    setError('')
    setRun(null)
    framesRef.current = []
    setMode('practice')
    setStatus('マイクを準備中…')
    try {
      const mic = await startMic(s.mic, (f) => framesRef.current.push(f))
      if (runIdRef.current !== myRun) {
        mic.stop()
        return
      }
      micRef.current = mic
      s.setDevices(mic.devices)
    } catch (e) {
      if (runIdRef.current !== myRun) return
      setError(micErrorMessage(e))
      setMode('idle')
      setStatus('')
      return
    }

    // マイクを開いた直後は、端末の音の経路が切り替わって再生が乱れることがあるので、落ち着くまで待つ
    setStatus('まもなく開始します…')
    await sleep(MIC_SETTLE_MS)
    if (runIdRef.current !== myRun) return

    const transpose = s.instrument.offset
    const handle = playScore(score, {
      tempo,
      transpose,
      lead: 0.4,
      melody: false,
      click,
      onBeat,
      onEnd: () => {
        if (runIdRef.current !== myRun) return
        // 最後の音の余韻まで録音してから判定する
        setMode('judging')
        setStatus('判定中…')
        timerRef.current = setTimeout(() => {
          micRef.current?.stop()
          micRef.current = null
          handleRef.current = null
          setRun({ score, frames: framesRef.current.slice(), t0: handle.startTime, tempo, transpose })
          setMode('idle')
          setStatus('')
        }, TAIL_MS)
      },
    })
    handleRef.current = handle
  }

  const changeScore = () => {
    stop()
    setRun(null)
    setScore(generateScore())
  }

  const result = useMemo(
    () =>
      run
        ? evaluate(run.score, run.frames, {
            tempo: run.tempo,
            t0: run.t0,
            transpose: run.transpose,
            latencyMs: s.latencyMs,
          })
        : null,
    [run, s.latencyMs],
  )

  // 全体に一定方向のずれがあれば、入力の遅れとして補正を提案する
  const meanTimingSec = useMemo(() => {
    if (!result) return 0
    const errs = result.verdicts.flat().flatMap((v) => (v.timingErrSec === null ? [] : [v.timingErrSec]))
    return errs.length >= 4 ? errs.reduce((a, b) => a + b, 0) / errs.length : 0
  }, [result])

  const inst = s.instrument
  const transposing = inst.offset !== 0

  return (
    <section>
      <div className="row">
        <button className="secondary" onClick={changeScore} disabled={busy}>
          新しい楽譜
        </button>
        <span className="muted small">番号: {score.seed}</span>
        <span className="muted small">初級: ハ長調・4/4</span>
      </div>

      <label className="field">
        テンポ: ♩={tempo}
        <input
          type="range"
          min={40}
          max={180}
          step={1}
          value={tempo}
          disabled={busy}
          onChange={(e) => setTempo(Number(e.target.value))}
        />
      </label>

      {transposing && (
        <p className="info">
          {inst.name}: 楽譜は記譜(読む音)のまま表示します。楽譜のドは、実音では
          <b>{soundingNameOfWrittenC(inst)}</b>で鳴ります。
        </p>
      )}

      <div className="startcard">
        {mode === 'practice' || mode === 'judging' ? (
          <button className="start danger" onClick={stop} disabled={mode === 'judging'}>
            ■ 中止
          </button>
        ) : (
          <button className="start" onClick={startPractice} disabled={busy}>
            🎤 課題開始
          </button>
        )}
        <p className="notice">
          「課題開始」を押すと<b>カウントが4つ</b>流れます。そのあとで、<b>演奏(歌唱)を始めてください</b>。
        </p>
        <div className={`status ${status ? 'on' : ''}`} aria-live="polite">
          {status || ' '}
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="row">
        <button className="secondary" onClick={() => play('melody')} disabled={busy}>
          ▶ お手本を聴く
        </button>
        <button className="secondary" onClick={() => play('metronome')} disabled={busy}>
          ♩ メトロノームのみ
        </button>
        {(mode === 'melody' || mode === 'metronome') && (
          <button className="danger" onClick={stop}>
            ■ 停止
          </button>
        )}
        <label className="inline">
          <input type="checkbox" checked={click} disabled={busy} onChange={(e) => setClick(e.target.checked)} />{' '}
          お手本・課題の間もクリックを鳴らす
        </label>
      </div>

      <ScoreView score={run && result ? run.score : score} verdicts={result?.verdicts} />

      {run && result && (
        <div className="results">
          <div className="summary">
            <div className="percent">
              {result.summary.percent}
              <small>点</small>
            </div>
            <ul>
              <li>
                音高 <b>{result.summary.pitchOk}</b>/{result.summary.noteCount}
              </li>
              <li>
                タイミング <b>{result.summary.timingOk}</b>/{result.summary.noteCount}
              </li>
              {result.summary.missed > 0 && <li>聞こえず {result.summary.missed}</li>}
              {result.summary.extra > 0 && <li>余計な音 {result.summary.extra}</li>}
              {result.summary.durationIssues > 0 && <li>長さの指摘 {result.summary.durationIssues}</li>}
              {result.summary.restBroken > 0 && <li>休符 {result.summary.restBroken}</li>}
            </ul>
          </div>

          {result.summary.missed === result.summary.noteCount && (
            <p className="info">
              音が聞き取れませんでした。上の「感度」を上げて、マイクに近づいてもう一度試してください。
            </p>
          )}
          {Math.abs(meanTimingSec) > 0.12 && (
            <p className="info">
              全体に平均 {Math.abs(meanTimingSec).toFixed(2)} 秒{meanTimingSec > 0 ? '遅れ' : '早め'}でした。
              {s.latencyMs === 0 && '入力の遅れが原因のことがあります。'}
              <button
                className="secondary small-btn"
                onClick={() => s.setLatencyMs(Math.max(-200, Math.min(500, Math.round(s.latencyMs + meanTimingSec * 1000))))}
              >
                この分を補正する
              </button>
            </p>
          )}

          <ResultTimeline result={result} frames={run.frames} latencyMs={s.latencyMs} />
          <p className="muted small">
            色: <span className="c-ok">緑=正解</span> / <span className="c-pitch">赤=音高が違う</span> /{' '}
            <span className="c-timing">橙=タイミング・長さの指摘</span> / 灰=聞こえず。音符の下の小さな文字は、ずれの量です
            (¢=セント、100¢=半音。±50¢以内で正解)。タイミングは、この楽譜の最短の音符1つ分(±
            {result.tolSec.toFixed(2)}秒)までのずれが正解です。下のグラフは、灰色の帯が期待した音、点が実際に出した音の高さです
            (オクターブ違いは同じ高さ)。
          </p>
          <div className="row">
            <button onClick={startPractice} disabled={busy}>
              もう一度(同じ楽譜)
            </button>
            <button className="secondary" onClick={changeScore} disabled={busy}>
              新しい楽譜
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
