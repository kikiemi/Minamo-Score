export interface Note {
  start: number
  dur: number
  pitch: number
  amp: number
  velocity?: number
  staff?: number
  onsetShift?: number
}

export interface PassThresholds {
  onset: number
  frame: number
  min_frames: number
}

export interface Preset {
  label: string
  precision: PassThresholds
  recall: PassThresholds
  merge_ms: number
  min_dur: number
  min_amp: number
  recall_floor: number
  overlap_trim?: boolean
  dup_ms?: number
  ghost_filter?: boolean
}

export interface Passes {
  precision: Note[]
  recall: Note[]
  ghosts_removed: number
  backend?: string
  engine?: string
  quality?: string
}

export interface EnginePlan {
  engine: 'hires' | 'bp'
  rate: number
}

export interface QuantPitch {
  pitch: number
  velocity: number
}

export interface QuantChord {
  tick: number
  dur: number
  pitches: QuantPitch[]
}

export interface QuantNote {
  tick: number
  dur: number
  pitch: number
  velocity: number
  amp: number
  staff?: number
  step?: number
  src_start?: number
  src_dur?: number
}

export interface Quantized {
  staves: Record<string, QuantChord[]>
  bpm: number
  phase: number
  quarter_sec: number
  base_step: number
  mixed: boolean
  step_label: string
  measure_div: number
  measure_count: number
  ts_num: number
  ts_den: number
  split: number
  beats: number[] | null
  debug_resid: number[] | null
}

export interface QuantOpts {
  bpm: number
  phase: number
  grid: string
  ts_num: number
  ts_den: number
  density: string
  split: number
  beats?: number[] | null
}

export interface AssembleMeta {
  bpm: number
  phase: number
  quarter_sec: number
  base_step: number
  mixed: boolean
  measure_div: number
  ts_num: number
  ts_den: number
  split: number
  density?: string
  beats?: number[] | null
  debug_resid?: number[] | null
}

export interface HistoryRecord {
  id: number
  name: string
  created: string
  duration: number
  notes_count: number
  has_audio?: boolean
  audio_size?: number
  passes: { precision: Note[]; recall: Note[] }
  quality: string
  engine: string
  backend: string
  settings: Record<string, string | number | boolean>
}

export interface DecodeResult {
  samples: Float32Array
  duration: number
}

export interface MidiEvent {
  tick: number
  bytes: number[]
}

export interface ChordGroup {
  t0: number
  t: number
  notes: Note[]
}

export interface MeasureBox {
  measure: number
  x: number
  y: number
  w: number
  h: number
}
