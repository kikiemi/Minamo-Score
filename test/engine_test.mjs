/* engine_test.mjs - JS実装の実機テスト（onnxruntime-node）
   1) hires後処理: pythonが吐いたモデル出力(golden) → JS detect_notes が
      python原典ポストプロセッサと同一の音符を出すか
   2) hiresフルチェーン: 16k音声 → JS enframe → ORT → deframe → detect
      （セグメント境界処理込み。goldenは全長一括推論なので音符レベルで比較）
   3) bp: 22050音声 → JS make_windows → ORT → stitch → 本家tfjs出力と数値一致
      → extract_notes で基音3つが出るか
*/
import { readFileSync } from 'fs'
import * as ort from 'onnxruntime-node'
import * as HR from '../dist/mod/worker/hires.js'
import * as BP from '../dist/mod/worker/bp_infer.js'
import { extract_notes, N_BINS } from '../dist/mod/worker/extract.js'
import * as EN from '../dist/mod/worker/engines.js'
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
const f32 = (p) => new Float32Array(readFileSync(p).buffer.slice(0))

const meta = JSON.parse(readFileSync('fixtures/gold_meta.json', 'utf8'))
const gold_notes = JSON.parse(
  readFileSync('fixtures/golden_notes.json', 'utf8'),
)

/* ---- 1) 後処理の一致 ---- */
console.log('1) hires後処理 vs python原典')
{
  const notes = HR.detect_notes(
    f32('fixtures/gold_reg_onset_output.f32'),
    f32('fixtures/gold_reg_offset_output.f32'),
    f32('fixtures/gold_frame_output.f32'),
    f32('fixtures/gold_velocity_output.f32'),
    meta.T,
  )
  assert(
    notes.length === gold_notes.length,
    `音符数一致 ${notes.length} vs ${gold_notes.length}`,
  )
  const sorted_g = gold_notes
    .slice()
    .sort((a, b) => a.onset_time - b.onset_time || a.midi_note - b.midi_note)
  let ok = 0
  for (let i = 0; i < Math.min(notes.length, sorted_g.length); i++) {
    const n = notes[i],
      g = sorted_g[i]
    if (
      n.pitch === g.midi_note &&
      Math.abs(n.start - g.onset_time) < 1e-4 &&
      Math.abs(n.start + n.dur - g.offset_time) < 1e-4 &&
      n.velocity === Math.min(127, Math.max(1, Math.trunc(g.velocity)))
    )
      ok++
    else
      console.error(
        `   mismatch #${i}: JS p${n.pitch}@${n.start.toFixed(4)} v${n.velocity} / PY p${g.midi_note}@${g.onset_time.toFixed(4)} v${g.velocity}`,
      )
  }
  assert(
    ok === sorted_g.length,
    `全音符フィールド一致 ${ok}/${sorted_g.length}`,
  )
}

/* ---- 1b) hires 2パス: 感度パスは精度パスの上位集合 ---- */
console.log('1b) hires感度パス（閾値0.15）')
{
  const P = HR.detect_notes(
    f32('fixtures/gold_reg_onset_output.f32'),
    f32('fixtures/gold_reg_offset_output.f32'),
    f32('fixtures/gold_frame_output.f32'),
    f32('fixtures/gold_velocity_output.f32'),
    meta.T,
  )
  const R = HR.detect_notes(
    f32('fixtures/gold_reg_onset_output.f32'),
    f32('fixtures/gold_reg_offset_output.f32'),
    f32('fixtures/gold_frame_output.f32'),
    f32('fixtures/gold_velocity_output.f32'),
    meta.T,
    { onset_threshold: 0.15, offset_threshold: 0.3, frame_threshold: 0.06 },
  )
  assert(
    R.length >= P.length,
    `感度パスは精度パス以上の音符数 ${R.length} >= ${P.length}`,
  )
  let covered = 0
  for (const p of P) {
    if (
      R.some((r) => r.pitch === p.pitch && Math.abs(r.start - p.start) < 0.006)
    )
      covered++
  }
  assert(
    covered === P.length,
    `精度パスの全音符を感度パスが含む ${covered}/${P.length}`,
  )
  console.log('   precision:', P.length, 'recall:', R.length)
}

