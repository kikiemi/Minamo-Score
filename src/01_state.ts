import type { Preset, Note, Quantized, MeasureBox } from './types.js'

export interface AppState {
  source_file: File | Blob | null
  source_name: string
  source_url: string
  media_recorder: MediaRecorder | null
  record_chunks: Blob[]
  record_blob: Blob | null
  raw_notes: Note[]
  quantized: Quantized | null
  duration: number
  busy: boolean
  page_index: number
  page_count: number
  zoom: number
  measure_boxes: MeasureBox[]
  playing: boolean
  play_pos: number
}

export const S: AppState = {
  source_file: null,
  source_name: '',
  source_url: '',

  media_recorder: null,
  record_chunks: [],
  record_blob: null,

  raw_notes: [],
  quantized: null,
  duration: 0,
  busy: false,

  page_index: 0,
  page_count: 1,
  zoom: 1,
  measure_boxes: [],

  playing: false,
  play_pos: 0,
}

export const presets: Record<string, Preset> = {
  piano: {
    label: 'ピアノ',
    precision: { onset: 0.5, frame: 0.3, min_frames: 11 },
    recall: { onset: 0.24, frame: 0.15, min_frames: 5 },
    merge_ms: 55,
    min_dur: 0.03,
    min_amp: 0.035,
    recall_floor: 0.32,
    ghost_filter: false,
  },
  melody: {
    label: '単体楽器・メロディ',
    precision: { onset: 0.4, frame: 0.28, min_frames: 8 },
    recall: { onset: 0.25, frame: 0.16, min_frames: 5 },
    merge_ms: 70,
    min_dur: 0.045,
    min_amp: 0.06,
    recall_floor: 0.4,
    ghost_filter: true,
  },
  guitar: {
    label: 'ギター',
    precision: { onset: 0.35, frame: 0.25, min_frames: 7 },
    recall: { onset: 0.22, frame: 0.15, min_frames: 5 },
    merge_ms: 60,
    min_dur: 0.04,
    min_amp: 0.05,
    recall_floor: 0.38,
    ghost_filter: true,
  },
  dense: {
    label: '歌入り・複雑',
    precision: { onset: 0.55, frame: 0.32, min_frames: 11 },
    recall: { onset: 0.35, frame: 0.22, min_frames: 8 },
    merge_ms: 70,
    min_dur: 0.05,
    min_amp: 0.07,
    recall_floor: 0.5,
    ghost_filter: true,
  },
}

export const DIV = 24
