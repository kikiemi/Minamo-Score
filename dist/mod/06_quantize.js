let _dp = null
let _dp_cnt = null
let _dp_limit = 0
import * as st from './01_state.js'
import * as util from './00_util.js'
let i = 0
const STEP_LABELS = {
  12: '8\u5206',
  6: '16\u5206',
  3: '32\u5206',
  8: '8\u52063\u9023',
  4: '16\u52063\u9023',
}
const PIECES = [
  { div: 96, type: 'whole', dots: 0 },
  { div: 72, type: 'half', dots: 1 },
  { div: 48, type: 'half', dots: 0 },
  { div: 36, type: 'quarter', dots: 1 },
  { div: 24, type: 'quarter', dots: 0 },
  { div: 18, type: 'eighth', dots: 1 },
  { div: 16, type: 'quarter', dots: 0, tuplet: true },
  { div: 12, type: 'eighth', dots: 0 },
  { div: 9, type: '16th', dots: 1 },
  { div: 8, type: 'eighth', dots: 0, tuplet: true },
  { div: 6, type: '16th', dots: 0 },
  { div: 4, type: '16th', dots: 0, tuplet: true },
  { div: 3, type: '32nd', dots: 0 },
]
const _decomp_cache = new Map()
function decompose(dur) {
  if (dur <= 0) return []
  let cache = _decomp_cache
  if (cache.has(dur)) return cache.get(dur)
  let pieces = PIECES
  let limit = Math.max(dur, 96 * 8)
  if (!_dp || _dp_limit < limit) {
    let dp = new Int16Array(limit + 1).fill(-1)
    let cnt = new Int16Array(limit + 1).fill(32767)
    cnt[0] = 0
    for (let n = 1; n <= limit; n++) {
      for (let pi = 0; pi < pieces.length; pi++) {
        let d = pieces[pi].div
        if (d <= n && cnt[n - d] + 1 < cnt[n]) {
          cnt[n] = cnt[n - d] + 1
          dp[n] = pi
        }
      }
    }
    _dp = dp
    _dp_cnt = cnt
    _dp_limit = limit
  }
  const result = []
  let rem = dur
  while (rem > 0) {
    let pi2 = _dp[rem]
    if (pi2 < 0) {
      let down = rem - 1
      while (down > 0 && _dp[down] < 0) down--
      if (down <= 0) break
      rem = down
      continue
    }
    result.push(pieces[pi2])
    rem -= pieces[pi2].div
  }
  result.sort(function (a, b) {
    return b.div - a.div
  })
  cache.set(dur, result)
  return result
}
function is_decomposable(dur) {
  if (dur === 0) return true
  if (dur < 3) return false
  decompose(3)
  return dur <= _dp_limit && _dp[dur] >= 0
}
function span_ok(start, len, measure_div) {
  if (len <= 0) return len === 0
  let pos = start,
    rem = len
  while (rem > 0) {
    let me = (Math.floor(pos / measure_div) + 1) * measure_div
    let span = Math.min(rem, me - pos)
    if (!is_decomposable(span)) return false
    pos += span
    rem -= span
  }
  return true
}
function pick_grid(notes2, bpm, phase) {
  let quarter = 60 / bpm
  function median_err(step) {
    let step_sec = (quarter * step) / st.DIV
    let errs = []
    for (let i2 = 0; i2 < notes2.length; i2++) {
      let t = notes2[i2].start - phase
      let snapped = Math.round(t / step_sec) * step_sec
      errs.push(Math.abs(t - snapped))
    }
    return util.median(errs)
  }
  let e12 = median_err(12),
    e6 = median_err(6),
    e3 = median_err(3)
  let e8 = median_err(8),
    e4 = median_err(4)
  let triplet_base = e8 < e6 * 0.72 && e8 < e12 * 0.72
  let base
  if (triplet_base) {
    base = e4 < e8 * 0.62 ? 4 : 8
  } else {
    base = 12
    if (e6 < e12 * 0.62) base = 6
    if (base === 6 && e3 < e6 * 0.62) base = 3
  }
  return base
}
function assemble(q_notes, meta) {
  let opts = meta
  let bpm = meta.bpm,
    phase = meta.phase,
    quarter = meta.quarter_sec
  let base_step = meta.base_step,
    mixed = meta.mixed
  let measure_div = meta.measure_div,
    ts_num = meta.ts_num,
    ts_den = meta.ts_den
  for (let si = 0; si < q_notes.length; si++) {
    if (q_notes[si].staff == null) {
      q_notes[si].staff = q_notes[si].pitch >= meta.split ? 1 : 2
    }
  }
  if (opts.density === 'balanced' || opts.density === 'clean') {
    let cap = opts.density === 'balanced' ? 12 : 6
    let by_tick = new Map()
    for (let j = 0; j < q_notes.length; j++) {
      let key = q_notes[j].staff + ':' + q_notes[j].tick
      if (!by_tick.has(key)) by_tick.set(key, [])
      by_tick.get(key).push(q_notes[j])
    }
    let kept = []
    by_tick.forEach(function (group) {
      group.sort(function (a, b) {
        return b.amp - a.amp
      })
      for (let k = 0; k < Math.min(group.length, cap); k++) kept.push(group[k])
    })
    if (opts.density === 'clean') {
      kept = kept.filter(function (n2) {
        return n2.amp >= 0.06
      })
    }
    q_notes = kept
  }
  q_notes.sort(function (a, b) {
    return (
      a.tick - b.tick || (a.staff || 0) - (b.staff || 0) || a.pitch - b.pitch
    )
  })
  const note_staves = { 1: [], 2: [] }
  const staves = { 1: [], 2: [] }
  for (let m = 0; m < q_notes.length; m++)
    note_staves[q_notes[m].staff || 1].push(q_notes[m])
  for (const staff of [1, 2]) {
    let tick_ok2 = function (prev_tick, tick) {
        let gap = tick - prev_tick
        if (gap < 0) return false
        if (gap > 0 && gap < 3) return false
        if (!span_ok(prev_tick, gap, measure_div)) return false
        let r = tick % measure_div
        let to_bar = measure_div - r
        if (r !== 0 && !is_decomposable(to_bar)) return false
        return true
      },
      pick_duration2 = function (tick, desired, room) {
        let limit =
          room === Infinity ? desired + 12 : Math.min(room, desired + 12)
        let best = -1,
          best_diff = Infinity
        for (let dd = 3; dd <= limit; dd++) {
          if (!span_ok(tick, dd, measure_div)) continue
          if (room !== Infinity) {
            let rest = room - dd
            if (rest !== 0) {
              if (rest < 3) continue
              if (!span_ok(tick + dd, rest, measure_div)) continue
            }
          } else {
            let end = tick + dd
            let tail = (Math.floor(end / measure_div) + 1) * measure_div - end
            if (tail !== measure_div && !is_decomposable(tail)) continue
          }
          let diff = Math.abs(dd - desired)
          if (diff < best_diff) {
            best_diff = diff
            best = dd
          }
          if (diff === 0) break
        }
        if (best > 0) return best
        if (room !== Infinity && span_ok(tick, room, measure_div)) return room
        return span_ok(tick, 4, measure_div) ? 4 : 3
      }
    var tick_ok = tick_ok2,
      pick_duration = pick_duration2
    const list = note_staves[staff]
    let chords = []
    for (let a = 0; a < list.length; a++) {
      let last = chords[chords.length - 1]
      if (last && last.tick === list[a].tick) {
        last.pitches.push({ pitch: list[a].pitch, velocity: list[a].velocity })
        if (list[a].dur > last.dur) last.dur = list[a].dur
      } else {
        chords.push({
          tick: list[a].tick,
          dur: list[a].dur,
          pitches: [{ pitch: list[a].pitch, velocity: list[a].velocity }],
        })
      }
    }
    let TICK_DELTAS = [0, 1, -1, 2, -2, 3, -3, 4, -4]
    for (let b = 0; b < chords.length; b++) {
      let prev_tick = b === 0 ? 0 : chords[b - 1].tick
      let fixed = false
      for (let d = 0; d < TICK_DELTAS.length; d++) {
        let cand = chords[b].tick + TICK_DELTAS[d]
        if (cand < prev_tick || cand < 0) continue
        if (tick_ok2(prev_tick, cand)) {
          chords[b].tick = cand
          fixed = true
          break
        }
      }
      if (!fixed && b > 0) chords[b].tick = prev_tick
      if (b > 0 && chords[b].tick === chords[b - 1].tick) {
        let prev = chords[b - 1]
        for (let pz = 0; pz < chords[b].pitches.length; pz++) {
          let exists = prev.pitches.some(function (pp) {
            return pp.pitch === chords[b].pitches[pz].pitch
          })
          if (!exists) prev.pitches.push(chords[b].pitches[pz])
        }
        if (chords[b].dur > prev.dur) prev.dur = chords[b].dur
        chords.splice(b, 1)
        b--
      }
    }
    for (let c2 = 0; c2 < chords.length; c2++) {
      let cur = chords[c2]
      let room =
        c2 + 1 < chords.length ? chords[c2 + 1].tick - cur.tick : Infinity
      let desired = room === Infinity ? cur.dur : Math.min(cur.dur, room)
      cur.dur = pick_duration2(cur.tick, Math.max(3, desired), room)
    }
    staves[staff] = chords
  }
  let total_ticks = 0
  for (const st2 of [1, 2]) {
    let list = staves[st2]
    if (list.length) {
      let last2 = list[list.length - 1]
      total_ticks = Math.max(total_ticks, last2.tick + last2.dur)
    }
  }
  let measure_count = Math.max(1, Math.ceil(total_ticks / measure_div))
  return {
    staves,
    bpm,
    phase,
    quarter_sec: quarter,
    base_step,
    mixed,
    step_label: STEP_LABELS[base_step] + (mixed ? '\uFF0B3\u9023' : ''),
    measure_div,
    measure_count,
    ts_num,
    ts_den,
    split: meta.split,
    beats: meta.beats || null,
    debug_resid: meta.debug_resid || null,
  }
}
function chordify(notes2) {
  let sorted = notes2.slice().sort(function (a, b) {
    return a.start - b.start
  })
  let groups = []
  for (let i2 = 0; i2 < sorted.length; i2++) {
    let g = groups[groups.length - 1]
    if (g && sorted[i2].start - g.t0 < 0.035) {
      g.notes.push(sorted[i2])
      g.t = g.t + (sorted[i2].start - g.t) / g.notes.length
    } else {
      groups.push({
        t0: sorted[i2].start,
        t: sorted[i2].start,
        notes: [sorted[i2]],
      })
    }
  }
  return groups
}
function locate_in_beats(t, beats) {
  let lo = 0,
    hi = beats.length - 1
  while (lo < hi - 1) {
    let mid = (lo + hi) >> 1
    if (beats[mid] <= t) lo = mid
    else hi = mid
  }
  let ibi = Math.max(1e-3, beats[lo + 1] - beats[lo])
  let u = (t - beats[lo]) / ibi
  if (u < 0) u = 0
  return { beat: lo, u, ibi }
}
function snap_u(u, step, ibi) {
  let frac = step / st.DIV
  let k = Math.round(u / frac)
  return { ticks: k * step, err: Math.abs(u - k * frac) * ibi }
}
function pick_grid_beats(groups, beats) {
  let cands = [
    { step: 12, pen: 4e-3 },
    { step: 6, pen: 0 },
    { step: 3, pen: 0.01 },
  ]
  let best = 6,
    best_score = 1e9
  for (let c = 0; c < cands.length; c++) {
    let errs = []
    for (let i2 = 0; i2 < groups.length; i2++) {
      let loc = locate_in_beats(groups[i2].t, beats)
      let s = snap_u(loc.u, cands[c].step, loc.ibi)
      let s3 = snap_u(loc.u, 8, loc.ibi)
      errs.push(Math.min(s.err, s3.err))
    }
    errs.sort(function (a, b) {
      return a - b
    })
    let med = errs.length ? errs[errs.length >> 1] : 0
    let score = med + cands[c].pen
    if (score < best_score) {
      best_score = score
      best = cands[c].step
    }
  }
  return best
}
function run_beats(notes2, opts) {
  const beats = opts.beats
  let ts_num = opts.ts_num || 4
  let ts_den = opts.ts_den || 4
  let measure_div = Math.round((st.DIV * ts_num * 4) / ts_den)
  let groups = chordify(notes2)
  let resid = []
  let base_step
  let mixed = false
  if (opts.grid === 'auto') {
    base_step = groups.length ? pick_grid_beats(groups, beats) : 6
    mixed = base_step === 6 || base_step === 12
  } else {
    base_step = parseInt(opts.grid, 10) || 6
    mixed = base_step === 6 || base_step === 12
  }
  let trip_step = base_step === 12 ? 8 : 4
  const q_notes = []
  for (let i2 = 0; i2 < groups.length; i2++) {
    let g = groups[i2]
    let loc = locate_in_beats(g.t, beats)
    let sb = snap_u(loc.u, base_step, loc.ibi)
    let ticks_in = sb.ticks,
      step_used = base_step,
      used_err = sb.err
    if (mixed) {
      let st3 = snap_u(loc.u, trip_step, loc.ibi)
      if (st3.err < sb.err * 0.55) {
        ticks_in = st3.ticks
        step_used = trip_step
        used_err = st3.err
      }
    }
    resid.push(used_err)
    let tick = loc.beat * st.DIV + ticks_in
    for (let k = 0; k < g.notes.length; k++) {
      let n = g.notes[k]
      let e = locate_in_beats(n.start + n.dur, beats)
      let se = snap_u(e.u, step_used, e.ibi)
      let tick_end = e.beat * st.DIV + se.ticks
      let dur_ticks = Math.max(step_used, tick_end - tick)
      dur_ticks = Math.min(dur_ticks, measure_div * 2)
      q_notes.push({
        tick,
        dur: dur_ticks,
        pitch: n.pitch,
        velocity: n.velocity || Math.round((n.amp || 0.5) * 127),
        amp: n.amp,
        step: step_used,
      })
    }
  }
  q_notes.sort(function (a, b) {
    return a.tick - b.tick || a.pitch - b.pitch
  })
  let dedup = []
  for (i = 0; i < q_notes.length; i++) {
    let prev = dedup[dedup.length - 1]
    if (
      prev &&
      prev.tick === q_notes[i].tick &&
      prev.pitch === q_notes[i].pitch
    ) {
      prev.dur = Math.max(prev.dur, q_notes[i].dur)
      prev.velocity = Math.max(prev.velocity, q_notes[i].velocity)
    } else {
      dedup.push(q_notes[i])
    }
  }
  let ibis = []
  for (i = 1; i < beats.length; i++) ibis.push(beats[i] - beats[i - 1])
  ibis.sort(function (a, b) {
    return a - b
  })
  let med_ibi = ibis.length ? ibis[ibis.length >> 1] : 0.5
  let bpm = Math.max(30, Math.min(300, Math.round(60 / med_ibi)))
  return assemble(dedup, {
    bpm,
    phase: beats[0] || 0,
    quarter_sec: med_ibi,
    base_step,
    mixed,
    measure_div,
    ts_num,
    ts_den,
    split: opts.split,
    density: opts.density,
    beats,
    debug_resid: resid,
  })
}
function run(notes2, opts) {
  if (opts.beats && opts.beats.length >= 2) return run_beats(notes2, opts)
  let bpm = opts.bpm
  let phase = opts.phase
  let quarter = 60 / bpm
  let ts_num = opts.ts_num || 4
  let ts_den = opts.ts_den || 4
  let measure_div = Math.round((st.DIV * ts_num * 4) / ts_den)
  let base_step
  let mixed = false
  if (opts.grid === 'auto') {
    base_step = notes2.length ? pick_grid(notes2, bpm, phase) : 6
    mixed = base_step === 6 || base_step === 12
  } else {
    base_step = parseInt(opts.grid, 10) || 6
  }
  let trip_step = base_step === 12 ? 8 : 4
  function snap(t, step) {
    let step_sec = (quarter * step) / st.DIV
    let tick = Math.round((t - phase) / step_sec) * step
    return {
      tick: Math.max(0, tick),
      err: Math.abs(t - phase - Math.round((t - phase) / step_sec) * step_sec),
    }
  }
  const q_notes = []
  for (let i2 = 0; i2 < notes2.length; i2++) {
    let n = notes2[i2]
    let s_base = snap(n.start, base_step)
    let tick = s_base.tick
    let step_used = base_step
    if (mixed) {
      let s_trip = snap(n.start, trip_step)
      if (s_trip.err < s_base.err * 0.55) {
        tick = s_trip.tick
        step_used = trip_step
      }
    }
    let dur_ticks = Math.max(
      step_used,
      Math.round(n.dur / (quarter / st.DIV) / step_used) * step_used,
    )
    dur_ticks = Math.min(dur_ticks, measure_div * 2)
    q_notes.push({
      tick,
      dur: dur_ticks,
      pitch: n.pitch,
      velocity: n.velocity || 80,
      staff: n.staff || 1,
      src_start: n.start,
      src_dur: n.dur,
      amp: n.amp,
    })
  }
  return assemble(q_notes, {
    bpm,
    phase,
    quarter_sec: quarter,
    base_step,
    mixed,
    measure_div,
    ts_num,
    ts_den,
    split: opts.split,
    density: opts.density,
  })
}
export {
  PIECES,
  STEP_LABELS,
  assemble,
  chordify,
  decompose,
  is_decomposable,
  pick_grid,
  pick_grid_beats,
  run,
  run_beats,
  span_ok,
}
