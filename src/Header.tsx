import { useState } from 'react'
import type { Settings } from './useSettings'

/** 画面上部に常に表示するマイク感度。細かいマイク設定は「マイク設定」ボタンで開く */
export function Header({ s, locked }: { s: Settings; locked: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <header className="topbar">
      <div className="topbar-row">
        <label className="sens">
          <span className="lbl">
            <i className="emoji">🎤</i>マイク感度
          </span>
          <input
            type="range"
            min={1}
            max={20}
            step={0.5}
            value={s.mic.gain}
            onChange={(e) => s.setGain(Number(e.target.value))}
            aria-label="マイク感度"
          />
          <b>×{s.mic.gain.toFixed(1)}</b>
        </label>
        <button className="secondary gear" onClick={() => setOpen(!open)} aria-expanded={open}>
          ⚙ マイク設定 {open ? '▲' : '▼'}
        </button>
      </div>
      {open && (
        <div className="topbar-detail">
          <p className="muted small hint">
            スマートフォンでは、感度を×3.0以上にすると音を拾いやすくなることがあります。
          </p>
          <label>
            <input type="checkbox" checked={s.mic.agc} disabled={locked} onChange={(e) => s.setAgc(e.target.checked)} />{' '}
            自動音量調整(AGC)
          </label>
          <label>
            <input type="checkbox" checked={s.mic.ns} disabled={locked} onChange={(e) => s.setNs(e.target.checked)} />{' '}
            ノイズ抑制
          </label>
          {s.devices.length > 1 && (
            <label className="field">
              入力デバイス
              <select value={s.mic.deviceId} disabled={locked} onChange={(e) => s.setDeviceId(e.target.value)}>
                <option value="">既定</option>
                {s.devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            入力の遅れの補正: {s.latencyMs}ms
            <input
              type="range"
              min={-200}
              max={500}
              step={10}
              value={s.latencyMs}
              onChange={(e) => s.setLatencyMs(Number(e.target.value))}
            />
          </label>
          <details className="adv">
            <summary>上級者モード</summary>
            <label>
              <input type="checkbox" checked={s.checkShort} onChange={(e) => s.setCheckShort(e.target.checked)} />{' '}
              音価の短さも評価する(短すぎる音を指摘)
            </label>
          </details>
          <p className="muted small">
            判定結果で全体に「遅れ」が出るときに上げると、タイミングのずれが小さくなります(Bluetoothイヤホンなどで有効)。
            AGC・ノイズ抑制・入力デバイスは、課題の途中では変更できません。
          </p>
        </div>
      )}
    </header>
  )
}
