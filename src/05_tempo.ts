import type {
  Note,
  Preset,
  Passes,
  EnginePlan,
  Quantized,
  QuantOpts,
  AssembleMeta,
  QuantChord,
  QuantPitch,
  QuantNote,
  HistoryRecord,
  DecodeResult,
} from './types.js'
let alpha_override: number | null = null
export function set_alpha_override(v: number | null): void {
  alpha_override = v
}

import * as notes from './04_notes.js'

let i: number = 0
let m: number = 0

export interface Onset {
  t: number
  w: number
}
export function collect_onsets(notes: Note[]): Onset[] {
  let starts = notes
    .map(function (n: Note) {
      return { t: n.start, w: n.amp }
    })
    .sort(function (a: Onset, b: Onset) {
      return a.t - b.t
    })
  const out: Onset[] = []
  for (let i = 0; i < starts.length; i++) {
    let last = out[out.length - 1]
    if (last && starts[i].t - last.t < 0.025) {
      last.w = Math.max(last.w, starts[i].w)
    } else {
      out.push({ t: starts[i].t, w: starts[i].w })
    }
  }
  return out
}

export function estimate_bpm(notes: Note[], duration: number) {
  let onsets = collect_onsets(notes)
  if (onsets.length < 5) return 120

  let bin = 0.01
  let len = Math.max(64, Math.ceil(Math.min(duration, 90) / bin))
  let train = new Float32Array(len)
  for (let i = 0; i < onsets.length; i++) {
    let idx = Math.round(onsets[i].t / bin)
    if (idx >= 0 && idx < len) train[idx] += 0.3 + onsets[i].w
  }

  let lag_min = Math.round(0.24 / bin)
  let lag_max = Math.min(len - 1, Math.round(1.5 / bin))
  let PRIOR_CENTER = 0.5
  let PRIOR_SIGMA = 0.7
  let best_lag = 0,
    best_score = -Infinity
  for (let lag = lag_min; lag <= lag_max; lag++) {
    let score = 0
    for (let t = 0; t + lag < len; t++) {
      score += train[t] * train[t + lag]
    }

    let lag2 = lag * 2
    if (lag2 < len) {
      let s2 = 0
      for (let t2 = 0; t2 + lag2 < len; t2 += 2)
        s2 += train[t2] * train[t2 + lag2]
      score += s2 * 0.4
    }

    let lg = Math.log((lag * bin) / PRIOR_CENTER)
    score *= Math.exp(-(lg * lg) / (2 * PRIOR_SIGMA * PRIOR_SIGMA))
    if (score > best_score) {
      best_score = score
      best_lag = lag
    }
  }
  if (!best_lag) return 120

  let bpm = 60 / (best_lag * bin)

  while (bpm < 70) bpm *= 2
  while (bpm > 185) bpm /= 2
  return Math.round(bpm)
}

export function fit_phase(notes: Note[], bpm: number) {
  let onsets = collect_onsets(notes)
  if (!onsets.length) return 0
  let beat = 60 / bpm
  let sin_sum = 0,
    cos_sum = 0
  for (let i = 0; i < onsets.length; i++) {
    let theta = ((onsets[i].t % beat) / beat) * Math.PI * 2
    let w = 0.3 + onsets[i].w
    sin_sum += Math.sin(theta) * w
    cos_sum += Math.cos(theta) * w
  }
  let mean_theta = Math.atan2(sin_sum, cos_sum)
  if (mean_theta < 0) mean_theta += Math.PI * 2
  let phase = (mean_theta / (Math.PI * 2)) * beat

  let first = onsets[0].t
  while (phase > first + beat * 0.5) phase -= beat
  if (phase < 0) phase = ((phase % beat) + beat) % beat
  return phase
}

