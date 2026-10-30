import type { Note } from '../types'
export const HIRES_SR = 16000
export const SEG_SAMPLES = HIRES_SR * 10
export const SEG_HOP = SEG_SAMPLES >> 1
export const FPS = 100
export const BEGIN_NOTE = 21
export const CLASSES = 88

export const ONSET_THRESHOLD = 0.3
export const OFFSET_THRESHOLD = 0.3
export const FRAME_THRESHOLD = 0.1

export function enframe(audio: Float32Array): Float32Array[] {
  const padded_len = Math.ceil(audio.length / SEG_SAMPLES) * SEG_SAMPLES
  const x = new Float32Array(padded_len)
  x.set(audio, 0)
  const segs: Float32Array[] = []
  let p = 0
  while (p + SEG_SAMPLES <= padded_len) {
    segs.push(x.subarray(p, p + SEG_SAMPLES))
    p += SEG_HOP
  }
  return segs
}

export interface SegOut {
  data: Float32Array
  F: number
}
export function deframe(
  seg_outputs: SegOut[],
  C: number,
): { data: Float32Array; T: number } {
  const N = seg_outputs.length
  if (N === 1) {
    return { data: seg_outputs[0].data.slice(), T: seg_outputs[0].F }
  }
  const F = seg_outputs[0].F - 1
  const q = F >> 2
  const parts: [number, number, number][] = []
  parts.push([0, 0, 3 * q])
  for (let i = 1; i < N - 1; i++) parts.push([i, q, 3 * q])
  parts.push([N - 1, q, F])

  let T = 0
  for (const [, s, e] of parts) T += e - s
  const out = new Float32Array(T * C)
  let w = 0
  for (const [i, s, e] of parts) {
    out.set(seg_outputs[i].data.subarray(s * C, e * C), w)
    w += (e - s) * C
  }
  return { data: out, T }
}

export function binarize_regression(
  reg: Float32Array,
  T: number,
  C: number,
  threshold: number,
  neighbour: number,
): { binary: Uint8Array; shift: Float32Array } {
  const binary = new Uint8Array(T * C)
  const shift = new Float32Array(T * C)
  for (let k = 0; k < C; k++) {
    for (let n = neighbour; n < T - neighbour; n++) {
      const xn = reg[n * C + k]
      if (xn <= threshold) continue

      let mono = true
      for (let i = 0; i < neighbour; i++) {
        if (reg[(n - i) * C + k] < reg[(n - i - 1) * C + k]) {
          mono = false
          break
        }
        if (reg[(n + i) * C + k] < reg[(n + i + 1) * C + k]) {
          mono = false
          break
        }
      }
      if (!mono) continue
      binary[n * C + k] = 1
      const prev = reg[(n - 1) * C + k]
      const next = reg[(n + 1) * C + k]

      shift[n * C + k] =
        prev > next
          ? (next - prev) / (xn - next) / 2
          : (next - prev) / (xn - prev) / 2
    }
  }
  return { binary, shift }
}

export function note_detection_column(
  frame_col: Float32Array,
  onset_col: Uint8Array,
  onset_shift_col: Float32Array,
  offset_col: Uint8Array,
  offset_shift_col: Float32Array,
  velocity_col: Float32Array,
  frame_threshold: number,
  T: number,
): number[][] {
  const out: number[][] = []
  let bgn: number | null = null
  let frame_disappear = null
  let offset_occur = null

  for (let i = 0; i < T; i++) {
    if (onset_col[i] === 1) {
      if (bgn) {
        const fin = Math.max(i - 1, 0)
        out.push([bgn, fin, onset_shift_col[bgn], 0, velocity_col[bgn]])
        frame_disappear = null
        offset_occur = null
      }
      bgn = i
    }

    if (bgn && i > bgn) {
      if (frame_col[i] <= frame_threshold && !frame_disappear) {
        frame_disappear = i
      }
      if (offset_col[i] === 1 && !offset_occur) {
        offset_occur = i
      }
      if (frame_disappear) {
        let fin
        if (
          offset_occur &&
          offset_occur - bgn > frame_disappear - offset_occur
        ) {
          fin = offset_occur
        } else {
          fin = frame_disappear
        }
        out.push([
          bgn,
          fin,
          onset_shift_col[bgn],
          offset_shift_col[fin],
          velocity_col[bgn],
        ])
        bgn = null
        frame_disappear = null
        offset_occur = null
      }
      if (bgn && (i - bgn >= 600 || i === T - 1)) {
        const fin = i
        out.push([
          bgn,
          fin,
          onset_shift_col[bgn],
          offset_shift_col[fin],
          velocity_col[bgn],
        ])
        bgn = null
        frame_disappear = null
        offset_occur = null
      }
    }
  }
  return out
}

