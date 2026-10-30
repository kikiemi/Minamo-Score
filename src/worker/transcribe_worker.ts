import * as EN from './engines'
import type { OrtLike } from './ort_types'
import { BUILD_ID } from '../build_id'

const ORT_VER = '1.27.0'
const ORT_BASE =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VER + '/dist/'

interface TranscribeMsg {
  type: 'transcribe'
  id: number
  build: string
  samples: Float32Array
  engine: 'hires' | 'bp'
  rate: number
  quality: string
  precision: { onset: number; frame: number; min_frames: number }
  recall: { onset: number; frame: number; min_frames: number }
}

let ort_promise: Promise<OrtLike> | null = null
const sessions = new Map<string, Promise<unknown>>()
let backend_desc = ''

function load_ort(): Promise<OrtLike> {
  if (ort_promise) return ort_promise
  ort_promise = import(ORT_BASE + 'ort.min.mjs').then(
    (m: { default?: OrtLike } & OrtLike) => {
      const ort = (m.default || m) as OrtLike
      ort.env.wasm.wasmPaths = ORT_BASE
      const cores = (self.navigator && navigator.hardwareConcurrency) || 1
      if (self.crossOriginIsolated) {
        ort.env.wasm.numThreads = Math.max(1, Math.min(4, cores - 1))
        backend_desc = 'wasm×' + String(ort.env.wasm.numThreads)
      } else {
        ort.env.wasm.numThreads = 1
        backend_desc = 'wasm'
      }
      return ort
    },
  )
  return ort_promise
}

function post_progress(id: number, ratio: number, text: string): void {
  self.postMessage({ id, type: 'progress', ratio, text })
}

function get_session(
  url: string,
  id: number,
  label: string,
  p0: number,
  p1: number,
): Promise<unknown> {
  const hit = sessions.get(url)
  if (hit) return hit
  const p = (async () => {
    const ort = await load_ort()
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        label +
          'を取得できません（HTTP ' +
          String(res.status) +
          '）。models/ の配置とサイズ制限を確認してください',
      )
    }
    const total = Number(res.headers.get('Content-Length')) || 0
    let bytes: Uint8Array
    if (res.body && total > 1e6) {
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        got += value.length
        post_progress(
          id,
          p0 + (p1 - p0) * Math.min(1, got / total),
          label + 'をダウンロード中…',
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
    post_progress(id, p1, label + 'を初期化中…')
    return ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
  })()
  sessions.set(url, p)
  p.catch(() => sessions.delete(url))
  return p
}

async function with_busy_lock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as unknown as { locks?: LockManager }).locks
  if (!locks || !locks.request) return fn()
  return locks.request('minamoscore-worker-busy', fn) as Promise<T>
}

self.onmessage = (e: MessageEvent<TranscribeMsg>) => {
  const msg = e.data
  if (!msg || msg.type !== 'transcribe') return
  const id = msg.id
  void with_busy_lock(async () => {
    try {
      if (msg.build !== BUILD_ID) {
        throw new Error(
          '配置ファイルが混在しています（app と worker のビルドが不一致）。全ファイルを上書きしてスーパーリロードしてください',
        )
      }
      if (
        (msg.engine === 'hires' && msg.rate !== 16000) ||
        (msg.engine === 'bp' && msg.rate !== 22050)
      ) {
        throw new Error(
          '内部エラー: エンジンとサンプルレートが不一致（' +
            msg.engine +
            '/' +
            String(msg.rate) +
            '）',
        )
      }
      post_progress(id, 0.01, '採譜エンジンを準備中…')
      const ort = await load_ort()
      const samples = msg.samples
      EN.normalize_peak(samples)
      let result
      if (msg.engine === 'hires') {
        const session = await get_session(
          new URL('../models/kong_note_fp16.onnx', self.location.href).href,
          id,
          '高精度ピアノAI（初回のみ）',
          0.03,
          0.18,
        )
        result = await EN.run_hires(
          ort,
          session as never,
          samples,
          (r, text) => {
            post_progress(id, 0.2 + 0.74 * r, text)
          },
        )
      } else {
        const session = await get_session(
          new URL('../models/basic_pitch.onnx', self.location.href).href,
          id,
          '採譜モデル',
          0.03,
          0.08,
        )
        result = await EN.run_bp(
          ort,
          session as never,
          samples,
          msg.quality,
          msg.precision,
          msg.recall,
          (r, text) => {
            post_progress(id, 0.1 + 0.84 * r, text)
          },
        )
      }
      post_progress(id, 0.96, '仕上げ中…')
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
