import { useCallback, useState } from 'react'
import { Header } from './Header'
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
        <h1>ソルフェージュ自習</h1>
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
            ピッチ試作
          </button>
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
