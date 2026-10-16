import { useEffect, useMemo, useRef, useState } from 'react'
import { micErrorMessage, startMic, type MicHandle, type PitchFrame } from './audio/mic'
import { ensureAudioRunning, recreateAudioContext } from './audio/engine'
import { playScore, type BeatInfo, type PlayHandle } from './audio/player'
import { evaluate } from './eval/evaluate'
import { soundingNameOfWrittenC } from './instruments'
import { generateScore } from './music/generator'
import { DEFAULT_CUSTOM, type CustomOptions, type KeyChoice, type Level, type MeterId, type Score, type ShortestNote } from './music/score'
import { ResultTimeline } from './ResultTimeline'
import { ScoreView } from './ScoreView'
import { load, save } from './storage'
import type { Settings } from './useSettings'

type Mode = 'idle' | 'melody' | 'practice' | 'judging'

interface Run {
  score: Score
  frames: PitchFrame[]
  t0: number
  tempo: number
  transpose: number
  /** 課題の間もクリックを鳴らしたか */
  click: boolean
}

/** マイクを開いてから、カウントを鳴らし始めるまでの待ち時間 */
const MIC_SETTLE_MS = 1000

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced', 'custom']
const LEVEL_LABEL: Record<Level, string> = { beginner: '初級', intermediate: '中級', advanced: '上級', custom: 'カスタム' }
const parseLevel = (v: string): Level => (LEVELS.includes(v as Level) ? (v as Level) : 'beginner')

// カスタム設定の選択肢
const METER_CHOICES: [CustomOptions['meter'], string][] = [['4/4', '4/4'], ['3/4', '3/4'], ['6/8', '6/8'], ['random', 'おまかせ']]
const SHORTEST_CHOICES: [ShortestNote, string, string][] = [
  ['quarter', '四分音符まで', '四分'],
  ['eighth', '八分音符まで', '八分'],
  ['triplet', '三連符まで', '三連符'],
  ['sixteenth', '十六分音符まで', '十六分'],
]
const SYNC_CHOICES: [boolean, string][] = [[false, 'なし'], [true, 'あり(タイを含む)']]
const KEY_CHOICES: [KeyChoice, string, string][] = [
  ['c-major', 'ハ長調だけ', 'ハ長調'],
  ['major', '長調だけ', '長調'],
  ['major-minor', '長調と短調', '長調・短調'],
  ['church', 'チャーチモード', 'チャーチ'],
]
const ACC_CHOICES: [3 | 5, string][] = [[3, '3つまで'], [5, '5つまで']]

/** 保存された設定を、今の選択肢に合うものだけ受け入れる */
function parseCustom(v: unknown): CustomOptions {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<CustomOptions>
  const pick = <T,>(choices: readonly (readonly [T, string, ...string[]])[], x: unknown, fallback: T): T => (choices.some(([c]) => c === x) ? (x as T) : fallback)
  return {
    meter: pick(METER_CHOICES, o.meter, DEFAULT_CUSTOM.meter),
    shortest: pick(SHORTEST_CHOICES, o.shortest, DEFAULT_CUSTOM.shortest),
    syncopation: pick(SYNC_CHOICES, o.syncopation, DEFAULT_CUSTOM.syncopation),
    keys: pick(KEY_CHOICES, o.keys, DEFAULT_CUSTOM.keys),
    maxAccidentals: pick(ACC_CHOICES, o.maxAccidentals, DEFAULT_CUSTOM.maxAccidentals),
  }
}

