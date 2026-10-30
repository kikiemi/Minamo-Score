/* deframe_test.mjs - 複数セグメントの継ぎ合わせが python と同一か */
import * as HR from '../dist/mod/worker/hires.js'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
process.chdir(dirname(fileURLToPath(import.meta.url)))
let failures = 0
const assert = (c, m) => {
  if (!c) {
    failures++
    console.error('  ✗ ' + m)
  }
}

/* 30秒音声を想定: enframe → 5 セグメント(0,80k,160k,240k,320k? p+160k<=480k → p∈{0..320k} 5本) */
const audio = new Float32Array(HR.SEG_SAMPLES * 3) /* 480000 = 30s */
const segs = HR.enframe(audio)
assert(segs.length === 5, '30秒→5セグメント (got ' + segs.length + ')')

/* 各セグメントの出力: F=1001, C=2。値 = グローバルフレーム番号（seg i はフレーム i*500 起点） */
const C = 2
const seg_outputs = []
for (let i = 0; i < 5; i++) {
  const F = 1001
  const data = new Float32Array(F * C)
  for (let f = 0; f < F; f++)
    for (let c = 0; c < C; c++) data[f * C + c] = i * 500 + f
  seg_outputs.push({ data, F })
}
const { data, T } = HR.deframe(seg_outputs, C)
assert(T === 3000, '30秒→3000フレーム (got ' + T + ')')
/* 継ぎ合わせ後は 0..2999 の連番になるはず */
let ok = true,
  first_bad = -1
for (let t = 0; t < T; t++) {
  if (data[t * C] !== t || data[t * C + 1] !== t) {
    ok = false
    first_bad = t
    break
  }
}
assert(ok, '全フレームが連続 (first_bad=' + first_bad + ')')

/* 単一セグメント: そのまま */
const one = HR.deframe([seg_outputs[0]], C)
assert(
  one.T === 1001 && one.data[0] === 0 && one.data[1000 * C] === 1000,
  'N=1はそのまま',
)

console.log(failures ? failures + ' 件の失敗' : '全テスト成功')
process.exit(failures ? 1 : 0)

/* ===== ブレンド縫い（80%ストライド）の検証 ===== */
{
  console.log('blend:')
  /* 30秒 → n_seg = ceil((480000-160000)/128000)+1 = ceil(2.5)+1 = 4 */
  const plan = HR.plan_segments(480000)
  assert(plan.n_seg === 4, '30秒→4セグメント (got ' + plan.n_seg + ')')
  assert(plan.total_frames === 3 * 800 + 1001, 'total_frames=3401')

  /* 各セグメントがグローバルフレーム番号を符号化 → ブレンド後も厳密に連番 */
  const C = 2
  const acc = HR.blend_init(plan, C)
  for (let i = 0; i < plan.n_seg; i++) {
    const data = new Float32Array(HR.SEG_FRAMES * C)
    for (let f = 0; f < HR.SEG_FRAMES; f++)
      for (let c = 0; c < C; c++) data[f * C + c] = i * HR.HOP_FRAMES + f
    HR.blend_add(acc, i, data)
  }
  const fin = HR.blend_finish(acc, 480000)
  assert(
    fin.T === Math.floor(480000 / 160) + 1,
    '有効フレーム数 3001 (got ' + fin.T + ')',
  )
  let bad = -1
  for (let t = 0; t < fin.T; t++) {
    if (
      Math.abs(fin.data[t * C] - t) > 1e-4 ||
      Math.abs(fin.data[t * C + 1] - t) > 1e-4
    ) {
      bad = t
      break
    }
  }
  assert(bad === -1, 'ブレンド後も全フレーム連番 (first_bad=' + bad + ')')

  /* 定数1入力 → 出力は厳密に1（重み和 = 1 の検証） */
  const acc2 = HR.blend_init(plan, 1)
  const ones = new Float32Array(HR.SEG_FRAMES).fill(1)
  for (let i = 0; i < plan.n_seg; i++) HR.blend_add(acc2, i, ones)
  const fin2 = HR.blend_finish(acc2, 480000)
  let bad2 = -1
  for (let t = 0; t < fin2.T; t++)
    if (Math.abs(fin2.data[t] - 1) > 1e-6) {
      bad2 = t
      break
    }
  assert(bad2 === -1, 'partition of unity (first_bad=' + bad2 + ')')

  /* 単一セグメント時は従来と同一 */
  const p1 = HR.plan_segments(96000)
  assert(p1.n_seg === 1 && p1.total_frames === 1001, '6秒は1セグメント')

  /* 無音スキップ（seg=null）: 重みだけ加算され、周辺と正しくブレンド */
  const acc3 = HR.blend_init(plan, 1)
  for (let i = 0; i < plan.n_seg; i++)
    HR.blend_add(acc3, i, i === 1 ? null : ones)
  const fin3 = HR.blend_finish(acc3, 480000)
  /* seg1 の専有域（frames 1001..1600 = seg1のみが寄与）は 0、seg0/2 専有域は 1 */
  assert(Math.abs(fin3.data[500]) < 1e-6 || fin3.data[500] === 1, 'sanity')
  assert(
    Math.abs(fin3.data[1200] - 0) < 1e-6,
    '無音セグ専有域=0 (got ' + fin3.data[1200] + ')',
  )
  assert(Math.abs(fin3.data[400] - 1) < 1e-6, '有音セグ専有域=1')
}

