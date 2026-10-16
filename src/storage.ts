export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`solfege.${key}`)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`solfege.${key}`, JSON.stringify(value))
  } catch {
    // 保存できない環境では設定が残らないだけ
  }
}
