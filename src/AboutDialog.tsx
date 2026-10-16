import { useEffect, useRef } from 'react'

/** このアプリの説明。初めて開いたときに自動で出し、そのあとはヘッダーの「ⓘ」から開く */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // 焦点は当てるが、スクロールはさせない(先頭のタイトルから読めるように)
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
        className="about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="about-title">ソルフェージュ自習</h2>
        <p>
          楽譜を見て、<b>歌う・楽器で演奏する</b>と、<b>音の高さとタイミング</b>が合っているかを自動で採点する、
          譜読み(ソルフェージュ)の自習アプリです。
        </p>

        <h3>使い方</h3>
        <ol>
          <li>難易度(初級・中級・上級・カスタム)と、楽器を選びます。</li>
          <li>「お手本を聴く」で、楽譜を聴けます(なくても大丈夫です)。</li>
          <li>「課題開始」を押し、カウントのあとに歌う(演奏する)。</li>
          <li>最後まで終えると採点され、楽譜に結果が色分けで出ます。</li>
        </ol>

        <h3>ヒント</h3>
        <ul>
          <li>スマホでは、マイク感度を×3以上にすると音を拾いやすくなります。イヤホンの使用をおすすめします。</li>
          <li>スマホは、マナーモードをOFFにしてください。</li>
          <li>トランペットやサックスなどの移調楽器は、「楽器」で選びます。</li>
          <li>音が出ない・始まらないときは、上の「音声リセット」を押すか、ブラウザをリロードしてください。</li>
          <li>「マイクテスト」で、音の高さの検出を確かめられます。</li>
        </ul>

        <button ref={closeRef} className="about-close" onClick={onClose}>
          閉じる
        </button>
        <p className="muted small about-note">この画面は、上の「ⓘ」ボタンからいつでも開けます。</p>
      </div>
    </div>
  )
}
