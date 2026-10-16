import { useEffect, useRef } from 'react'

/** くわしい説明のページ(別タブで開く)。public/spec.html */
export const SPEC_URL = './spec.html'

/** 初めて開いたときだけ出す、最低限の説明。くわしくは、ヘッダーの「ⓘ」(別タブ)で読む */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // 焦点は当てるが、スクロールはさせない
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="about-backdrop" onClick={onClose}>
      <div
        className="about mini"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="about-title">ソルフェージュ自習</h2>
        <p>
          楽譜を見て<b>歌う・楽器で演奏する</b>と、<b>音の高さとタイミング</b>を自動で採点する自習アプリです。
        </p>
        <p>「課題開始」を押し、カウントのあとに演奏してください。</p>
        <button ref={closeRef} className="about-close" onClick={onClose}>
          はじめる
        </button>
        <p className="muted small about-note">
          くわしい説明・採点方式は、上の「ⓘ」から(別タブで開きます)。
        </p>
      </div>
    </div>
  )
}
