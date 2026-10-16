import * as Tone from 'tone'
import { setAudioSession } from './session'

/**
 * iPhoneのSafariでは、マイクの使用や音声経路の切り替えのあとに、音声の時計(AudioContext)が
 * 止まったまま('suspended' / 'interrupted')になることがある。その状態では、カウントが進まず、
 * 音も鳴らず、ブラウザを再起動するまで直らない。
 * ここでは、時計が実際に動いているかを確かめ、動いていなければ作り直す。
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 時間内に終わらなければ、結果を待たずに先へ進む(止まった再開処理に引きずられない) */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, sleep(ms).then(() => undefined)])
}

function rawContext(): AudioContext {
  return Tone.getContext().rawContext as unknown as AudioContext
}

/** 時計が進んでいるか。状態が 'running' でも、時刻が止まっていれば動いていない */
async function clockRuns(): Promise<boolean> {
  const raw = rawContext()
  if (raw.state !== 'running') {
    await withTimeout(raw.resume(), 800).catch(() => undefined)
  }
  if (raw.state !== 'running') return false
  const t0 = raw.currentTime
  await sleep(150)
  return raw.currentTime > t0
}

/** 新しい AudioContext に作り替える。古いものは閉じる */
export async function recreateAudioContext(): Promise<void> {
  const old = Tone.getContext()
  try {
    Tone.setContext(new Tone.Context({ latencyHint: 'interactive' }))
  } catch {
    // 作れなければ、古いものを使い続ける
    return
  }
  try {
    await withTimeout(Promise.resolve(old.dispose()), 800)
  } catch {
    // 古い文脈が閉じられなくても、新しい文脈で動けばよい
  }
  await withTimeout(Tone.getContext().resume(), 800).catch(() => undefined)
}

/**
 * 再生・録音を始める前に呼ぶ。ユーザーの操作(ボタンのクリック)の中で、最初の await として呼ぶこと。
 * (iPhoneでは、操作の外で resume() しても再開できないため)
 */
export async function ensureAudioRunning(): Promise<void> {
  await Tone.start().catch(() => undefined)
  if (await clockRuns()) return
  await recreateAudioContext()
  await clockRuns()
}

/** 「音声をリセット」: 音声の経路と AudioContext を作り直す。ユーザー操作の中で呼ぶ */
export async function resetAudio(): Promise<void> {
  setAudioSession('auto')
  await recreateAudioContext()
  await ensureAudioRunning()
}
