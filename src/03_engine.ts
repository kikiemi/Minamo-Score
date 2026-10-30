import type { Passes, PassThresholds, EnginePlan } from './types.js'
import { BUILD_ID } from './build_id'

interface Job {
  resolve: (p: Passes) => void
  reject: (e: Error) => void
  on_progress: ((ratio: number, text: string) => void) | null
}

interface WorkerMsg {
  id: number
  type: 'progress' | 'done' | 'error'
  ratio?: number
  text?: string
  message?: string
  precision?: Passes['precision']
  recall?: Passes['recall']
  backend?: string
  engine?: string
  quality?: string
  ghosts_removed?: number
}

let worker: Worker | null = null
let next_id = 1
const jobs = new Map<number, Job>()

function ensure(): Worker {
  if (worker) return worker
  const w = new Worker('dist/worker.js', { type: 'module' })
  w.onmessage = (e: MessageEvent<WorkerMsg>) => {
    const msg = e.data
    if (!msg) return
    const job = jobs.get(msg.id)
    if (!job) return
    if (msg.type === 'progress') {
      if (job.on_progress) job.on_progress(msg.ratio || 0, msg.text || '')
      return
    }
    jobs.delete(msg.id)
    if (msg.type === 'done') {
      job.resolve({
        precision: msg.precision || [],
        recall: msg.recall || [],
        ghosts_removed: msg.ghosts_removed || 0,
        backend: msg.backend,
        engine: msg.engine,
        quality: msg.quality,
      })
    } else {
      job.reject(new Error(msg.message || '解析に失敗しました'))
    }
  }
  w.onerror = () => {
    for (const [, job] of jobs) job.reject(new Error('ワーカーが停止しました'))
    jobs.clear()
    worker = null
  }
  worker = w
  return w
}

export function plan(profile: string, quality: string): EnginePlan {
  void quality
  if (profile === 'piano') return { engine: 'hires', rate: 16000 }
  return { engine: 'bp', rate: 22050 }
}

export function transcribe(
  samples: Float32Array,
  preset: { precision: PassThresholds; recall: PassThresholds },
  p: EnginePlan,
  quality: string,
  on_progress: ((ratio: number, text: string) => void) | null,
): Promise<Passes> {
  return new Promise((resolve, reject) => {
    if (
      (p.engine === 'hires' && p.rate !== 16000) ||
      (p.engine === 'bp' && p.rate !== 22050)
    ) {
      reject(
        new Error(
          '内部エラー: エンジンとレートが不一致（' +
            p.engine +
            '/' +
            String(p.rate) +
            '）',
        ),
      )
      return
    }
    let w: Worker
    try {
      w = ensure()
    } catch (e) {
      void e
      reject(new Error('この環境ではワーカーを起動できません'))
      return
    }
    const id = next_id++
    jobs.set(id, { resolve, reject, on_progress })
    w.postMessage(
      {
        type: 'transcribe',
        id,
        build: BUILD_ID,
        samples,
        engine: p.engine,
        rate: p.rate,
        quality,
        precision: preset.precision,
        recall: preset.recall,
      },
      [samples.buffer],
    )
  })
}
