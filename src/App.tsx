import { useCallback, useState } from 'react'
import { Header } from './Header'
import { INSTRUMENTS } from './instruments'
import { PitchLab } from './PitchLab'
import { ScoreTab } from './ScoreTab'
import { useSettings } from './useSettings'

type Tab = 'score' | 'pitch'

const noop = () => {}

export function App() {
  const settings = useSettings()
  const [tab, setTab] = useState<Tab>('score')
  // マイクを使っている間は、AGCなど途中で変えられない設定をロックする
  const [locked, setLocked] = useState(false)
  const onLock = useCallback((v: boolean) => setLocked(v), [])

  return (
    <>
      <Header s={settings} locked={locked} />
      <main>
        <div className="tabs" role="tablist">
          <button
            role="tab"
            className="tab"
            aria-selected={tab === 'score'}
            disabled={locked}
            onClick={() => setTab('score')}
          >
            楽譜
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
          <ScoreTab s={settings} onLock={tab === 'score' ? onLock : noop} />
        </div>
        <div hidden={tab !== 'pitch'}>
          <PitchLab s={settings} onLock={tab === 'pitch' ? onLock : noop} />
        </div>
      </main>
    </>
  )
}
