import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const MD_EXTENSIONS = new Set(['.md', '.markdown'])
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.idea',
  '.vscode',
  '__pycache__',
  '.venv',
  'venv',
])

function compareSegmentLists(a: string[], b: string[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const cmp = left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })
    if (cmp !== 0) return cmp
  }
  return 0
}

async function walkMarkdownFiles(root: string, rel = ''): Promise<Array<{ rel: string; size: number }>> {
  const entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true })
  const found: Array<{ rel: string; size: number }> = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      found.push(...await walkMarkdownFiles(root, relPath))
    } else if (entry.isFile() && MD_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const stats = await fsp.stat(path.join(root, relPath))
      found.push({ rel: relPath, size: stats.size })
    }
  }
  return found.sort((a, b) => compareSegmentLists(a.rel.split('/'), b.rel.split('/')))
}

function docsApiPlugin(): Plugin {
  const handle = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/docs-tree') {
      const root = url.searchParams.get('root') ?? ''
      const stats = await fsp.stat(root)
      if (!stats.isDirectory()) throw new Error('مسیر داده‌شده یک پوشه نیست.')
      const files = await walkMarkdownFiles(root)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ name: path.basename(path.resolve(root)) || root, files }))
      return
    }
    if (url.pathname === '/api/docs-file') {
      const root = path.resolve(url.searchParams.get('root') ?? '')
      const rel = url.searchParams.get('rel') ?? ''
      const abs = path.resolve(root, rel)
      const insideRoot = abs === root || abs.toLowerCase().startsWith(root.toLowerCase() + path.sep)
      if (!insideRoot) throw new Error('مسیر فایل بیرون از پوشه‌ی انتخابی است.')
      const content = await fsp.readFile(abs, 'utf8')
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ content }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }

  const middleware = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/docs-')) {
      next()
      return
    }
    handle(req, res).catch((error: unknown) => {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      const code = (error as { code?: unknown })?.code
      const raw = error instanceof Error ? error.message : 'خطای ناشناخته'
      const message = code === 'ENOENT' ? 'پوشه‌ای با این مسیر پیدا نشد.' : raw
      res.end(JSON.stringify({ error: message }))
    })
  }

  return {
    name: 'docs-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), docsApiPlugin()],
  server: {
    port: 5173,
    strictPort: false,
  },
})
