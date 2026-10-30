var HIRES_SR = 16e3
var SEG_SAMPLES = HIRES_SR * 10
var SEG_HOP = SEG_SAMPLES >> 1
var FPS = 100
var BEGIN_NOTE = 21
var CLASSES = 88
var ONSET_THRESHOLD = 0.3
var OFFSET_THRESHOLD = 0.3
var FRAME_THRESHOLD = 0.1
function binarize_regression(reg, T, C, threshold, neighbour) {
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
function note_detection_column(
  frame_col,
  onset_col,
  onset_shift_col,
  offset_col,
  offset_shift_col,
  velocity_col,
  frame_threshold,
  T,
) {
  const out = []
  let bgn = null
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
function detect_notes(reg_onset, reg_offset, frame, velocity, T, opts) {
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
function frame_only_rescue(frame, velocity, T, existing_notes, opts) {
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
var SEG_HOP_FAST = 128e3
var HOP_FRAMES = SEG_HOP_FAST / 160
var SEG_FRAMES = 1001
var RAMP = SEG_FRAMES - 1 - HOP_FRAMES
function plan_segments(audio_len) {
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
function blend_init(plan, C) {
  return {
    out: new Float32Array(plan.total_frames * C),
    wsum: new Float32Array(plan.total_frames),
    n_seg: plan.n_seg,
    C,
  }
}
function seg_weight(f, i, n_seg) {
  if (i > 0 && f < RAMP) return f / RAMP
  if (i < n_seg - 1 && f > HOP_FRAMES) return (SEG_FRAMES - 1 - f) / RAMP
  return 1
}
function blend_add(acc, i, seg_data) {
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
function blend_finish(acc, audio_len) {
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
function segment_view(padded, i) {
  const s = i * SEG_HOP_FAST
  return padded.subarray(s, s + SEG_SAMPLES)
}
function is_silent(seg) {
  for (let i = 0; i < seg.length; i++) {
    const a = seg[i] < 0 ? -seg[i] : seg[i]
    if (a > 1e-4) return false
  }
  return true
}

var BP_SR = 22050
var AUDIO_N_SAMPLES = 43844
var FFT_HOP = 256
var N_OVERLAP = 30
var HALF_OVERLAP = 15
var OVERLAP_LEN = N_OVERLAP * FFT_HOP
var WIN_HOP = AUDIO_N_SAMPLES - OVERLAP_LEN
var FRAMES_PER_WIN = 172
var ANNOTATIONS_FPS = 86
function make_windows(audio) {
  const lead = OVERLAP_LEN >> 1
  const total = lead + audio.length
  const n_win = Math.ceil(total / WIN_HOP)
  const padded_len = (n_win - 1) * WIN_HOP + AUDIO_N_SAMPLES
  const x = new Float32Array(padded_len)
  x.set(audio, lead)
  const wins = []
  for (let i = 0; i < n_win; i++) {
    wins.push(x.subarray(i * WIN_HOP, i * WIN_HOP + AUDIO_N_SAMPLES))
  }
  return wins
}
function n_output_frames(audio_len) {
  return Math.floor(audio_len * (ANNOTATIONS_FPS / BP_SR))
}
function stitch_to_columns(per_win, C, n_frames) {
  const cols = new Array(C)
  for (let c = 0; c < C; c++) cols[c] = new Float32Array(n_frames)
  let t_out = 0
  for (let w = 0; w < per_win.length && t_out < n_frames; w++) {
    const mat = per_win[w]
    for (
      let f = HALF_OVERLAP;
      f < FRAMES_PER_WIN - HALF_OVERLAP && t_out < n_frames;
      f++
    ) {
      const base = f * C
      for (let c = 0; c < C; c++) cols[c][t_out] = mat[base + c]
      t_out++
    }
  }
  return cols
}
function merge_tta_columns(frames_a, onsets_a, frames_b, onsets_b, T) {
  const C = frames_a.length
  for (let c = 0; c < C; c++) {
    const fa = frames_a[c],
      fb = frames_b[c]
    const oa = onsets_a[c],
      ob = onsets_b[c]
    for (let t = 0; t < T; t++) {
      fa[t] = (fa[t] + fb[t]) * 0.5
      if (ob[t] > oa[t]) oa[t] = ob[t]
    }
  }
}

var CFP_FPS = 100
var N_FFT = 4096
var HOP = 160
var SR = 16e3
var GAMMA_SPEC = 0.24
var GAMMA_CEPS = 0.6
var FMIN = 27
var FMAX = 4400
var BEGIN_NOTE2 = 21
var N_PITCH = 88
function make_fft(n) {
  const levels = Math.log2(n) | 0
  const cos_t = new Float64Array(n / 2)
  const sin_t = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos_t[i] = Math.cos((2 * Math.PI * i) / n)
    sin_t[i] = Math.sin((2 * Math.PI * i) / n)
  }
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r = (r << 1) | ((i >>> b) & 1)
    rev[i] = r >>> 0
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1,
        step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half
          const tre = re[l] * cos_t[k] + im[l] * sin_t[k]
          const tim = im[l] * cos_t[k] - re[l] * sin_t[k]
          re[l] = re[j] - tre
          im[l] = im[j] - tim
          re[j] += tre
          im[j] += tim
        }
      }
    }
  }
}
var fft4096 = make_fft(N_FFT)
var hann = (() => {
  const w = new Float64Array(N_FFT)
  for (let i = 0; i < N_FFT; i++)
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N_FFT - 1))
  return w
})()
function midi_to_hz(m) {
  return 440 * Math.pow(2, (m - 69) / 12)
}
var PITCH_SPEC = []
var PITCH_LAG = []
for (let p = 0; p < N_PITCH; p++) {
  const f = midi_to_hz(BEGIN_NOTE2 + p)
  const f_lo = f * Math.pow(2, -30 / 1200),
    f_hi = f * Math.pow(2, 30 / 1200)
  let s_lo = Math.floor((f_lo * N_FFT) / SR),
    s_hi = Math.ceil((f_hi * N_FFT) / SR)
  if (s_lo < 1) s_lo = 1
  if (s_hi >= N_FFT / 2) s_hi = N_FFT / 2 - 1
  PITCH_SPEC.push({ lo: s_lo, hi: s_hi })
  let l_lo = Math.floor(SR / f_hi),
    l_hi = Math.ceil(SR / f_lo)
  if (l_lo < 2) l_lo = 2
  if (l_hi >= N_FFT / 2) l_hi = N_FFT / 2 - 1
  PITCH_LAG.push({ lo: l_lo, hi: l_hi })
}
var BIN_FMIN = Math.max(1, Math.round((FMIN * N_FFT) / SR))
var LAG_MIN = Math.max(2, Math.floor(SR / FMAX))
function cfp_salience(samples) {
  const T = Math.floor(samples.length / HOP) + 1
  const S = new Float32Array(T * N_PITCH)
  const re = new Float64Array(N_FFT)
  const im = new Float64Array(N_FFT)
  const spec = new Float64Array(N_FFT)
  for (let t = 0; t < T; t++) {
    const center = t * HOP
    const start = center - N_FFT / 2
    let energy = 0
    for (let i = 0; i < N_FFT; i++) {
      const idx = start + i
      const v = idx >= 0 && idx < samples.length ? samples[idx] : 0
      const w = v * hann[i]
      re[i] = w
      im[i] = 0
      energy += w * w
    }
    if (energy < 1e-9) continue
    fft4096(re, im)
    for (let i = 0; i < N_FFT; i++) {
      const m = re[i] * re[i] + im[i] * im[i]
      spec[i] = Math.pow(m, GAMMA_SPEC / 2)
    }
    for (let i = 0; i < BIN_FMIN; i++) {
      spec[i] = 0
      spec[N_FFT - 1 - i] = 0
    }
    for (let i = 0; i < N_FFT; i++) {
      re[i] = spec[i]
      im[i] = 0
    }
    fft4096(re, im)
    for (let i = 0; i < N_FFT / 2; i++) {
      const v = re[i] > 0 ? Math.pow(re[i], GAMMA_CEPS) : 0
      re[i] = i < LAG_MIN ? 0 : v
    }
    const base = t * N_PITCH
    for (let p = 0; p < N_PITCH; p++) {
      const sw = PITCH_SPEC[p]
      let smax = 0
      for (let i = sw.lo; i <= sw.hi; i++) if (spec[i] > smax) smax = spec[i]
      const lw = PITCH_LAG[p]
      let lmax = 0
      for (let i = lw.lo; i <= lw.hi; i++) if (re[i] > lmax) lmax = re[i]
      S[base + p] = smax * lmax
    }
  }
  return { S, T }
}
function cfp_scale(sal) {
  const vals = []
  for (let i = 0; i < sal.S.length; i++) if (sal.S[i] > 0) vals.push(sal.S[i])
  if (!vals.length) return 1
  vals.sort((a, b) => a - b)
  return vals[Math.floor(vals.length * 0.95)] || 1
}
function cfp_evidence(sal, scale, start_sec, dur_sec, pitch) {
  const p = pitch - BEGIN_NOTE2
  if (p < 0 || p >= N_PITCH) return 0
  const t0 = Math.max(0, Math.round(start_sec * CFP_FPS))
  const t1 = Math.min(
    sal.T,
    t0 + Math.max(3, Math.min(15, Math.round(dur_sec * CFP_FPS))),
  )
  if (t1 <= t0) return 0
  let sum = 0
  for (let t = t0; t < t1; t++) sum += sal.S[t * N_PITCH + p]
  return sum / (t1 - t0) / (scale || 1)
}

