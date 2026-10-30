import type { PassThresholds } from '../types'

export interface Seg {
  s: number
  e: number
}
export interface Cand {
  bin: number
  s: number
  e: number
  mean: number
  head_mean: number
  peak: number
  onset_peak: number
  onset_shift: number
  ghost: boolean
}
export interface NoteEvent {
  startFrame: number
  durationFrames: number
  pitchMidi: number
  amplitude: number
  onsetShift?: number
}
export interface TimedNote {
  start: number
  dur: number
  pitch: number
  amp: number
}

export const AUDIO_SAMPLE_RATE = 22050
export const FFT_HOP = 256
const ANNOTATIONS_FPS = Math.floor(AUDIO_SAMPLE_RATE / FFT_HOP)
const ANNOT_N_FRAMES = ANNOTATIONS_FPS * 2
const AUDIO_N_SAMPLES = AUDIO_SAMPLE_RATE * 2 - FFT_HOP
const WINDOW_OFFSET =
  (FFT_HOP / AUDIO_SAMPLE_RATE) * (ANNOT_N_FRAMES - AUDIO_N_SAMPLES / FFT_HOP) +
  0.0018
export const MIDI_OFFSET = 21
export const N_BINS = 88

export function model_frame_to_time(frame: number): number {
  return (
    (frame * FFT_HOP) / AUDIO_SAMPLE_RATE -
    WINDOW_OFFSET * Math.floor(frame / ANNOT_N_FRAMES)
  )
}

export function median3(col: Float32Array, T: number): Float32Array {
  const out = new Float32Array(T)
  if (T > 0) out[0] = col[0]
  if (T > 1) out[T - 1] = col[T - 1]
  for (let t = 1; t < T - 1; t++) {
    const a = col[t - 1],
      b = col[t],
      c = col[t + 1]
    out[t] = a > b ? (b > c ? b : a > c ? c : a) : a > c ? a : b > c ? c : b
  }
  return out
}

const EPS = 1e-3
const LOG_STAY_ON = Math.log(0.94)
const LOG_EXIT = Math.log(0.06)

const THETA = 0.1
const LOGIT_THETA = Math.log(THETA / (1 - THETA))

function score_on(f: number): number {
  const x = f < EPS ? EPS : f > 1 - EPS ? 1 - EPS : f
  return Math.log(x / (1 - x)) - LOGIT_THETA
}

export function viterbi_segments(
  frame_col: Float32Array,
  onset_col: Float32Array,
  T: number,
): Seg[] {
  if (!T) return []
  const back_on = new Uint8Array(T)
  const back_off = new Uint8Array(T)

  let v_on = Math.log(0.02) + score_on(frame_col[0])
  let v_off = Math.log(0.98)

  for (let t = 1; t < T; t++) {
    const on_ev = Math.min(0.5, 0.004 + 0.45 * onset_col[t])
    const log_enter = Math.log(on_ev)
    const log_stay_off = Math.log(1 - on_ev)
    const e_on = score_on(frame_col[t])

    const on_from_on = v_on + LOG_STAY_ON
    const on_from_off = v_off + log_enter
    const off_from_on = v_on + LOG_EXIT
    const off_from_off = v_off + log_stay_off

    let n_on, n_off
    if (on_from_on >= on_from_off) {
      n_on = on_from_on + e_on
      back_on[t] = 1
    } else {
      n_on = on_from_off + e_on
      back_on[t] = 0
    }
    if (off_from_on >= off_from_off) {
      n_off = off_from_on
      back_off[t] = 1
    } else {
      n_off = off_from_off
      back_off[t] = 0
    }
    v_on = n_on
    v_off = n_off
  }

  const state = new Uint8Array(T)
  let cur = v_on > v_off ? 1 : 0
  state[T - 1] = cur
  for (let t = T - 1; t > 0; t--) {
    cur = cur === 1 ? back_on[t] : back_off[t]
    state[t - 1] = cur
  }

  const segs = []
  let s = -1
  for (let t = 0; t < T; t++) {
    if (state[t] === 1) {
      if (s < 0) s = t
    } else if (s >= 0) {
      segs.push({ s, e: t })
      s = -1
    }
  }
  if (s >= 0) segs.push({ s, e: T })
  return segs
}

export function split_at_onsets(
  seg: Seg,
  onset_col: Float32Array,
  thresh: number,
  min_len: number,
): Seg[] {
  const cuts = []
  let last = seg.s
  for (let t = seg.s + min_len; t <= seg.e - min_len; t++) {
    const o = onset_col[t]
    if (
      o >= thresh &&
      o >= onset_col[t - 1] &&
      o > onset_col[t + 1] &&
      t - last >= min_len
    ) {
      cuts.push(t)
      last = t
    }
  }
  if (!cuts.length) return [seg]
  const out = []
  let s = seg.s
  for (const c of cuts) {
    out.push({ s, e: c })
    s = c
  }
  out.push({ s, e: seg.e })
  return out
}

