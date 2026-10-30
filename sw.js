'use strict'

var CACHE_NAME = 'minamoscore-static-v7'
var MODEL_CACHE = 'minamoscore-models-v1'

self.addEventListener('install', function (e) {
  self.skipWaiting()
})

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k.indexOf('minamoscore-static-') === 0 && k !== CACHE_NAME
            })
            .map(function (k) {
              return caches.delete(k)
            }),
        )
      })
      .then(function () {
        return self.clients.claim()
      }),
  )
})

function with_coi(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res
  var headers = new Headers(res.headers)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: headers,
  })
}

self.addEventListener('fetch', function (e) {
  var req = e.request
  if (req.method !== 'GET') return
  var url = new URL(req.url)

  if (url.origin !== location.origin) return

  if (url.pathname.indexOf('/models/') !== -1) {
    e.respondWith(
      caches.open(MODEL_CACHE).then(function (c) {
        return c.match(req).then(function (hit) {
          if (hit) return with_coi(hit)
          return fetch(req).then(function (res) {
            if (res && res.ok) c.put(req, res.clone())
            return with_coi(res)
          })
        })
      }),
    )
    return
  }

  e.respondWith(
    fetch(req)
      .then(function (res) {
        var copy = res.clone()
        caches.open(CACHE_NAME).then(function (c) {
          c.put(req, copy)
        })
        return with_coi(res)
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit ? with_coi(hit) : hit
        })
      }),
  )
})
