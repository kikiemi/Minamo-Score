import { build } from 'esbuild'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'prettier'

rmSync('dist', { recursive: true, force: true })

const build_id = Date.now().toString(36)
writeFileSync('src/build_id.ts', `export const BUILD_ID = '${build_id}'\n`)

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2020',
  legalComments: 'none',
  minify: false,
  logLevel: 'error',
}

await build({
  ...common,
  entryPoints: ['src/13_main.ts'],
  outfile: 'dist/app.js',
})
await build({
  ...common,
  entryPoints: ['src/worker/transcribe_worker.ts'],
  outfile: 'dist/worker.js',
})
await build({
  ...common,
  entryPoints: [
    'src/worker/engines.ts',
    'src/worker/hires.ts',
    'src/worker/bp_infer.ts',
    'src/worker/extract.ts',
    'src/worker/cfp.ts',
    'src/types.ts',
    'src/build_id.ts',
    'src/04_notes.ts',
    'src/05_tempo.ts',
    'src/06_quantize.ts',
    'src/01_state.ts',
    'src/00_util.ts',
  ],
  outdir: 'dist/mod',
  bundle: false,
  outbase: 'src',
})

function strip_comments(src) {
  const out = []
  let i = 0
  const n = src.length

  while (i < n) {
    const c = src[i]

    if (c === '"' || c.charCodeAt(0) === 39 || c === '`') {
      const q = c
      out.push(c)
      i++

      while (i < n) {
        out.push(src[i])
        if (src[i] === '\\') {
          out.push(src[i + 1])
          i += 2
          continue
        }
        if (src[i] === q) {
          i++
          break
        }
        i++
      }
      continue
    }

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }

    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i + 1 < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }

    out.push(c)
    i++
  }

  return out.join('').replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
}

async function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)

    if (f.isDirectory()) {
      await walk(p)
    } else if (f.name.endsWith('.js')) {
      const source = strip_comments(readFileSync(p, 'utf8'))
      const formatted = await format(source, {
        filepath: p,
        semi: false,
        singleQuote: true,
      })
      writeFileSync(p, formatted)
    }
  }
}

await walk('dist')
console.log('build', build_id)