/* ===== frame救済の検証 ===== */
{
  console.log('frame_only_rescue:')
  const T = 400,
    C = HR.CLASSES
  const frame = new Float32Array(T * C)
  const vel = new Float32Array(T * C)
  /* ピッチbin 40: 100..160 で frame=0.8, オンセット無し想定 → 救済対象 */
  for (let t = 100; t < 160; t++) {
    frame[t * C + 40] = 0.8
    vel[t * C + 40] = 0.5
  }
  /* ピッチbin 50: 200..260 で frame=0.8 だが既存音符あり → 救済しない */
  for (let t = 200; t < 260; t++) {
    frame[t * C + 50] = 0.8
    vel[t * C + 50] = 0.5
  }
  const existing = [
    { start: 2.0, dur: 0.6, pitch: 50 + 21, velocity: 60, amp: 0.5 },
  ]
  const res = HR.frame_only_rescue(frame, vel, T, existing)
  assert(res.length === 1, '救済は1音のみ (got ' + res.length + ')')
  if (res.length === 1) {
    assert(
      res[0].pitch === 40 + 21 && Math.abs(res[0].start - 1.0) < 0.011,
      '救済音の位置',
    )
    assert(
      res[0].velocity === 64,
      '救済音のvel=int(0.5*128) (got ' + res[0].velocity + ')',
    )
  }
  /* 短い活性（10フレーム）は救済しない */
  const frame2 = new Float32Array(T * C)
  for (let t = 300; t < 310; t++) frame2[t * C + 30] = 0.9
  assert(
    HR.frame_only_rescue(frame2, vel, T, []).length === 0,
    '短い活性は無視',
  )
}

/* ===== CFP物証の検証 ===== */
{
  console.log('cfp:')
  const CFP = await import('../dist/mod/worker/cfp.js')
  const sr = 16000,
    n = sr * 2
  const x = new Float32Array(n)
  const f0 = 261.63 /* C4 */
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let h = 1; h <= 6; h++)
      v += Math.sin((2 * Math.PI * f0 * h * i) / sr) / h
    x[i] = v * 0.15
  }
  const sal = CFP.cfp_salience(x)
  const scale = CFP.cfp_scale(sal)
  const ev = (p) => CFP.cfp_evidence(sal, scale, 0.5, 1.0, p)
  const c4 = ev(60),
    c5 = ev(72),
    c3 = ev(48),
    tritone = ev(66)
  assert(c4 > 0.5, '基音C4の物証が強い (got ' + c4.toFixed(3) + ')')
  assert(c4 > 20 * Math.max(c5, 1e-9), '倍音ゴーストC5を強く抑圧')
  assert(c4 > 10 * Math.max(c3, 1e-9), 'サブハーモニクスC3を抑圧')
  assert(
    tritone < 0.05,
    '無関係音程はほぼゼロ (got ' + tritone.toFixed(3) + ')',
  )
  /* 無音での安全性 */
  const sal0 = CFP.cfp_salience(new Float32Array(sr))
  assert(
    CFP.cfp_evidence(sal0, CFP.cfp_scale(sal0), 0.2, 0.5, 60) === 0,
    '無音は物証ゼロ',
  )
}
