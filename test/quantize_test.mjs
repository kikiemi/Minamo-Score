import * as notes from '../dist/mod/04_notes.js'
import * as tempo from '../dist/mod/05_tempo.js'
import * as quantize from '../dist/mod/06_quantize.js'

let pass = 0,
  fail = 0
function assert(cond, msg) {
  if (cond) {
    pass++
  } else {
    fail++
    console.error('✗ ' + msg)
  }
}

{
  const ns = []
  for (let k = 0; k < 40; k++)
    ns.push({ start: 0.2 + k * 0.5, dur: 0.2, pitch: 60, amp: 0.8 })
  const beats = tempo.track_beats(ns, 21, 120)
  const ibis = beats.slice(1).map((b, i) => b - beats[i])
  const bad = ibis.filter((x) => Math.abs(x - 0.5) > 0.02).length
  assert(
    bad / ibis.length < 0.15,
    `等速120bpm IBI (外れ ${bad}/${ibis.length})`,
  )
}

{
  const ns = []
  let t = 0.3,
    ibi = 0.6
  for (let k = 0; k < 40; k++) {
    ns.push({ start: t, dur: 0.2, pitch: 48 + (k % 3), amp: 0.9 })
    t += ibi
    ibi = Math.max(0.38, ibi - 0.006)
  }
  const beats = tempo.track_beats(ns, t + 1, Math.round(60 / 0.5))
  let off = 0
  for (const n of ns) {
    let best = 1e9
    for (const b of beats) best = Math.min(best, Math.abs(b - n.start))
    if (best > 0.03) off++
  }
  assert(off <= 3, `アッチェレランド追従 (外れ ${off}/40)`)
}

{
  const beats = []
  let t = 0,
    ibi = 0.5
  for (let k = 0; k < 30; k++) {
    beats.push(t)
    t += ibi
    ibi *= 0.99
  }
  const ns = []
  const fr = [0, 0.25, 0.5, 0.75]
  for (let k = 0; k < 24; k++) {
    const b = beats[k],
      w = beats[k + 1] - beats[k]
    ns.push({
      start: b + fr[k % 4] * w + Math.sin(k) * 0.008,
      dur: w * 0.24,
      pitch: 60 + (k % 5),
      amp: 0.7,
      velocity: 80,
    })
  }
  const q = quantize.run(ns, {
    beats,
    bpm: 120,
    phase: 0,
    grid: 'auto',
    ts_num: 4,
    ts_den: 4,
    split: 55,
    density: 'preserve',
  })
  assert(q.base_step === 6, `自動グリッド=16分 (got ${q.base_step})`)
  const r = q.debug_resid.slice().sort((a, b) => a - b)
  assert(
    r[r.length >> 1] < 0.012,
    `残差中央値<12ms (got ${(r[r.length >> 1] * 1000).toFixed(1)}ms)`,
  )
  let flat = 0
  for (const key of Object.keys(q.staves))
    for (const ev of q.staves[key]) flat += ev.pitches.length
  assert(flat === ns.length, `音符全生存 ${flat}/${ns.length}`)
}

{
  const beats = [0, 0.5, 1.0, 1.5, 2.0, 2.5]
  const ns = [
    { start: 1.0, dur: 0.4, pitch: 60, amp: 0.8, velocity: 90 },
    { start: 1.012, dur: 0.4, pitch: 64, amp: 0.7, velocity: 85 },
    { start: 0.991, dur: 0.4, pitch: 67, amp: 0.7, velocity: 82 },
  ]
  const q = quantize.run(ns, {
    beats,
    bpm: 120,
    phase: 0,
    grid: '6',
    ts_num: 4,
    ts_den: 4,
    split: 55,
    density: 'preserve',
  })
  const ticks = new Set()
  for (const key of Object.keys(q.staves))
    for (const ev of q.staves[key]) ticks.add(ev.tick)
  assert(
    ticks.size === 1 && ticks.has(48),
    `和音3音が同tick=48 (got ${[...ticks]})`,
  )
}

{
  const ns = [{ start: 0.5, dur: 0.4, pitch: 60, amp: 0.8, velocity: 90 }]
  const q = quantize.run(ns, {
    bpm: 120,
    phase: 0,
    grid: '6',
    ts_num: 4,
    ts_den: 4,
    split: 55,
    density: 'preserve',
  })
  assert(q.bpm === 120 && !q.beats, '固定グリッド経路が温存')
}

{
  const preset = {
    precision: { onset: 0.5, frame: 0.3, min_frames: 11 },
    recall: { onset: 0.24, frame: 0.15, min_frames: 5 },
    merge_ms: 4,
    min_dur: 0.02,
    min_amp: 0.01,
    recall_floor: 0.1,
    dup_ms: 15,
  }
  const P = [{ start: 1.0, dur: 0.5, pitch: 60, amp: 0.6 }]
  const R = [
    { start: 1.0, dur: 0.5, pitch: 60, amp: 0.6 },
    { start: 2.0, dur: 0.3, pitch: 64, amp: 0.3 },
  ]
  const u = notes.union_passes(P, R, preset)
  assert(
    u.length === 2 && u.added_by_recall === 1,
    `union 追加=${u.added_by_recall}`,
  )
}

console.log(fail === 0 ? '\n全テスト成功' : `\n失敗 ${fail}件（成功 ${pass}）`)
process.exit(fail ? 1 : 0)
