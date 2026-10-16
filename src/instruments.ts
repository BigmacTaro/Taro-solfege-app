export interface Instrument {
  id: string
  name: string
  /** 選択肢に出す短い名前 */
  short: string
  /** 実音 − 記譜音 の半音数(例: B♭管は記譜より長2度低く鳴るので -2) */
  offset: number
}

export const INSTRUMENTS: Instrument[] = [
  { id: 'c', short: '移調なし(C)', name: '移調なし(声・ピアノ・フルート・ヴァイオリンなど)', offset: 0 },
  { id: 'bb', short: 'B♭管', name: 'B♭管(クラリネット・トランペット・ソプラノサックス)', offset: -2 },
  { id: 'eb-alto', short: 'E♭管 アルトサックス', name: 'E♭管(アルトサックス)', offset: -9 },
  { id: 'bb-tenor', short: 'B♭管 テナーサックス', name: 'B♭管(テナーサックス)', offset: -14 },
  { id: 'eb-bari', short: 'E♭管 バリトンサックス', name: 'E♭管(バリトンサックス)', offset: -21 },
  { id: 'f', short: 'F管 ホルン', name: 'F管(ホルン)', offset: -7 },
  { id: 'a', short: 'A管', name: 'A管(クラリネット in A)', offset: -3 },
]

export const DEFAULT_INSTRUMENT = INSTRUMENTS[0]

export function findInstrument(id: string): Instrument {
  return INSTRUMENTS.find((i) => i.id === id) ?? DEFAULT_INSTRUMENT
}

const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']

/** 記譜のド(C)が実音で何の音になるか。例: B♭管なら "B♭" */
export function soundingNameOfWrittenC(inst: Instrument): string {
  return FLAT_NAMES[(((60 + inst.offset) % 12) + 12) % 12]
}