function seg_stats(
  seg: Seg,
  frame_col: Float32Array,
  onset_col: Float32Array,
): {
  mean: number
  head_mean: number
  peak: number
  onset_peak: number
  onset_shift: number
} {
  let sum = 0,
    peak = 0
  for (let t = seg.s; t < seg.e; t++) {
    sum += frame_col[t]
    if (frame_col[t] > peak) peak = frame_col[t]
  }

  const head_e = Math.min(seg.e, seg.s + 12)
  let hsum = 0
  for (let t = seg.s; t < head_e; t++) hsum += frame_col[t]
  const head_mean = hsum / Math.max(1, head_e - seg.s)

  const w0 = Math.max(0, seg.s - 1)
  const w1 = Math.min(seg.e, seg.s + 4)
  let opk = 0,
    opk_t = seg.s
  for (let t = w0; t < w1; t++) {
    if (onset_col[t] > opk) {
      opk = onset_col[t]
      opk_t = t
    }
  }

  let onset_shift = 0
  if (opk > 0 && opk_t > 0 && opk_t < onset_col.length - 1) {
    const ym = onset_col[opk_t - 1],
      y0 = onset_col[opk_t],
      yp = onset_col[opk_t + 1]
    const denom = ym - 2 * y0 + yp
    let frac = 0
    if (denom < -1e-9) frac = (0.5 * (ym - yp)) / denom
    if (frac > 0.5) frac = 0.5
    if (frac < -0.5) frac = -0.5
    onset_shift = opk_t - seg.s + frac
    if (onset_shift > 3) onset_shift = 3
    if (onset_shift < -1) onset_shift = -1
  }
  return {
    mean: sum / Math.max(1, seg.e - seg.s),
    head_mean,
    peak,
    onset_peak: opk,
    onset_shift,
  }
}

export function envelope_corr(
  col_a: Float32Array,
  col_b: Float32Array,
  s: number,
  e: number,
): number {
  const n = e - s
  if (n < 4) return 0
  let ma = 0,
    mb = 0
  for (let t = s; t < e; t++) {
    ma += col_a[t]
    mb += col_b[t]
  }
  ma /= n
  mb /= n
  let cov = 0,
    va = 0,
    vb = 0
  for (let t = s; t < e; t++) {
    const da = col_a[t] - ma,
      db = col_b[t] - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  if (va < 1e-9 || vb < 1e-9) return 0
  return cov / Math.sqrt(va * vb)
}

const GHOST_INTERVALS = [12, 19, 24]

export function suppress_ghosts(
  cands: Cand[],
  frames_t: Float32Array[],
): number {
  const by_bin = new Map()
  for (const c of cands) {
    if (!by_bin.has(c.bin)) by_bin.set(c.bin, [])
    by_bin.get(c.bin).push(c)
  }
  let removed = 0
  for (const c of cands) {
    if (c.onset_peak >= 0.5) continue
    for (const d of GHOST_INTERVALS) {
      const parents = by_bin.get(c.bin - d)
      if (!parents) continue
      for (const p of parents) {
        if (p.ghost) continue
        const ov = Math.min(p.e, c.e) - Math.max(p.s, c.s)
        if (ov < 0.7 * (c.e - c.s)) continue
        if (p.mean < 1.6 * c.mean) continue
        const corr = envelope_corr(frames_t[p.bin], frames_t[c.bin], c.s, c.e)
        if (corr >= 0.9) {
          c.ghost = true
          removed++
        }
        if (c.ghost) break
      }
      if (c.ghost) break
    }
  }
  return removed
}

export function extract_notes(
  frames_t: Float32Array[],
  onsets_t: Float32Array[],
  T: number,
  passes: { precision: PassThresholds; recall: PassThresholds },
): { precision: NoteEvent[]; recall: NoteEvent[]; ghosts_removed: number } {
  const min_len_split = 3
  const resplit_onset = 0.45

  const smooth = new Array(N_BINS)
  for (let b = 0; b < N_BINS; b++) smooth[b] = median3(frames_t[b], T)

  const cands: Cand[] = []
  for (let b = 0; b < N_BINS; b++) {
    const segs = viterbi_segments(smooth[b], onsets_t[b], T)
    for (const seg of segs) {
      for (const piece of split_at_onsets(
        seg,
        onsets_t[b],
        resplit_onset,
        min_len_split,
      )) {
        const st = seg_stats(piece, smooth[b], onsets_t[b])
        cands.push({
          bin: b,
          s: piece.s,
          e: piece.e,
          mean: st.mean,
          head_mean: st.head_mean,
          peak: st.peak,
          onset_peak: st.onset_peak,
          onset_shift: st.onset_shift,
          ghost: false,
        })
      }
    }
  }

  const ghosts_removed = suppress_ghosts(cands, smooth)

  function pass_filter(pass: PassThresholds): NoteEvent[] {
    const out = []
    for (const c of cands) {
      if (c.ghost) continue
      if (c.e - c.s < pass.min_frames) continue
      if (c.head_mean < pass.frame) continue

      if (
        c.onset_peak < pass.onset &&
        !(
          c.head_mean >= Math.max(pass.frame * 1.9, 0.5) &&
          c.e - c.s >= 2 * pass.min_frames
        )
      )
        continue
      out.push({
        startFrame: c.s,
        durationFrames: c.e - c.s,
        pitchMidi: c.bin + MIDI_OFFSET,
        amplitude: Math.min(1, c.head_mean),
        onsetShift: c.onset_shift,
      })
    }
    return out
  }

  return {
    precision: pass_filter(passes.precision),
    recall: pass_filter(passes.recall),
    ghosts_removed,
  }
}

export function events_to_time(events: NoteEvent[]): TimedNote[] {
  const hop_sec = FFT_HOP / AUDIO_SAMPLE_RATE
  return events
    .map((n) => {
      const shift = typeof n.onsetShift === 'number' ? n.onsetShift : 0
      const t0 = model_frame_to_time(n.startFrame) + shift * hop_sec
      const t1 = model_frame_to_time(n.startFrame + n.durationFrames)
      return {
        start: Math.max(0, t0),
        dur: Math.max(0.01, t1 - t0),
        pitch: n.pitchMidi,
        amp: Math.max(0, Math.min(1, n.amplitude)),
      }
    })
    .filter((n) => n.pitch >= 21 && n.pitch <= 108)
}
