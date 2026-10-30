import * as util from './00_util.js'
function union_passes(precision, recall, preset) {
  const result = precision.slice()
  if (!recall.length) return result
  let p_amps = precision.map(function (n) {
    return n.amp
  })
  let amp_median = p_amps.length ? util.median(p_amps) : 0.2
  let floor = Math.max(preset.min_amp, amp_median * preset.recall_floor)
  let by_pitch = new Map()
  for (let i = 0; i < precision.length; i++) {
    let p = precision[i]
    if (!by_pitch.has(p.pitch)) by_pitch.set(p.pitch, [])
    by_pitch.get(p.pitch).push(p)
  }
  let dup_sec = (preset.dup_ms != null ? preset.dup_ms : 50) / 1e3
  let added = 0
  for (let j = 0; j < recall.length; j++) {
    let r = recall[j]
    if (r.amp < floor) continue
    let peers = by_pitch.get(r.pitch)
    let dup = false
    if (peers) {
      for (let k = 0; k < peers.length; k++) {
        let q = peers[k]
        let ov =
          Math.min(q.start + q.dur, r.start + r.dur) -
          Math.max(q.start, r.start)
        if (
          ov > 0.5 * Math.min(q.dur, r.dur) ||
          Math.abs(q.start - r.start) < dup_sec
        ) {
          dup = true
          break
        }
      }
    }
    if (!dup) {
      result.push(r)
      if (!peers) {
        peers = []
        by_pitch.set(r.pitch, peers)
      }
      peers.push(r)
      added++
    }
  }
  result.added_by_recall = added
  return result
}
function clean(notes, preset) {
  let out = notes.filter(function (n) {
    return n.dur >= preset.min_dur * 0.7 && n.amp >= preset.min_amp * 0.7
  })
  out.sort(function (a, b) {
    return a.pitch - b.pitch || a.start - b.start
  })
  let merge_sec = preset.merge_ms / 1e3
  const merged = []
  for (let i = 0; i < out.length; i++) {
    let n = out[i]
    let last = merged[merged.length - 1]
    if (last && last.pitch === n.pitch) {
      let gap = n.start - (last.start + last.dur)
      if (gap < merge_sec && gap > -0.5) {
        let end = Math.max(last.start + last.dur, n.start + n.dur)
        last.dur = end - last.start
        if (n.amp > last.amp) {
          last.amp = n.amp
          if (n.velocity != null) last.velocity = n.velocity
        }
        continue
      }
      if (n.start < last.start + last.dur) {
        last.dur = Math.max(0.02, n.start - last.start)
      }
    }
    const kept = {
      start: n.start,
      dur: n.dur,
      pitch: n.pitch,
      amp: n.amp,
    }
    if (n.velocity != null) kept.velocity = n.velocity
    merged.push(kept)
  }
  let final_notes = merged
  if (preset.ghost_filter) {
    final_notes = merged.filter(function (n) {
      for (let j = 0; j < merged.length; j++) {
        let m = merged[j]
        if (m === n) continue
        if (
          Math.abs(m.start - n.start) < 0.03 &&
          Math.abs(m.pitch - n.pitch) === 12 &&
          n.amp < m.amp * 0.28
        ) {
          return false
        }
      }
      return true
    })
  }
  final_notes.sort(function (a, b) {
    return a.start - b.start || a.pitch - b.pitch
  })
  return final_notes
}
function assign_velocity(notes) {
  if (!notes.length) return notes
  let missing = notes.filter(function (n) {
    return n.velocity == null
  })
  if (!missing.length) return notes
  let amps = missing.map(function (n) {
    return n.amp
  })
  let ref = Math.max(0.05, util.percentile(amps, 0.95))
  for (let i = 0; i < missing.length; i++) {
    let rel = util.clamp(missing[i].amp / ref, 0, 1)
    missing[i].velocity = util.clamp(
      Math.round(22 + Math.pow(rel, 0.6) * 100),
      1,
      127,
    )
  }
  return notes
}
function split_hands(notes, split_mode, manual_split) {
  let split
  if (split_mode === 'manual') {
    split = util.clamp(manual_split | 0, 36, 84)
  } else {
    if (!notes.length) {
      split = 60
    } else {
      let pitches = notes
        .map(function (n) {
          return n.pitch
        })
        .sort(function (a, b) {
          return a - b
        })
      let med = util.median(pitches)
      let lo = util.clamp(Math.round(med) - 12, 43, 76)
      let hi = util.clamp(Math.round(med) + 12, 44, 77)
      let hist = new Array(128).fill(0)
      for (let i = 0; i < pitches.length; i++) hist[pitches[i]]++
      let best = 60,
        best_score = -Infinity
      for (let c = lo; c <= hi; c++) {
        let density = hist[c] + hist[c - 1] + hist[c + 1]
        let score = -density - Math.abs(c - 60) * 0.15
        if (score > best_score) {
          best_score = score
          best = c
        }
      }
      split = best
    }
  }
  for (let j = 0; j < notes.length; j++) {
    notes[j].staff = notes[j].pitch >= split ? 1 : 2
  }
  return split
}
function build(precision, recall, preset, split_mode, manual_split) {
  let unioned = union_passes(precision, recall, preset)
  let cleaned = clean(unioned, preset)
  assign_velocity(cleaned)
  let split = split_hands(cleaned, split_mode, manual_split)
  return {
    notes: cleaned,
    split,
    added_by_recall: unioned.added_by_recall || 0,
  }
}
export { assign_velocity, build, clean, split_hands, union_passes }