export function track_beats(notes: Note[], duration: number, bpm_hint: number) {
  let onsets = collect_onsets(notes)
  let tau0 = 60 / (bpm_hint || 120)
  if (onsets.length < 4 || duration < tau0 * 2) {
    return beats_from_bpm(bpm_hint || 120, 0, duration)
  }

  let bin = 0.01
  let len = Math.ceil(duration / bin) + 1
  let env = new Float32Array(len)
  for (let i = 0; i < onsets.length; i++) {
    let c = onsets[i].t / bin
    let w = 0.3 + onsets[i].w
    for (let d = -3; d <= 3; d++) {
      let idx = Math.round(c + d)
      if (idx >= 0 && idx < len) env[idx] += w * Math.exp(-(d * d) / 4)
    }
  }
  let emax = 0
  for (i = 0; i < len; i++) if (env[i] > emax) emax = env[i]
  if (emax > 0) for (i = 0; i < len; i++) env[i] /= emax

  let ALPHA = alpha_override != null ? alpha_override : 5
  let lo = Math.max(1, Math.round((tau0 * 0.45) / bin))
  let hi = Math.round((tau0 * 1.9) / bin)
  let C = new Float32Array(len).fill(-1e9)
  let bp = new Int32Array(len).fill(-1)
  for (i = 0; i < len; i++) {
    let base = env[i]
    if (i < lo) {
      C[i] = base
      continue
    }
    let best = base
    let bj = -1
    let j0 = Math.max(0, i - hi)
    for (let j = i - lo; j >= j0; j--) {
      if (C[j] <= -1e8) continue
      let r = Math.log(((i - j) * bin) / tau0)
      let v = C[j] - ALPHA * r * r + base
      if (v > best) {
        best = v
        bj = j
      }
    }
    C[i] = best
    bp[i] = bj
  }

  let end0 = Math.max(0, len - Math.round((tau0 * 1.2) / bin))
  let bi = end0
  for (i = end0; i < len; i++) if (C[i] > C[bi]) bi = i
  let beats: number[] = []
  while (bi >= 0) {
    beats.push(bi * bin)
    bi = bp[bi]
  }
  beats.reverse()
  if (beats.length < 2) return beats_from_bpm(bpm_hint || 120, 0, duration)

  let refined = beats.map(function (b) {
    let c0 = Math.max(0, Math.round((b - 0.06) / bin))
    let c1 = Math.min(len - 1, Math.round((b + 0.06) / bin))
    let wsum = 0,
      tsum = 0
    for (let k = c0; k <= c1; k++) {
      wsum += env[k]
      tsum += env[k] * k * bin
    }
    return wsum > 0.05 ? tsum / wsum : b
  })
  for (let m = 1; m < refined.length; m++) {
    if (refined[m] <= refined[m - 1] + 0.05) refined[m] = refined[m - 1] + 0.05
  }
  let ib: number[] = []
  for (m = 1; m < refined.length; m++) ib.push(refined[m] - refined[m - 1])
  let sm = ib.slice()
  for (m = 1; m < ib.length - 1; m++) {
    let tri = [ib[m - 1], ib[m], ib[m + 1]].sort(function (a2, b2) {
      return a2 - b2
    })
    sm[m] = (ib[m] + tri[1]) / 2
  }
  beats = [refined[0]]
  for (m = 0; m < sm.length; m++) beats.push(beats[beats.length - 1] + sm[m])

  let first_ibi = beats[1] - beats[0]
  while (beats[0] - first_ibi > -first_ibi * 0.5)
    beats.unshift(beats[0] - first_ibi)
  let last_ibi = beats[beats.length - 1] - beats[beats.length - 2]
  while (beats[beats.length - 1] + last_ibi < duration + last_ibi * 0.5) {
    beats.push(beats[beats.length - 1] + last_ibi)
  }
  return beats
}

export function beats_from_bpm(bpm: number, phase: number, duration: number) {
  let q = 60 / (bpm || 120)
  let beats: number[] = []
  let t = phase || 0
  while (t > 0) t -= q
  for (; t < duration + q; t += q) beats.push(t)
  return beats
}
