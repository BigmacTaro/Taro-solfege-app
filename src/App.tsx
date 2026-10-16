import { useCallback, useState } from 'react'
import { AboutDialog } from './AboutDialog'
import { resetAudio } from './audio/engine'
import { Header } from './Header'
import { INSTRUMENTS } from './instruments'
import { PitchLab } from './PitchLab'
import { ScoreTab } from './ScoreTab'
import { load, save } from './storage'
import { useSettings } from './useSettings'

type Tab = 'score' | 'pitch'

const noop = () => {}

export function App() {
  const settings = useSettings()
  const [tab, setTab] = useState<Tab>('score')
  // マイクを使っている間は、AGCなど途中で変えられない設定をロックする
  const [locked, setLocked] = useState(false)
  const onLock = useCallback((v: boolean) => setLocked(v), [])
  // 「音声をリセット」を押した回数。各タブは、増えたら再生・録音を止める
  const [resetTick, setResetTick] = useState(0)
  // 最低限の説明は、初めて開いたときだけ自動で出す。くわしくは、ヘッダーの「ⓘ」(別タブ)で読む
  const [aboutOpen, setAboutOpen] = useState(() => !load('aboutSeen', false))
  const closeAbout = useCallback(() => {
    setAboutOpen(false)
    save('aboutSeen', true)
  }, [])
  const onReset = useCallback(async () => {
    setResetTick((t) => t + 1)
    await resetAudio()
  }, [])

  return (
    <>
      <Header s={settings} locked={locked} onReset={onReset} />
      {aboutOpen && <AboutDialog onClose={closeAbout} />}
      <main>
        <div className="tabs" role="tablist">
          <button
            role="tab"
            className="tab"
            aria-selected={tab === 'score'}
            disabled={locked}
            onClick={() => setTab('score')}
          >
            譜読み課題
          </button>
          <button
            role="tab"
            className="tab"
            aria-selected={tab === 'pitch'}
            disabled={locked}
            onClick={() => setTab('pitch')}
          >
            マイクテスト
          </button>
          <label className="instsel">
            <span>楽器</span>
            <select
              value={settings.instrument.id}
              disabled={locked}
              onChange={(e) => settings.setInstrumentId(e.target.value)}
              aria-label="楽器(移調楽器の選択)"
            >
              {INSTRUMENTS.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.short}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 切り替えても楽譜と結果が消えないよう、非表示にして保持する */}
        <div hidden={tab !== 'score'}>
          <ScoreTab s={settings} onLock={tab === 'score' ? onLock : noop} resetTick={resetTick} />
        </div>
        <div hidden={tab !== 'pitch'}>
          <PitchLab s={settings} onLock={tab === 'pitch' ? onLock : noop} resetTick={resetTick} />
        </div>
      </main>
    </>
  )
}
