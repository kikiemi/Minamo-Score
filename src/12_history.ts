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
import * as audio from './02_audio.js'

export let DB_NAME = 'minamoscore'

export let DB_VER = 1

export let MAX_ENTRIES = 30

export let MAX_AUDIO_BYTES = 30 * 1024 * 1024

export let _db: IDBDatabase | null = null

export function open() {
  if (_db) return Promise.resolve(_db)
  return new Promise<IDBDatabase>(function (resolve, reject) {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB 非対応'))
      return
    }
    let req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = function () {
      let db = req.result
      if (!db.objectStoreNames.contains('results')) {
        db.createObjectStore('results', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('audio')) {
        db.createObjectStore('audio', { keyPath: 'id' })
      }
    }
    req.onsuccess = function () {
      _db = req.result
      _db!.onclose = function () {
        _db = null
      }
      resolve(req.result)
    }
    req.onerror = function () {
      reject(req.error || new Error('DBを開けません'))
    }
  })
}

function _tx_done(tx: IDBTransaction): Promise<void> {
  return new Promise<void>(function (resolve, reject) {
    tx.oncomplete = function () {
      resolve()
    }
    tx.onerror = function () {
      reject(tx.error)
    }
    tx.onabort = function () {
      reject(tx.error || new Error('aborted'))
    }
  })
}

export function save(record: HistoryRecord, audio_blob: Blob | null) {
  return open().then(function (db) {
    let store_audio = !!(audio_blob && audio_blob.size <= MAX_AUDIO_BYTES)
    record.has_audio = store_audio
    record.audio_size = audio_blob ? audio_blob.size : 0

    function attempt(with_audio: boolean): Promise<void> {
      let tx = db.transaction(['results', 'audio'], 'readwrite')
      tx.objectStore('results').put(record)
      if (with_audio) {
        tx.objectStore('audio').put({
          id: record.id,
          blob: audio_blob,
          type: (audio_blob && audio_blob.type) || '',
        })
      }
      return _tx_done(tx)
    }

    return attempt(store_audio)
      .catch(function () {
        record.has_audio = false
        return attempt(false)
      })
      .catch(function () {
        return prune(Math.max(1, MAX_ENTRIES - 6)).then(function () {
          record.has_audio = false
          return attempt(false)
        })
      })
      .then(function () {
        return prune(MAX_ENTRIES)
      })
  })
}

export interface HistorySummary {
  id: number
  name: string
  created: string
  duration: number
  notes_count: number
  has_audio: boolean
  quality: string
  backend: string
}
export function list(): Promise<HistorySummary[]> {
  return open().then(function (db) {
    return new Promise<HistorySummary[]>(function (resolve, reject) {
      const out: HistorySummary[] = []
      const tx = db.transaction('results', 'readonly')
      const req = tx.objectStore('results').openCursor(null, 'prev')
      req.onsuccess = function () {
        const cur = req.result
        if (!cur) {
          resolve(out)
          return
        }
        const v = (cur.value || {}) as HistoryRecord & { id: number }
        out.push({
          id: v.id,
          name: v.name,
          created: v.created,
          duration: v.duration,
          notes_count: v.notes_count,
          has_audio: !!v.has_audio,
          quality: v.quality || '',
          backend: v.backend || '',
        })
        cur.continue()
      }
      req.onerror = function () {
        reject(req.error)
      }
    })
  })
}

export interface HistoryGet {
  record: HistoryRecord | null
  audio: { id: number; blob: Blob; type: string } | null
}
export function get(id: number): Promise<HistoryGet> {
  return open().then(function (db) {
    return new Promise<HistoryGet>(function (resolve, reject) {
      const tx = db.transaction(['results', 'audio'], 'readonly')
      const out: HistoryGet = { record: null, audio: null }
      let r1 = tx.objectStore('results').get(id)
      r1.onsuccess = function () {
        out.record = (r1.result as HistoryRecord) || null
      }
      let r2 = tx.objectStore('audio').get(id)
      r2.onsuccess = function () {
        out.audio = (r2.result as HistoryGet['audio']) || null
      }
      tx.oncomplete = function () {
        resolve(out)
      }
      tx.onerror = function () {
        reject(tx.error)
      }
    })
  })
}

export function remove(id: number) {
  return open().then(function (db) {
    let tx = db.transaction(['results', 'audio'], 'readwrite')
    tx.objectStore('results').delete(id)
    tx.objectStore('audio').delete(id)
    return _tx_done(tx)
  })
}

export function prune(keep: number) {
  return open().then(function (db) {
    return new Promise<void>(function (resolve, reject) {
      let tx = db.transaction(['results', 'audio'], 'readwrite')
      let results = tx.objectStore('results')
      let audio = tx.objectStore('audio')
      let seen = 0
      let req = results.openCursor(null, 'prev')
      req.onsuccess = function () {
        let cur = req.result
        if (!cur) return
        seen++
        if (seen > keep) {
          results.delete(cur.primaryKey)
          audio.delete(cur.primaryKey)
        }
        cur.continue()
      }
      tx.oncomplete = function () {
        resolve()
      }
      tx.onerror = function () {
        reject(tx.error)
      }
    })
  })
}