/** 折りたたんだときに見える、設定の要約 */
function customSummary(c: CustomOptions): string {
  const meter = c.meter === 'random' ? '拍子おまかせ' : c.meter
  const shortest = SHORTEST_CHOICES.find(([v]) => v === c.shortest)![2]
  const key = KEY_CHOICES.find(([v]) => v === c.keys)![2]
  return `${meter}・${shortest}・シンコペ${c.syncopation ? '有' : '無'}・${key}`
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 再生を始めてから、最初の拍が1つも来ない(音声が動き出さない)と判断するまでの時間 */
const WATCHDOG_MS = 3500

/** 録音を止めてから判定するまでの余白(最後の音の余韻・遅れて届く音を拾う) */
const TAIL_MS = 800

export function ScoreTab({ s, onLock, resetTick }: { s: Settings; onLock: (locked: boolean) => void; resetTick: number }) {
  const [level, setLevel] = useState<Level>(() => parseLevel(load<string>('level', 'beginner')))
  const [custom, setCustom] = useState<CustomOptions>(() => parseCustom(load<unknown>('custom', DEFAULT_CUSTOM)))
  const [score, setScore] = useState(() => generateScore(undefined, level, custom))
  const [tempo, setTempo] = useState(() => load('tempo', 80))
  const [click, setClick] = useState(() => load('click', true))
  const [mode, setMode] = useState<Mode>('idle')
  const [status, setStatus] = useState('')
  /** 今鳴っている拍(メトロノームの可視化用)。鳴っていなければ null */
  const [beat, setBeat] = useState<BeatInfo | null>(null)
  const [error, setError] = useState('')
  const [run, setRun] = useState<Run | null>(null)

  const handleRef = useRef<PlayHandle | null>(null)
  const micRef = useRef<MicHandle | null>(null)
  const framesRef = useRef<PitchFrame[]>([])
  /** 開始のたびに増やす番号。中止・再開始された古い処理の続きが動かないようにする */
  const runIdRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 再生を始めてから、拍が1つでも来たか */
  const gotBeatRef = useRef(false)

  useEffect(() => save('tempo', tempo), [tempo])
  useEffect(() => save('click', click), [click])
  useEffect(() => save('level', level), [level])
  useEffect(() => save('custom', custom), [custom])
  useEffect(() => micRef.current?.setGain(s.mic.gain), [s.mic.gain])
  useEffect(() => onLock(mode === 'practice' || mode === 'judging'), [mode, onLock])
  useEffect(() => () => halt(), [])
  // 「音声をリセット」が押されたら、再生・録音を止める
  useEffect(() => {
    if (resetTick > 0) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTick])

  const busy = mode !== 'idle'

  /** 再生・録音をすべて止める(結果は捨てる) */
  function halt() {
    runIdRef.current++
    clearTimeout(timerRef.current)
    clearTimeout(watchdogRef.current)
    handleRef.current?.stop()
    handleRef.current = null
    micRef.current?.stop()
    micRef.current = null
  }

  const stop = () => {
    halt()
    setMode('idle')
    setStatus('')
    setBeat(null)
  }

  const onBeat = (i: BeatInfo) => {
    gotBeatRef.current = true
    setBeat(i)
  }

  /**
   * 再生を始めても音声の時計が動かず、拍が1つも来ないとき(iPhoneのSafariで起こる)は、
   * 止めて音声を作り直し、利用者に伝える。そのままだと、ブラウザを再起動するまで直らない
   */
  const armWatchdog = (myRun: number) => {
    gotBeatRef.current = false
    clearTimeout(watchdogRef.current)
    watchdogRef.current = setTimeout(async () => {
      if (runIdRef.current !== myRun || gotBeatRef.current) return
      halt()
      setMode('idle')
      setStatus('')
      setBeat(null)
      setError(
        '音声が動き出しませんでした(iPhoneのSafariで起きることがあります)。音声を作り直したので、もう一度押してください。' +
          'それでも直らないときは、上の「マイク設定」を開いて「音声をリセット」を押してください。',
      )
      await recreateAudioContext()
    }, WATCHDOG_MS)
  }

  const playModel = async () => {
    halt()
    const myRun = runIdRef.current
    // 音声の時計が動いているか確かめる(止まっていれば作り直す)。クリックの中の最初の await で呼ぶ
    await ensureAudioRunning()
    if (runIdRef.current !== myRun) return
    setError('')
    setMode('melody')
    handleRef.current = playScore(score, {
      tempo,
      transpose: s.instrument.offset,
      melody: true,
      click,
      countInClick: click,
      onBeat,
      onEnd: () => {
        handleRef.current = null
        setMode('idle')
        setStatus('')
        setBeat(null)
      },
    })
    armWatchdog(myRun)
  }

  const startPractice = async () => {
    halt()
    const myRun = runIdRef.current
    setError('')
    setRun(null)
    framesRef.current = []
    setMode('practice')
    setStatus('マイクを準備中…')
    // 音声の時計が動いているか確かめる(止まっていれば作り直す)。クリックの中の最初の await で呼ぶ
    await ensureAudioRunning()
    if (runIdRef.current !== myRun) return
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
      countInClick: click,
      onBeat,
      onEnd: () => {
        if (runIdRef.current !== myRun) return
        // 最後の音の余韻まで録音してから判定する
        setMode('judging')
        setBeat(null)
        setStatus('判定中…')
        timerRef.current = setTimeout(() => {
          micRef.current?.stop()
          micRef.current = null
          handleRef.current = null
          setRun({ score, frames: framesRef.current.slice(), t0: handle.startTime, tempo, transpose, click })
          setMode('idle')
          setStatus('')
        }, TAIL_MS)
      },
    })
    handleRef.current = handle
    armWatchdog(myRun)
  }

  const changeScore = () => {
    stop()
    setRun(null)
    setScore(generateScore(undefined, level, custom))
  }

  /** 初級・中級を切り替え、そのレベルで楽譜を作り直す */
  const changeLevel = (next: Level) => {
    if (next === level) return
    stop()
    setRun(null)
    setLevel(next)
    setScore(generateScore(undefined, next, custom))
  }

  /** カスタム設定を変え、その設定で楽譜を作り直す */
  const changeCustom = (patch: Partial<CustomOptions>) => {
    const next = { ...custom, ...patch }
    stop()
    setRun(null)
    setCustom(next)
    setScore(generateScore(undefined, 'custom', next))
  }

  const result = useMemo(
    () =>
      run
        ? evaluate(run.score, run.frames, {
            tempo: run.tempo,
            t0: run.t0,
            transpose: run.transpose,
            latencyMs: s.latencyMs,
            checkShort: s.checkShort,
            clickDuringBars: run.click,
          })
        : null,
    [run, s.latencyMs, s.checkShort],
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
        <div className="notice-line" aria-live="polite">
          {beat ? (
            <BeatDots info={beat} perBar={score.beatsPerBar} />
          ) : status ? (
            <span className="status">{status}</span>
          ) : (
            <span className="notice">
              「課題開始」を押すと<b>カウントが{score.meter.countIn}つ</b>流れます。そのあとで、<b>演奏(歌唱)を始めてください</b>。
            </span>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="controls">
        {mode === 'melody' ? (
          <button className="danger" onClick={stop}>
            ■ 停止
          </button>
        ) : (
          <>
            <button className="secondary play" onClick={playModel} disabled={busy}>
              ▶ お手本を聴く
            </button>
            <div className="seg" role="group" aria-label="難易度">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  className="toggle"
                  aria-pressed={l === level}
                  disabled={busy}
                  onClick={() => changeLevel(l)}
                >
                  {LEVEL_LABEL[l]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {level === 'custom' && (
        <details className="custompanel">
          <summary>
            <span>⚙ カスタム設定</span>
            <span className="muted small custom-summary">{customSummary(custom)}</span>
          </summary>
          <OptionGroup label="拍子" value={custom.meter} choices={METER_CHOICES} disabled={busy} onChange={(v) => changeCustom({ meter: v })} />
          <OptionGroup label="最短の音符" value={custom.shortest} choices={SHORTEST_CHOICES} disabled={busy} onChange={(v) => changeCustom({ shortest: v })} />
          <OptionGroup label="シンコペーション" value={custom.syncopation} choices={SYNC_CHOICES} disabled={busy} onChange={(v) => changeCustom({ syncopation: v })} />
          <OptionGroup label="調" value={custom.keys} choices={KEY_CHOICES} disabled={busy} onChange={(v) => changeCustom({ keys: v })} />
          <OptionGroup
            label="調号の数"
            value={custom.maxAccidentals}
            choices={ACC_CHOICES}
            disabled={busy || custom.keys === 'c-major'}
            onChange={(v) => changeCustom({ maxAccidentals: v })}
          />
          <p className="muted small">設定を変えると、その設定で楽譜を作り直します。</p>
        </details>
      )}

      <p className="muted small mannerhint">📱 マナーモードはOFFに(課題中のクリックは鳴ります)</p>

      <div className="tempo-row">
        <label htmlFor="tempo">
          テンポ {score.meter.beatLen === 1.5 ? '♩.' : '♩'}={tempo}
        </label>
        <input
          id="tempo"
          type="range"
          min={40}
          max={180}
          step={1}
          value={tempo}
          disabled={busy}
          onChange={(e) => setTempo(Number(e.target.value))}
        />
        <label className={`chip${click ? ' on' : ''}${busy ? ' off' : ''}`} title="OFFにすると、カウントも含めて無音になります(画面の丸の点滅だけで拍を示します)">
          <input type="checkbox" checked={click} disabled={busy} onChange={(e) => setClick(e.target.checked)} />
          <span aria-hidden="true">{click ? '✓' : '○'}</span> クリック音
        </label>
      </div>

      {transposing && (
        <p className="info">
          {inst.name}: 楽譜は記譜(読む音)のまま表示します。実音は記譜より{inst.interval}鳴ります
          (楽譜のドは、実音では<b>{soundingNameOfWrittenC(inst)}</b>)。
        </p>
      )}

      <div className="scorebar">
        <div className="scoreinfo">
          <b>{LEVEL_LABEL[(run ? run.score : score).level]}</b>・{(run ? run.score : score).key.ja}・
          {(run ? run.score : score).meter.id}
          <span className="muted small"> 番号 {run ? run.score.seed : score.seed}</span>
        </div>
        <button className="secondary newscore" onClick={changeScore} disabled={busy}>
          🔄 別の楽譜に変える
        </button>
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

/** メトロノームの可視化: 拍の数だけ丸を並べ、今の拍を光らせる(1拍目は大きい丸) */
function BeatDots({ info, perBar }: { info: BeatInfo; perBar: number }) {
  const label = info.phase === 'countin' ? 'カウント' : `${info.bar + 1}小節目`
  return (
    <div className={`beatdots ${info.phase}`} aria-label={`${label} ${info.beat + 1}拍目`}>
      <span className="beatlabel">{label}</span>
      {Array.from({ length: perBar }, (_, i) => (
        <i key={i} className={`dot${i === 0 ? ' first' : ''}${i === info.beat ? ' on' : ''}`} />
      ))}
    </div>
  )
}

/** カスタム設定の1項目(選択肢をトグルで並べる) */
function OptionGroup<T extends string | number | boolean>({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string
  value: T
  choices: readonly (readonly [T, string, ...string[]])[]
  disabled: boolean
  onChange: (v: T) => void
}) {
  return (
    <div className="optgroup">
      <span className="optlabel">{label}</span>
      <div className="seg opts" role="group" aria-label={label}>
        {choices.map(([v, text]) => (
          <button key={String(v)} className="toggle" aria-pressed={v === value} disabled={disabled} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