var AUDIO_SAMPLE_RATE = 22050
var FFT_HOP2 = 256
var ANNOTATIONS_FPS2 = Math.floor(AUDIO_SAMPLE_RATE / FFT_HOP2)
var ANNOT_N_FRAMES = ANNOTATIONS_FPS2 * 2
var AUDIO_N_SAMPLES2 = AUDIO_SAMPLE_RATE * 2 - FFT_HOP2
var WINDOW_OFFSET =
  (FFT_HOP2 / AUDIO_SAMPLE_RATE) *
    (ANNOT_N_FRAMES - AUDIO_N_SAMPLES2 / FFT_HOP2) +
  18e-4
var MIDI_OFFSET = 21
var N_BINS = 88
function model_frame_to_time(frame) {
  return (
    (frame * FFT_HOP2) / AUDIO_SAMPLE_RATE -
    WINDOW_OFFSET * Math.floor(frame / ANNOT_N_FRAMES)
  )
}
function median3(col, T) {
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
var EPS = 1e-3
var LOG_STAY_ON = Math.log(0.94)
var LOG_EXIT = Math.log(0.06)
var THETA = 0.1
var LOGIT_THETA = Math.log(THETA / (1 - THETA))
function score_on(f) {
  const x = f < EPS ? EPS : f > 1 - EPS ? 1 - EPS : f
  return Math.log(x / (1 - x)) - LOGIT_THETA
}
function viterbi_segments(frame_col, onset_col, T) {
  if (!T) return []
  const back_on = new Uint8Array(T)
  const back_off = new Uint8Array(T)
  let v_on = Math.log(0.02) + score_on(frame_col[0])
  let v_off = Math.log(0.98)
  for (let t = 1; t < T; t++) {
    const on_ev = Math.min(0.5, 4e-3 + 0.45 * onset_col[t])
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
function split_at_onsets(seg, onset_col, thresh, min_len) {
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
function seg_stats(seg, frame_col, onset_col) {
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
function envelope_corr(col_a, col_b, s, e) {
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
var GHOST_INTERVALS = [12, 19, 24]
function suppress_ghosts(cands, frames_t) {
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
function extract_notes(frames_t, onsets_t, T, passes) {
  const min_len_split = 3
  const resplit_onset = 0.45
  const smooth = new Array(N_BINS)
  for (let b = 0; b < N_BINS; b++) smooth[b] = median3(frames_t[b], T)
  const cands = []
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
  function pass_filter(pass) {
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
function events_to_time(events) {
  const hop_sec = FFT_HOP2 / AUDIO_SAMPLE_RATE
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

function normalize_peak(samples) {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i] < 0 ? -samples[i] : samples[i]
    if (a > peak) peak = a
  }
  if (peak < 1e-5) return
  if (peak > 0.5 && peak < 0.99) return
  let g = 0.95 / peak
  if (g > 20) g = 20
  for (let i = 0; i < samples.length; i++) samples[i] *= g
}
async function run_hires(ort, session, samples, on_progress) {
  const plan = plan_segments(samples.length)
  const padded = new Float32Array(plan.padded_len)
  padded.set(samples, 0)
  const keys = [
    'reg_onset_output',
    'reg_offset_output',
    'frame_output',
    'velocity_output',
  ]
  const accs = {}
  for (const k of keys) accs[k] = blend_init(plan, CLASSES)
  for (let i = 0; i < plan.n_seg; i++) {
    const seg = segment_view(padded, i)
    if (is_silent(seg)) {
      for (const k of keys) blend_add(accs[k], i, null)
    } else {
      const input = new ort.Tensor('float32', seg, [1, SEG_SAMPLES])
      const res = await session.run({ waveform: input })
      for (const k of keys) {
        blend_add(accs[k], i, new Float32Array(res[k].data))
      }
    }
    if (on_progress) {
      on_progress(
        (0.9 * (i + 1)) / plan.n_seg,
        '\u9AD8\u7CBE\u5EA6AI\u3067\u89E3\u6790\u4E2D\u2026',
      )
    }
  }
  const reg_on = blend_finish(accs.reg_onset_output, samples.length)
  const reg_off = blend_finish(accs.reg_offset_output, samples.length)
  const frame = blend_finish(accs.frame_output, samples.length)
  const vel = blend_finish(accs.velocity_output, samples.length)
  const T = reg_on.T
  if (on_progress)
    on_progress(
      0.9,
      '\u97F3\u306E\u7269\u8A3C\uFF08CFP\uFF09\u3092\u8A08\u7B97\u4E2D\u2026',
    )
  const sal = cfp_salience(samples)
  const scale = cfp_scale(sal)
  if (on_progress)
    on_progress(
      0.95,
      '\u97F3\u7B26\u3092\u62BD\u51FA\u4E2D\uFF08\u56DE\u5E30\u5F8C\u51E6\u7406\uFF09\u2026',
    )
  const precision = detect_notes(
    reg_on.data,
    reg_off.data,
    frame.data,
    vel.data,
    T,
  )
  const tiers = [
    {
      opt: {
        onset_threshold: 0.15,
        offset_threshold: 0.3,
        frame_threshold: 0.06,
        onset_neighbour: 1,
      },
      ev: 0.12,
    },
    {
      opt: {
        onset_threshold: 0.08,
        offset_threshold: 0.3,
        frame_threshold: 0.04,
        onset_neighbour: 1,
      },
      ev: 0.2,
    },
  ]
  const recall = precision.slice()
  const seen = (n) =>
    recall.some(
      (q) => q.pitch === n.pitch && Math.abs(q.start - n.start) < 0.03,
    )
  let rejected = 0
  for (const tier of tiers) {
    const cand = detect_notes(
      reg_on.data,
      reg_off.data,
      frame.data,
      vel.data,
      T,
      tier.opt,
    )
    for (const n of cand) {
      if (seen(n)) continue
      if (cfp_evidence(sal, scale, n.start, n.dur, n.pitch) >= tier.ev)
        recall.push(n)
      else rejected++
    }
  }
  const rescued = frame_only_rescue(frame.data, vel.data, T, recall, {
    th_frame: 0.4,
    min_frames: 12,
  })
  for (const n of rescued) {
    if (cfp_evidence(sal, scale, n.start, n.dur, n.pitch) >= 0.3) recall.push(n)
    else rejected++
  }
  return { precision, recall, ghosts_removed: rejected }
}
async function run_bp_once(ort, session, samples, on_progress, p0, p1) {
  const wins = make_windows(samples)
  const per_frames = [],
    per_onsets = []
  const BATCH = 4
  const stride = FRAMES_PER_WIN * N_BINS
  for (let i = 0; i < wins.length; i += BATCH) {
    const n = Math.min(BATCH, wins.length - i)
    const buf = new Float32Array(n * AUDIO_N_SAMPLES)
    for (let b = 0; b < n; b++) buf.set(wins[i + b], b * AUDIO_N_SAMPLES)
    const input = new ort.Tensor('float32', buf, [n, AUDIO_N_SAMPLES, 1])
    const res = await session.run({ 'serving_default_input_2:0': input })
    const fr = res['StatefulPartitionedCall:1'].data
    const on = res['StatefulPartitionedCall:2'].data
    for (let b = 0; b < n; b++) {
      per_frames.push(
        new Float32Array(fr.buffer, fr.byteOffset + b * stride * 4, stride),
      )
      per_onsets.push(
        new Float32Array(on.buffer, on.byteOffset + b * stride * 4, stride),
      )
    }
    if (on_progress) {
      on_progress(
        p0 + (p1 - p0) * ((i + n) / wins.length),
        '\u97F3\u3092\u89E3\u6790\u4E2D\u2026',
      )
    }
  }
  const T = n_output_frames(samples.length)
  return {
    frames_t: stitch_to_columns(per_frames, N_BINS, T),
    onsets_t: stitch_to_columns(per_onsets, N_BINS, T),
    T,
  }
}
async function run_bp(
  ort,
  session,
  samples,
  quality,
  precision_pass,
  recall_pass,
  on_progress,
) {
  const high = quality === 'high'
  const r1 = await run_bp_once(
    ort,
    session,
    samples,
    on_progress,
    0.02,
    high ? 0.45 : 0.9,
  )
  if (!r1.T)
    throw new Error('\u89E3\u6790\u7D50\u679C\u304C\u7A7A\u3067\u3057\u305F')
  let frames_t = r1.frames_t,
    onsets_t = r1.onsets_t,
    T = r1.T
  if (high) {
    if (on_progress)
      on_progress(
        0.46,
        '\u7CBE\u5EA6\u5411\u4E0A\u306E\u305F\u3081\u518D\u89E3\u6790\u4E2D\u2026',
      )
    const shifted = new Float32Array(samples.length + 128)
    shifted.set(samples, 128)
    const r2 = await run_bp_once(ort, session, shifted, on_progress, 0.47, 0.9)
    const T2 = Math.min(T, r2.T)
    merge_tta_columns(frames_t, onsets_t, r2.frames_t, r2.onsets_t, T2)
    T = T2
  }
  if (on_progress)
    on_progress(
      0.92,
      '\u97F3\u7B26\u3092\u62BD\u51FA\u4E2D\uFF08Viterbi\u5FA9\u53F7\uFF09\u2026',
    )
  const ex = extract_notes(frames_t, onsets_t, T, {
    precision: precision_pass,
    recall: recall_pass,
  })
  return {
    precision: events_to_time(ex.precision),
    recall: events_to_time(ex.recall),
    ghosts_removed: ex.ghosts_removed,
  }
}

var BUILD_ID = 'mrma09tt'

var ORT_VER = '1.27.0'
var ORT_BASE =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VER + '/dist/'
var ort_promise = null
var sessions = new Map()
var backend_desc = ''
function load_ort() {
  if (ort_promise) return ort_promise
  ort_promise = import(ORT_BASE + 'ort.min.mjs').then((m) => {
    const ort = m.default || m
    ort.env.wasm.wasmPaths = ORT_BASE
    const cores = (self.navigator && navigator.hardwareConcurrency) || 1
    if (self.crossOriginIsolated) {
      ort.env.wasm.numThreads = Math.max(1, Math.min(4, cores - 1))
      backend_desc = 'wasm\xD7' + String(ort.env.wasm.numThreads)
    } else {
      ort.env.wasm.numThreads = 1
      backend_desc = 'wasm'
    }
    return ort
  })
  return ort_promise
}
function post_progress(id, ratio, text) {
  self.postMessage({ id, type: 'progress', ratio, text })
}
function get_session(url, id, label, p0, p1) {
  const hit = sessions.get(url)
  if (hit) return hit
  const p = (async () => {
    const ort = await load_ort()
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        label +
          '\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\uFF08HTTP ' +
          String(res.status) +
          '\uFF09\u3002models/ \u306E\u914D\u7F6E\u3068\u30B5\u30A4\u30BA\u5236\u9650\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044',
      )
    }
    const total = Number(res.headers.get('Content-Length')) || 0
    let bytes
    if (res.body && total > 1e6) {
      const reader = res.body.getReader()
      const chunks = []
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        got += value.length
        post_progress(
          id,
          p0 + (p1 - p0) * Math.min(1, got / total),
          label + '\u3092\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u4E2D\u2026',
        )
      }
      bytes = new Uint8Array(got)
      let off = 0
      for (const c of chunks) {
        bytes.set(c, off)
        off += c.length
      }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer())
    }
    post_progress(id, p1, label + '\u3092\u521D\u671F\u5316\u4E2D\u2026')
    return ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
  })()
  sessions.set(url, p)
  p.catch(() => sessions.delete(url))
  return p
}
async function with_busy_lock(fn) {
  const locks = navigator.locks
  if (!locks || !locks.request) return fn()
  return locks.request('minamoscore-worker-busy', fn)
}
self.onmessage = (e) => {
  const msg = e.data
  if (!msg || msg.type !== 'transcribe') return
  const id = msg.id
  void with_busy_lock(async () => {
    try {
      if (msg.build !== BUILD_ID) {
        throw new Error(
          '\u914D\u7F6E\u30D5\u30A1\u30A4\u30EB\u304C\u6DF7\u5728\u3057\u3066\u3044\u307E\u3059\uFF08app \u3068 worker \u306E\u30D3\u30EB\u30C9\u304C\u4E0D\u4E00\u81F4\uFF09\u3002\u5168\u30D5\u30A1\u30A4\u30EB\u3092\u4E0A\u66F8\u304D\u3057\u3066\u30B9\u30FC\u30D1\u30FC\u30EA\u30ED\u30FC\u30C9\u3057\u3066\u304F\u3060\u3055\u3044',
        )
      }
      if (
        (msg.engine === 'hires' && msg.rate !== 16e3) ||
        (msg.engine === 'bp' && msg.rate !== 22050)
      ) {
        throw new Error(
          '\u5185\u90E8\u30A8\u30E9\u30FC: \u30A8\u30F3\u30B8\u30F3\u3068\u30B5\u30F3\u30D7\u30EB\u30EC\u30FC\u30C8\u304C\u4E0D\u4E00\u81F4\uFF08' +
            msg.engine +
            '/' +
            String(msg.rate) +
            '\uFF09',
        )
      }
      post_progress(
        id,
        0.01,
        '\u63A1\u8B5C\u30A8\u30F3\u30B8\u30F3\u3092\u6E96\u5099\u4E2D\u2026',
      )
      const ort = await load_ort()
      const samples = msg.samples
      normalize_peak(samples)
      let result
      if (msg.engine === 'hires') {
        const session = await get_session(
          new URL('../models/kong_note_fp16.onnx', self.location.href).href,
          id,
          '\u9AD8\u7CBE\u5EA6\u30D4\u30A2\u30CEAI\uFF08\u521D\u56DE\u306E\u307F\uFF09',
          0.03,
          0.18,
        )
        result = await run_hires(ort, session, samples, (r, text) => {
          post_progress(id, 0.2 + 0.74 * r, text)
        })
      } else {
        const session = await get_session(
          new URL('../models/basic_pitch.onnx', self.location.href).href,
          id,
          '\u63A1\u8B5C\u30E2\u30C7\u30EB',
          0.03,
          0.08,
        )
        result = await run_bp(
          ort,
          session,
          samples,
          msg.quality,
          msg.precision,
          msg.recall,
          (r, text) => {
            post_progress(id, 0.1 + 0.84 * r, text)
          },
        )
      }
      post_progress(id, 0.96, '\u4ED5\u4E0A\u3052\u4E2D\u2026')
      self.postMessage({
        id,
        type: 'done',
        precision: result.precision,
        recall: result.recall,
        backend: backend_desc,
        engine: msg.engine,
        quality: msg.quality,
        ghosts_removed: result.ghosts_removed,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      self.postMessage({ id, type: 'error', message })
    }
  })
}