export interface DetectOpts {
  onset_threshold?: number
  offset_threshold?: number
  frame_threshold?: number
  onset_neighbour?: number
}
export function detect_notes(
  reg_onset: Float32Array,
  reg_offset: Float32Array,
  frame: Float32Array,
  velocity: Float32Array,
  T: number,
  opts?: DetectOpts,
): Note[] {
  const o = opts || {}
  const on_th = o.onset_threshold != null ? o.onset_threshold : ONSET_THRESHOLD
  const off_th =
    o.offset_threshold != null ? o.offset_threshold : OFFSET_THRESHOLD
  const fr_th = o.frame_threshold != null ? o.frame_threshold : FRAME_THRESHOLD

  const on_nb = o.onset_neighbour != null ? o.onset_neighbour : 2
  const on = binarize_regression(reg_onset, T, CLASSES, on_th, on_nb)
  const off = binarize_regression(reg_offset, T, CLASSES, off_th, 4)

  const notes = []
  const fcol = new Float32Array(T)
  const ocol = new Uint8Array(T)
  const oscol = new Float32Array(T)
  const ffcol = new Uint8Array(T)
  const fscol = new Float32Array(T)
  const vcol = new Float32Array(T)

  for (let k = 0; k < CLASSES; k++) {
    for (let t = 0; t < T; t++) {
      const idx = t * CLASSES + k
      fcol[t] = frame[idx]
      ocol[t] = on.binary[idx]
      oscol[t] = on.shift[idx]
      ffcol[t] = off.binary[idx]
      fscol[t] = off.shift[idx]
      vcol[t] = velocity[idx]
    }
    const tuples = note_detection_column(
      fcol,
      ocol,
      oscol,
      ffcol,
      fscol,
      vcol,
      fr_th,
      T,
    )
    for (const tp of tuples) {
      const onset_time = (tp[0] + tp[2]) / FPS
      const offset_time = (tp[1] + tp[3]) / FPS
      let vel = Math.floor(tp[4] * 128)
      if (vel < 1) vel = 1
      if (vel > 127) vel = 127
      notes.push({
        start: Math.max(0, onset_time),
        dur: Math.max(0.01, offset_time - onset_time),
        pitch: k + BEGIN_NOTE,
        velocity: vel,
        amp: Math.max(0, Math.min(1, tp[4])),
      })
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return notes
}

export function frame_only_rescue(
  frame: Float32Array,
  velocity: Float32Array,
  T: number,
  existing_notes: Note[],
  opts?: { th_frame?: number; min_frames?: number },
): Note[] {
  const o = opts || {}
  const th_frame = o.th_frame != null ? o.th_frame : 0.5
  const min_frames = o.min_frames != null ? o.min_frames : 15

  const covered = new Array(CLASSES)
  for (let k = 0; k < CLASSES; k++) covered[k] = []
  for (const n of existing_notes) {
    const k = n.pitch - BEGIN_NOTE
    if (k < 0 || k >= CLASSES) continue
    covered[k].push([
      Math.floor(n.start * FPS) - 2,
      Math.ceil((n.start + n.dur) * FPS) + 2,
    ])
  }

  const rescued = []
  for (let k = 0; k < CLASSES; k++) {
    let s0 = -1
    for (let t = 0; t <= T; t++) {
      const active = t < T && frame[t * CLASSES + k] >= th_frame
      if (active) {
        if (s0 < 0) s0 = t
      } else if (s0 >= 0) {
        const e0 = t
        if (e0 - s0 >= min_frames) {
          let overlap = 0
          for (const [cs, ce] of covered[k]) {
            const ov = Math.min(ce, e0) - Math.max(cs, s0)
            if (ov > 0) overlap += ov
          }
          if (overlap < 0.5 * (e0 - s0)) {
            const v_raw = velocity[Math.min(T - 1, s0 + 2) * CLASSES + k]
            let vel = Math.floor(v_raw * 128)
            if (vel < 1) vel = 1
            if (vel > 127) vel = 127
            rescued.push({
              start: s0 / FPS,
              dur: Math.max(0.01, (e0 - s0) / FPS),
              pitch: k + BEGIN_NOTE,
              velocity: vel,
              amp: Math.max(0.05, Math.min(1, v_raw)),
            })
          }
        }
        s0 = -1
      }
    }
  }
  return rescued
}

export const SEG_HOP_FAST = 128000
export const HOP_FRAMES = SEG_HOP_FAST / 160
export const SEG_FRAMES = 1001
const RAMP = SEG_FRAMES - 1 - HOP_FRAMES

export interface SegPlan {
  n_seg: number
  padded_len: number
  total_frames: number
}
export function plan_segments(audio_len: number): SegPlan {
  const n_seg =
    audio_len <= SEG_SAMPLES
      ? 1
      : Math.ceil((audio_len - SEG_SAMPLES) / SEG_HOP_FAST) + 1
  return {
    n_seg,
    padded_len: (n_seg - 1) * SEG_HOP_FAST + SEG_SAMPLES,
    total_frames: (n_seg - 1) * HOP_FRAMES + SEG_FRAMES,
  }
}

export interface BlendAcc {
  out: Float32Array
  wsum: Float32Array
  n_seg: number
  C: number
}
export function blend_init(plan: SegPlan, C: number): BlendAcc {
  return {
    out: new Float32Array(plan.total_frames * C),
    wsum: new Float32Array(plan.total_frames),
    n_seg: plan.n_seg,
    C,
  }
}

function seg_weight(f: number, i: number, n_seg: number): number {
  if (i > 0 && f < RAMP) return f / RAMP
  if (i < n_seg - 1 && f > HOP_FRAMES) return (SEG_FRAMES - 1 - f) / RAMP
  return 1
}

export function blend_add(
  acc: BlendAcc,
  i: number,
  seg_data: Float32Array | null,
): void {
  const C = acc.C
  const base_t = i * HOP_FRAMES
  for (let f = 0; f < SEG_FRAMES; f++) {
    const w = seg_weight(f, i, acc.n_seg)
    if (w <= 0) continue
    acc.wsum[base_t + f] += w
    if (seg_data) {
      const src = f * C
      const dst = (base_t + f) * C
      for (let c = 0; c < C; c++) acc.out[dst + c] += w * seg_data[src + c]
    }
  }
}

export function blend_finish(
  acc: BlendAcc,
  audio_len: number,
): { data: Float32Array; T: number } {
  const C = acc.C
  const frames_valid = Math.floor(audio_len / 160) + 1
  const T = Math.min(acc.wsum.length, frames_valid)
  for (let t = 0; t < T; t++) {
    const w = acc.wsum[t]
    if (w > 0 && w !== 1) {
      const base = t * C
      const inv = 1 / w
      for (let c = 0; c < C; c++) acc.out[base + c] *= inv
    }
  }
  return { data: acc.out.subarray(0, T * C), T }
}

export function segment_view(padded: Float32Array, i: number): Float32Array {
  const s = i * SEG_HOP_FAST
  return padded.subarray(s, s + SEG_SAMPLES)
}

export function is_silent(seg: Float32Array): boolean {
  for (let i = 0; i < seg.length; i++) {
    const a = seg[i] < 0 ? -seg[i] : seg[i]
    if (a > 1e-4) return false
  }
  return true
}
