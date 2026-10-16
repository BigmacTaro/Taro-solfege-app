/**
 * iPhoneのSafariでは、Webの音は「音声セッション」の種類で出方が変わる。
 * - 'playback': 消音スイッチ(サイレントモード)が入っていても鳴り、メインのスピーカーから出る。
 * - 'play-and-record': マイクを使うとき。出力が受話口(小さな音)に回ることがある。
 * マイクを使い終わったあとも録音用のまま残り、再生が小さくなる・鳴らなくなることがあるので、
 * 使い終わったら再生用に戻す。この機能がないブラウザ(PC・Android)では何もしない。
 */
type AudioSessionType = 'auto' | 'playback' | 'play-and-record' | 'transient' | 'transient-solo' | 'ambient'

export function setAudioSession(type: AudioSessionType) {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: AudioSessionType } }
    if (nav.audioSession) nav.audioSession.type = type
  } catch {
    // 対応していない環境では、何もしなくてよい
  }
}
