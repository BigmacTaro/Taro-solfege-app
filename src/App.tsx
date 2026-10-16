import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { playScore, type BeatInfo, type PlayHandle } from './audio/player'
import { load, save } from './storage'
import { PitchLab } from './PitchLab'
import { ScoreView } from './ScoreView'
import { generateScore } from './music/generator'

type Tab = 'score' | 'pitch'

export function App() {
  const [tab, setTab] = useState<Tab>('score')
  const [score, setScore] = useState(() => generateScore())
  const [tempo, setTempo] = useState(() => load('tempo', 80))
  const [click, setClick] = useState(() => load('click', true))
  const [playing, setPlaying] = useState<'melody' | 'metronome' | null>(null)
  const [status, setStatus] = useState('')
  const handleRef = useRef<PlayHandle | null>(null)

  useEffect(() => save('tempo', tempo), [tempo])
  useEffect(() => save('click', click), [click])
  useEffect(() => () => handleRef.current?.stop(), [])

  const stop = () => handleRef.current?.stop()

  const play = async (kind: 'melody' | 'metronome') => {
    stop()
    // ブラウザの仕様上、音はユーザー操作の後でないと鳴らせない
    await Tone.start()
    setPlaying(kind)
    const onBeat = (i: BeatInfo) =>
      setStatus(i.phase === 'countin' ? `カウントイン ${i.beat + 1}` : `${i.bar + 1}小節目 ${i.beat + 1}拍`)
    handleRef.current = playScore(score, {
      tempo,
      melody: kind === 'melody',
      click: kind === 'metronome' || click,
      onBeat,
      onEnd: () => {
        handleRef.current = null
        setPlaying(null)
        setStatus('')
      },
    })
  }

  const changeScore = () => {
    stop()
    setScore(generateScore())
  }

  return (
    <main>
      <h1>ソルフェージュ自習</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'score'} onClick={() => setTab('score')}>
          楽譜
        </button>
        <button role="tab" aria-selected={tab === 'pitch'} onClick={() => setTab('pitch')}>
          ピッチ試作
        </button>
      </div>

      {tab === 'score' ? (
        <section>
          <p className="muted">初級: ハ長調・4/4・八分音符まで。</p>
          <div className="row">
            <button onClick={changeScore}>新しい楽譜</button>
            <span className="muted small">番号: {score.seed}</span>
          </div>
          <label className="field">
            テンポ: ♩={tempo}
            <input
              type="range"
              min={40}
              max={180}
              step={1}
              value={tempo}
              disabled={playing !== null}
              onChange={(e) => setTempo(Number(e.target.value))}
            />
          </label>
          <div className="row">
            {playing ? (
              <button onClick={stop}>■ 停止</button>
            ) : (
              <>
                <button onClick={() => play('melody')}>▶ お手本を聴く</button>
                <button onClick={() => play('metronome')}>♩ メトロノームのみ</button>
              </>
            )}
            <span className="status" aria-live="off">
              {status}
            </span>
          </div>
          <label>
            <input type="checkbox" checked={click} disabled={playing !== null} onChange={(e) => setClick(e.target.checked)} />{' '}
            お手本の再生中もクリックを鳴らす
          </label>
          <ScoreView score={score} />
        </section>
      ) : (
        <PitchLab />
      )}
    </main>
  )
}