/* ---- 2) hiresフルチェーン（本番経路 engines.run_hires） ---- */
console.log('2) hiresフルチェーン（engines.run_hires・ブレンド縫い）')
{
  const audio = f32('fixtures/audio16k.f32')
  const session = await ort.InferenceSession.create(
    '../models/kong_note_fp16.onnx',
  )
  const res = await EN.run_hires(ort, session, audio, null)
  const notes = res.precision
  console.log('   precision:', notes.length, 'recall:', res.recall.length)
  assert(res.recall.length >= notes.length, '感度パス⊇精度パス')
  let core_ok = 0,
    core_total = 0
  for (const g of gold_notes) {
    if (![60, 64, 67].includes(g.midi_note)) continue
    core_total++
    for (const n of notes) {
      if (
        n.pitch === g.midi_note &&
        Math.abs(n.start - g.onset_time) < 0.01 &&
        Math.abs(n.velocity - g.velocity) <= 7
      ) {
        core_ok++
        break
      }
    }
  }
  assert(core_total === 6 && core_ok === 6, `コア音符 ${core_ok}/${core_total}`)

  /* 2b) 12秒（2セグメント）: クロスフェード縫いの実走。
     前半6秒＝元音声、後半6秒＝同じ音を+6秒シフト。
     クロスフェード帯（8〜10秒）をまたぐ後半のコア音符も同精度で出るか */
  const audio12 = new Float32Array(audio.length * 2)
  audio12.set(audio, 0)
  audio12.set(audio, audio.length)
  const plan = (await import('../dist/mod/worker/hires.js')).plan_segments(
    audio12.length,
  )
  assert(plan.n_seg === 2, '12秒→2セグメント (got ' + plan.n_seg + ')')
  const res12 = await EN.run_hires(ort, session, audio12, null)
  let ok1 = 0,
    ok2 = 0
  for (const g of gold_notes) {
    if (![60, 64, 67].includes(g.midi_note)) continue
    for (const n of res12.precision) {
      if (n.pitch === g.midi_note && Math.abs(n.start - g.onset_time) < 0.012) {
        ok1++
        break
      }
    }
    for (const n of res12.precision) {
      if (
        n.pitch === g.midi_note &&
        Math.abs(n.start - (g.onset_time + 6.0)) < 0.012
      ) {
        ok2++
        break
      }
    }
  }
  assert(ok1 === 6, `前半コア音符 ${ok1}/6`)
  assert(ok2 === 6, `後半コア音符（クロスフェード帯またぎ含む） ${ok2}/6`)
}

/* ---- 3) bp ウィンドウ処理の数値一致 + 抽出 ---- */
console.log('3) bp: JSウィンドウ処理 vs 本家tfjs')
{
  const audio = f32('fixtures/audio22050.f32')
  const session = await ort.InferenceSession.create(
    '../models/basic_pitch.onnx',
  )
  const wins = BP.make_windows(audio)
  const pf = [],
    po = []
  for (const w of wins) {
    const res = await session.run({
      'serving_default_input_2:0': new ort.Tensor('float32', w, [
        1,
        BP.AUDIO_N_SAMPLES,
        1,
      ]),
    })
    pf.push(new Float32Array(res['StatefulPartitionedCall:1'].data))
    po.push(new Float32Array(res['StatefulPartitionedCall:2'].data))
  }
  const T = BP.n_output_frames(audio.length)
  const frames_t = BP.stitch_to_columns(pf, N_BINS, T)
  const onsets_t = BP.stitch_to_columns(po, N_BINS, T)

  const ref_f = JSON.parse(readFileSync('fixtures/ref_frames.json', 'utf8'))
  const ref_o = JSON.parse(readFileSync('fixtures/ref_onsets.json', 'utf8'))
  assert(T === ref_f.length, `フレーム数一致 ${T} vs ${ref_f.length}`)
  let mdf = 0,
    mdo = 0
  for (let t = 0; t < T; t++)
    for (let c = 0; c < N_BINS; c++) {
      mdf = Math.max(mdf, Math.abs(frames_t[c][t] - ref_f[t][c]))
      mdo = Math.max(mdo, Math.abs(onsets_t[c][t] - ref_o[t][c]))
    }
  console.log(
    '   maxdiff frames:',
    mdf.toExponential(2),
    'onsets:',
    mdo.toExponential(2),
  )
  assert(mdf < 1e-5 && mdo < 1e-5, '本家tfjsと数値一致(<1e-5)')

  const ex = extract_notes(frames_t, onsets_t, T, {
    precision: { onset: 0.5, frame: 0.3, min_frames: 11 },
    recall: { onset: 0.24, frame: 0.15, min_frames: 5 },
  })
  const pitches = new Set(ex.recall.map((n) => n.pitchMidi))
  assert(
    pitches.has(60) && pitches.has(64) && pitches.has(67),
    '基音C4/E4/G4を検出 (' + [...pitches].sort((a, b) => a - b).join(',') + ')',
  )

  /* 本番経路（engines.run_bp・バッチ推論）でも同じ基音が出るか */
  const res_en = await EN.run_bp(
    ort,
    session,
    audio,
    'fast',
    { onset: 0.5, frame: 0.3, min_frames: 11 },
    { onset: 0.24, frame: 0.15, min_frames: 5 },
    null,
  )
  const p2 = new Set(res_en.recall.map((n) => n.pitch))
  assert(
    p2.has(60) && p2.has(64) && p2.has(67),
    'engines.run_bp（バッチ）でも基音検出',
  )
}

console.log(failures ? `\n${failures} 件の失敗` : '\n全テスト成功')
process.exit(failures ? 1 : 0)
