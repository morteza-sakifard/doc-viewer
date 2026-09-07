import { Fragment, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'
import mermaid from 'mermaid'
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronDown,
  ChevronLeft,
  ClipboardPaste,
  Copy,
  Eraser,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  Info,
  Library,
  Loader2,
  Maximize2,
  Menu,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Sun,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import readmeMarkdown from '../README.md?raw'

type ViewMode = 'library' | 'paste'
type Theme = 'light' | 'dark'
type Direction = 'rtl' | 'ltr' | 'auto'
type Heading = { id: string; text: string; level: number }
type DocFile = {
  id: string
  rel: string
  name: string
  dir: string
  content: string
  headings: Heading[]
  words: number
}
type TocFolderNode = { kind: 'folder'; id: string; name: string; depth: number; children: TocNode[] }
type TocFileNode = { kind: 'file'; id: string; name: string; depth: number; headings: Heading[]; firstHeadingId?: string }
type TocNode = TocFolderNode | TocFileNode
type LocalDoc = { rel: string; text: string }

const rtlLetterPattern = /[\u05D0-\u05EA\u0621-\u063A\u0641-\u064A\u066E-\u06D5\u06FA-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const ltrCharacters = /[A-Za-z]/
const MD_NAME_PATTERN = /\.(md|markdown)$/i
const LOCAL_SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv'])
let mermaidCounter = 0

const faNumber = (value: number) => value.toLocaleString('fa-IR')

// جهت هر بلاک: اگر حرف عربی/فارسی در متن هست RTL است — حتی وقتی با واژه یا رقم انگلیسی شروع می‌شود.
// ارقام فارسی (۰-۹) و علائم در الگو نیستند چون جهت قوی ندارند و نباید ملاک باشند.
function getDirection(value: string): Direction {
  if (rtlLetterPattern.test(value)) return 'rtl'
  if (ltrCharacters.test(value)) return 'ltr'
  return 'auto'
}

function toPlainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(toPlainText).join('')
  if (typeof node === 'object' && 'props' in node) {
    const element = node as { props?: { children?: ReactNode } }
    return toPlainText(element.props?.children)
  }
  return ''
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'section'
}

function extractHeadings(markdown: string, prefix: string): Heading[] {
  return [...markdown.matchAll(/^(#{1,4})\s+(.+?)\s*#*\s*$/gm)].map((match) => {
    const text = match[2].trim().replace(/[`*_~]/g, '')
    const line = markdown.slice(0, match.index ?? 0).split('\n').length
    return { id: `${prefix}--L${line}`, text, level: match[1].length }
  })
}

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/u).length : 0
}

function makeDoc(rel: string, content: string, index: number): DocFile {
  const id = `d${index}-${slugify(rel)}`
  return {
    id,
    rel,
    name: rel.split('/').pop() ?? rel,
    dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    content,
    headings: extractHeadings(content, id),
    words: countWords(content),
  }
}

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

function buildTocTree(docs: DocFile[]): TocNode[] {
  const root: TocNode[] = []
  const folders = new Map<string, TocFolderNode>()
  for (const doc of docs) {
    const segments = doc.dir ? doc.dir.split('/') : []
    let container = root
    segments.forEach((segment, index) => {
      const key = segments.slice(0, index + 1).join('/')
      let folder = folders.get(key)
      if (!folder) {
        folder = { kind: 'folder', id: `dir-${key}`, name: segment, depth: index, children: [] }
        folders.set(key, folder)
        container.push(folder)
      }
      container = folder.children
    })
    container.push({
      kind: 'file',
      id: doc.id,
      name: doc.name,
      depth: segments.length,
      headings: doc.headings.filter((heading) => heading.level > 1),
      firstHeadingId: doc.headings[0]?.id,
    })
  }
  return root
}

async function collectLocalMarkdown(dir: FileSystemDirectoryHandle, prefix = ''): Promise<Array<{ rel: string; file: File }>> {
  const out: Array<{ rel: string; file: File }> = []
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.') || LOCAL_SKIP_DIRECTORIES.has(entry.name)) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === 'directory') {
      out.push(...await collectLocalMarkdown(entry as FileSystemDirectoryHandle, rel))
    } else if (entry.kind === 'file' && MD_NAME_PATTERN.test(entry.name)) {
      out.push({ rel, file: await (entry as FileSystemFileHandle).getFile() })
    }
  }
  return out
}

function useHtmlTheme(): Theme {
  const [current, setCurrent] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) || 'light')
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setCurrent((root.dataset.theme as Theme) || 'light'))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return current
}

const mermaidThemeVariables = (dark: boolean) => ({
  fontSize: '13px',
  fontFamily: 'Vazirmatn, Tahoma, sans-serif',
  primaryColor: dark ? '#2b2b29' : '#f1f0ec',
  primaryTextColor: dark ? '#e7e5e0' : '#1c1c1c',
  primaryBorderColor: dark ? '#57554e' : '#b8b7b0',
  lineColor: dark ? '#8f8d85' : '#7a7971',
  secondaryColor: dark ? '#232322' : '#e9e8e4',
  tertiaryColor: dark ? '#1d1d1c' : '#f7f6f3',
  mainBkg: dark ? '#2b2b29' : '#f1f0ec',
  nodeBorder: dark ? '#57554e' : '#b8b7b0',
  clusterBkg: dark ? '#1b1b1a' : '#f7f6f3',
  clusterBorder: dark ? '#333330' : '#d6d5cf',
  titleColor: dark ? '#e7e5e0' : '#1c1c1c',
  edgeLabelBackground: dark ? '#1c1c1b' : '#ffffff',
  noteBkgColor: dark ? '#2b2b29' : '#f7f4e8',
  noteTextColor: dark ? '#e7e5e0' : '#1c1c1c',
  noteBorderColor: dark ? '#57554e' : '#d9d2b0',
})

function MermaidBlock({ definition }: { definition: string }) {
  const theme = useHtmlTheme()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [panning, setPanning] = useState(false)
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const idRef = useRef(`mermaid-${++mermaidCounter}`)

  useEffect(() => {
    let cancelled = false
    setSvg('')
    setError(false)
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: mermaidThemeVariables(theme === 'dark'),
    })
    mermaid
      .render(idRef.current, definition)
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [definition, theme])

  const clampScale = (value: number) => Math.min(6, Math.max(0.3, value))
  const zoomAroundCenter = (factor: number) =>
    setView((v) => {
      const scale = clampScale(v.scale * factor)
      const applied = scale / v.scale
      return { scale, tx: v.tx * applied, ty: v.ty * applied }
    })
  const openZoom = () => {
    setView({ scale: 1, tx: 0, ty: 0 })
    setZoomed(true)
  }

  useEffect(() => {
    if (!zoomed) return
    const viewport = viewportRef.current
    const canvas = canvasRef.current
    if (!viewport || !canvas) return
    const svgEl = canvas.querySelector('svg')
    if (svgEl) {
      const maxWidth = parseFloat(getComputedStyle(svgEl).maxWidth)
      const viewBoxWidth = svgEl.viewBox?.baseVal?.width ?? 0
      const natural = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : viewBoxWidth
      if (natural > 0) canvas.style.width = `${natural}px`
    }
    const width = canvas.offsetWidth || 800
    const height = canvas.offsetHeight || 500
    const fit = Math.min((viewport.clientWidth - 48) / width, (viewport.clientHeight - 48) / height)
    setView({ scale: clampScale(fit), tx: 0, ty: 0 })
  }, [zoomed, svg])

  useEffect(() => {
    if (!zoomed) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [zoomed])

  useEffect(() => {
    if (!zoomed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomed(false)
      else if (event.key === '+' || event.key === '=') zoomAroundCenter(1.2)
      else if (event.key === '-') zoomAroundCenter(1 / 1.2)
      else if (event.key === '0') setView({ scale: 1, tx: 0, ty: 0 })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed])

  useEffect(() => {
    if (!zoomed) return
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const cx = event.clientX - rect.left - rect.width / 2
      const cy = event.clientY - rect.top - rect.height / 2
      setView((v) => {
        const scale = clampScale(v.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12))
        const applied = scale / v.scale
        return { scale, tx: cx - (cx - v.tx) * applied, ty: cy - (cy - v.ty) * applied }
      })
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [zoomed])

  useEffect(() => {
    if (!panning) return
    const onMove = (event: PointerEvent) => {
      const start = dragRef.current
      if (!start) return
      setView((v) => ({ ...v, tx: start.tx + (event.clientX - start.x), ty: start.ty + (event.clientY - start.y) }))
    }
    const onUp = () => {
      dragRef.current = null
      setPanning(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [panning])

  if (error) {
    return (
      <figure className="diagram is-fallback" dir="ltr">
        <figcaption><AlertCircle size={13} /> Mermaid preview unavailable</figcaption>
        <pre><code>{definition}</code></pre>
      </figure>
    )
  }

  return (
    <figure className="diagram is-zoomable" dir="ltr">
      <div
        className="diagram-svg"
        role="button"
        tabIndex={0}
        aria-label="نمایش بزرگ‌تر نمودار"
        onClick={openZoom}
        onKeyDown={(event) => { if (event.key === 'Enter') openZoom() }}
      >
        {svg
          ? <div dangerouslySetInnerHTML={{ __html: svg }} />
          : <figcaption className="diagram-loading"><span />Rendering diagram…</figcaption>}
        {svg && <span className="diagram-zoom-hint"><Maximize2 size={13} /> بزرگ‌نمایی</span>}
      </div>

      {zoomed && svg && (
        <div className="diagram-modal" role="dialog" aria-modal="true" aria-label="نمودار در نمای بزرگ" onClick={() => setZoomed(false)}>
          <div className="diagram-modal-tools" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => zoomAroundCenter(1.25)} aria-label="بزرگ‌نمایی"><ZoomIn size={15} /></button>
            <span className="zoom-level">{faNumber(Math.round(view.scale * 100))}٪</span>
            <button type="button" onClick={() => zoomAroundCenter(1 / 1.25)} aria-label="کوچک‌نمایی"><ZoomOut size={15} /></button>
            <button type="button" onClick={() => setView({ scale: 1, tx: 0, ty: 0 })} aria-label="بازنشانی زوم"><RotateCcw size={14} /></button>
            <span className="diagram-modal-separator" />
            <button type="button" onClick={() => setZoomed(false)} aria-label="بستن"><X size={15} /></button>
          </div>
          <div
            className={`diagram-viewport ${panning ? 'is-panning' : ''}`}
            ref={viewportRef}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
              dragRef.current = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty }
              setPanning(true)
            }}
          >
            <div className="diagram-canvas" ref={canvasRef} style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }} dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
          <div className="diagram-modal-hint">کشیدن = جابه‌جایی · اسکرول = زوم · Esc = بستن</div>
        </div>
      )}
    </figure>
  )
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  if (language === 'mermaid') {
    return <MermaidBlock definition={code} />
  }

  let highlighted = ''
  try {
    highlighted = language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code).value
  } catch {
    highlighted = code
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="codeblock" dir="ltr">
      <div className="codeblock-bar">
        <span>{language ?? 'text'}</span>
        <button type="button" onClick={copyCode} aria-label="کپی کد">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
    </div>
  )
}

function buildComponents(prefix: string, onNotice: (message: string) => void): Components {
  type HeadingProps = { children?: ReactNode; node?: unknown } & React.HTMLAttributes<HTMLElement>
  const headingIdFor = (text: string, node: unknown) => {
    const line = (node as { position?: { start?: { line?: number } } } | undefined)?.position?.start?.line
    return line ? `${prefix}--L${line}` : `${prefix}--${slugify(text)}`
  }
  const headingComponent = (Tag: 'h1' | 'h2' | 'h3' | 'h4') =>
    function HeadingRenderer({ children, node, ...props }: HeadingProps) {
      const text = toPlainText(children)
      const id = headingIdFor(text, node)
      return <Tag id={id} data-heading-id={id} dir={getDirection(text)} {...props}>{children}</Tag>
    }
  return {
    pre: ({ children }) => {
      const child = Array.isArray(children) ? children[0] : children
      if (isValidElement(child)) {
        const props = child.props as { className?: string; children?: ReactNode }
        const language = props.className?.match(/language-([\w-]+)/)?.[1]
        return <CodeBlock code={toPlainText(props.children).replace(/\n$/, '')} language={language} />
      }
      return <pre>{children}</pre>
    },
    code: ({ children, node: _node }) => <code className="inline-code" dir="auto">{children}</code>,
    h1: headingComponent('h1'),
    h2: headingComponent('h2'),
    h3: headingComponent('h3'),
    h4: headingComponent('h4'),
    p: ({ children, node: _node, ...props }) => <p dir={getDirection(toPlainText(children))} {...props}>{children}</p>,
    li: ({ children, node: _node, ...props }) => <li dir={getDirection(toPlainText(children))} {...props}>{children}</li>,
    blockquote: ({ children, node: _node, ...props }) => <blockquote dir={getDirection(toPlainText(children))} {...props}>{children}</blockquote>,
    table: ({ children, node: _node, ...props }) => <div className="table-scroll" dir={getDirection(toPlainText(children))}><table {...props}>{children}</table></div>,
    th: ({ children, node: _node, ...props }) => <th dir={getDirection(toPlainText(children))} {...props}>{children}</th>,
    td: ({ children, node: _node, ...props }) => <td dir={getDirection(toPlainText(children))} {...props}>{children}</td>,
    a: ({ children, href, node: _node, ...props }) => {
      const isExternal = Boolean(href && /^(https?:)?\/\//i.test(href))
      const isRelative = Boolean(href && !isExternal && !href.startsWith('#'))
      return (
        <a
          href={href}
          dir="auto"
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer' : undefined}
          onClick={isRelative ? (event) => {
            event.preventDefault()
            onNotice(`لینک ${href} به فایل دیگری اشاره می‌کند که در این مجموعه بارگذاری نشده است.`)
          } : undefined}
          {...props}
        >
          <bdi>{children}</bdi>{isExternal && <ExternalLink size={12} aria-hidden="true" />}
        </a>
      )
    },
  }
}

function DocSection({ doc, onNotice }: { doc: DocFile; onNotice: (message: string) => void }) {
  const components = useMemo(() => buildComponents(doc.id, onNotice), [doc, onNotice])
  return (
    <section className="doc-section" data-file-id={doc.id}>
      <div className="file-sep" id={`file-${doc.id}`}>
        <span className="sep-rule" />
        <span className="path-chip" dir="ltr"><FileText size={12} /> {doc.rel}</span>
        <span className="sep-rule" />
      </div>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{doc.content}</ReactMarkdown>
    </section>
  )
}

function App() {
  const [docs, setDocs] = useState<DocFile[]>(() => [makeDoc('README.md', readmeMarkdown, 0)])
  const [source, setSource] = useState('README.md')
  const [folderPath, setFolderPath] = useState('')
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('doc-viewer-theme') as Theme) || 'light')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeHeading, setActiveHeading] = useState('')
  const [notice, setNotice] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [mobileTocOpen, setMobileTocOpen] = useState(false)
  const [showTopButton, setShowTopButton] = useState(false)
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('doc-viewer-sidebar') !== 'closed')
  const [view, setView] = useState<ViewMode>('library')
  const [pasteText, setPasteText] = useState(() => sessionStorage.getItem('doc-viewer-paste') ?? '')
  const [pasteEditing, setPasteEditing] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)

  const pasteHasText = pasteText.trim().length > 0
  const pasteDocs = useMemo(
    () => (view === 'paste' && pasteHasText ? [makeDoc('paste.md', pasteText, 0)] : []),
    [view, pasteHasText, pasteText],
  )
  const activeDocs = view === 'paste' ? pasteDocs : docs

  const tocTree = useMemo(() => buildTocTree(activeDocs), [activeDocs])
  const collapsibleIds = useMemo(() => {
    const ids: string[] = []
    const walk = (nodes: TocNode[]) => {
      for (const node of nodes) {
        if (node.kind === 'folder') {
          ids.push(node.id)
          walk(node.children)
        } else if (node.headings.length) {
          ids.push(node.id)
        }
      }
    }
    walk(tocTree)
    return ids
  }, [tocTree])
  const allCollapsed = collapsibleIds.length > 0 && collapsibleIds.every((id) => collapsedNodes.has(id))
  const toggleAllNodes = () => setCollapsedNodes(allCollapsed ? new Set() : new Set(collapsibleIds))
  const allHeadings = useMemo(() => activeDocs.flatMap((doc) => doc.headings), [activeDocs])
  const tocHeadings = allHeadings.filter((heading) => heading.level > 1)
  const totalWords = activeDocs.reduce((sum, doc) => sum + doc.words, 0)
  const codeBlockCount = activeDocs.reduce((sum, doc) => sum + (doc.content.match(/^```/gm)?.length ?? 0) / 2, 0)
  const readMinutes = Math.max(1, Math.ceil(totalWords / 190))
  const activeDocId = activeDocs.find((doc) => doc.headings.some((heading) => heading.id === activeHeading))?.id ?? activeDocs[0]?.id ?? ''
  const query = searchQuery.trim().toLocaleLowerCase()
  const matchingHeadingCount = query ? allHeadings.filter((heading) => heading.text.toLocaleLowerCase().includes(query)).length : 0
  const showPasteEditor = view === 'paste' && (pasteEditing || !pasteHasText)

  useEffect(() => {
    sessionStorage.setItem('doc-viewer-paste', pasteText)
  }, [pasteText])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('doc-viewer-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('doc-viewer-sidebar', sidebarOpen ? 'open' : 'closed')
  }, [sidebarOpen])

  useEffect(() => {
    if (dirInputRef.current) dirInputRef.current.setAttribute('webkitdirectory', '')
  }, [])

  useEffect(() => {
    const onScroll = () => setShowTopButton(window.scrollY > 520)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const headingElements = [...document.querySelectorAll<HTMLElement>('[data-heading-id]')]
    if (!headingElements.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveHeading(visible[0].target.getAttribute('data-heading-id') || '')
      },
      { rootMargin: '-84px 0px -64% 0px', threshold: [0, 1] },
    )
    headingElements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [activeDocs, theme])

  const savePasteFile = () => {
    if (!pasteHasText) return
    const blob = new Blob([pasteText], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'paste.md'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const clearPaste = () => {
    if (!pasteHasText) return
    if (!confirmingClear) {
      setConfirmingClear(true)
      window.setTimeout(() => setConfirmingClear(false), 3200)
      return
    }
    setConfirmingClear(false)
    setPasteText('')
    setPasteEditing(true)
    setNotice('')
  }

  const switchView = (mode: ViewMode) => {
    setView(mode)
    if (mode === 'paste') setPasteEditing(!pasteText.trim())
    setActiveHeading('')
  }

  const applyDocs = (list: LocalDoc[], label: string) => {
    setDocs(list.map((item, index) => makeDoc(item.rel, item.text, index)))
    setSource(label)
    setCollapsedNodes(new Set())
    setNotice('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const scanFolder = async (rawPath: string) => {
    const root = rawPath.trim().replace(/^["']|["']$/g, '')
    if (!root || scanning) return
    setScanning(true)
    setProgress(null)
    try {
      const treeRes = await fetch(`/api/docs-tree?root=${encodeURIComponent(root)}`)
      const treeData = await treeRes.json()
      if (!treeRes.ok) throw new Error(treeData.error || 'اسکن پوشه انجام نشد.')
      const files = treeData.files as Array<{ rel: string }>
      if (!files.length) {
        setNotice('هیچ فایل Markdown در این پوشه پیدا نشد.')
        return
      }
      setProgress({ done: 0, total: files.length })
      const collected: LocalDoc[] = []
      const batchSize = 6
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        const results = await Promise.all(batch.map(async (file) => {
          const res = await fetch(`/api/docs-file?root=${encodeURIComponent(root)}&rel=${encodeURIComponent(file.rel)}`)
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || `خواندن ${file.rel} ناموفق بود.`)
          return { rel: file.rel, text: String(data.content ?? '') }
        }))
        collected.push(...results)
        setProgress({ done: Math.min(i + batchSize, files.length), total: files.length })
      }
      applyDocs(collected, root)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'اسکن پوشه انجام نشد.')
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }

  const applyLocalFiles = async (files: Array<{ rel: string; file: File }>, label: string) => {
    const sorted = [...files].sort((a, b) => compareSegmentLists(a.rel.split('/'), b.rel.split('/')))
    const list = await Promise.all(sorted.map(async (item) => ({ rel: item.rel, text: await item.file.text() })))
    applyDocs(list, label)
  }

  const pickDirectory = async () => {
    const host = window as unknown as {
      showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>
    }
    if (host.showDirectoryPicker) {
      try {
        const dir = await host.showDirectoryPicker({ mode: 'read' })
        const collected = await collectLocalMarkdown(dir)
        if (!collected.length) {
          setNotice('هیچ فایل Markdown در این پوشه پیدا نشد.')
          return
        }
        await applyLocalFiles(collected, dir.name)
      } catch {
        /* کاربر پنجره را بست */
      }
    } else {
      dirInputRef.current?.click()
    }
  }

  const handleDirectoryInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
      .filter((file) => MD_NAME_PATTERN.test(file.name))
      .map((file) => ({
        rel: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        file,
      }))
    event.target.value = ''
    if (!files.length) {
      setNotice('در پوشه‌ی انتخاب‌شده فایل Markdown پیدا نشد.')
      return
    }
    const first = files[0].rel.split('/')[0]
    await applyLocalFiles(files, first)
  }

  const handleSingleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!MD_NAME_PATTERN.test(file.name) && file.type && file.type !== 'text/markdown') {
      setNotice('لطفاً یک فایل Markdown با پسوند md یا markdown انتخاب کنید.')
      return
    }
    await applyLocalFiles([{ rel: file.name, file }], file.name)
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const files = [...(event.dataTransfer.files ?? [])]
      .filter((file) => MD_NAME_PATTERN.test(file.name) || file.type === 'text/markdown')
    if (!files.length) {
      setNotice('فقط فایل‌های Markdown (md و markdown) پشتیبانی می‌شوند.')
      return
    }
    if (view === 'paste') {
      setPasteText(await files[0].text())
      setPasteEditing(false)
      setNotice('')
      return
    }
    await applyLocalFiles(files.map((file) => ({ rel: file.name, file })), files[0].name)
  }

  const scrollToId = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setMobileTocOpen(false)
  }

  const toggleNode = (id: string) => {
    setCollapsedNodes((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !query) return
    const match = allHeadings.find((heading) => heading.text.toLocaleLowerCase().includes(query))
    if (match) {
      scrollToId(match.id)
      setActiveHeading(match.id)
    }
  }

  const renderTocNodes = (nodes: TocNode[]): ReactNode =>
    nodes.map((node) => {
      if (node.kind === 'folder') {
        const isCollapsed = collapsedNodes.has(node.id)
        return (
          <div key={node.id} className="toc-branch">
            <div className={`toc-row depth-${node.depth} ${activeDocId && node.children.some(child => child.kind === 'file' && child.id === activeDocId) ? 'active-branch' : ''}`}>
              <button className="toc-caret" type="button" onClick={() => toggleNode(node.id)} aria-label={isCollapsed ? 'باز کردن' : 'بستن'}>
                {isCollapsed ? <ChevronLeft size={12} /> : <ChevronDown size={12} />}
              </button>
              <button className="toc-main" type="button" onClick={() => toggleNode(node.id)}>
                <Folder size={12} />
                <span>{node.name}</span>
              </button>
            </div>
            {!isCollapsed && renderTocNodes(node.children)}
          </div>
        )
      }
      const isCollapsed = collapsedNodes.has(node.id)
      const isActiveFile = activeDocId === node.id
      return (
        <div key={node.id} className="toc-branch">
          <div className={`toc-row depth-${node.depth} ${isActiveFile ? 'active-branch' : ''}`}>
            <button className="toc-caret" type="button" onClick={() => toggleNode(node.id)} aria-label={isCollapsed ? 'باز کردن' : 'بستن'}>
              {isCollapsed ? <ChevronLeft size={12} /> : <ChevronDown size={12} />}
            </button>
            <button className="toc-main" type="button" onClick={() => {
              scrollToId(`file-${node.id}`)
              if (node.firstHeadingId) setActiveHeading(node.firstHeadingId)
            }}>
              <FileText size={12} />
              <span>{node.name}</span>
            </button>
          </div>
          {!isCollapsed && node.headings.map((heading) => (
            <button
              key={heading.id}
              type="button"
              className={`toc-link ${activeHeading === heading.id ? 'active' : ''}`}
              style={{ paddingInlineStart: 26 + node.depth * 13 }}
              onClick={() => {
                scrollToId(heading.id)
                setActiveHeading(heading.id)
              }}
            >
              <span>{heading.text}</span>
            </button>
          ))}
        </div>
      )
    })

  const tocContent = (
    <>
      {tocTree.length
        ? renderTocNodes(tocTree)
        : <span className="toc-empty">{view === 'paste' && !pasteHasText ? 'متنی چسبانده نشده است.' : 'هنوز عنوانی وجود ندارد.'}</span>}
      {tocTree.length === 0 && null}
    </>
  )

  return (
    <div className={`app ${isDragging ? 'is-dragging' : ''} ${sidebarOpen ? '' : 'sidebar-closed'}`} dir="rtl"
      onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <aside className="sidebar">
        <div className="sidebar-brand"><strong>نُما</strong><span>خوانشگر مستندات</span></div>

        {view === 'library' ? (
          <>
            <form className="path-scan" onSubmit={(event) => { event.preventDefault(); scanFolder(folderPath) }}>
              <label htmlFor="folder-path">مسیر پوشه‌ی مستندات</label>
              <div className="path-row">
                <input
                  id="folder-path"
                  dir="ltr"
                  value={folderPath}
                  onChange={(event) => setFolderPath(event.target.value)}
                  placeholder="C:\docs\my-project"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button type="submit" disabled={scanning || !folderPath.trim()} aria-label="اسکن پوشه">
                  {scanning ? <Loader2 size={15} className="spin" /> : <FolderSearch size={15} />}
                </button>
              </div>
              {progress && (
                <span className="scan-progress">در حال خواندن {faNumber(progress.done)} از {faNumber(progress.total)} فایل…</span>
              )}
            </form>

            <div className="sidebar-actions">
              <button className="ghost-button" type="button" onClick={pickDirectory}><FolderOpen size={13} /> انتخاب پوشه…</button>
              <button className="ghost-button" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={13} /> فایل تکی…</button>
            </div>
          </>
        ) : (
          <>
            <div className="paste-side-note">
              <Info size={13} />
              <span>این متن ذخیره‌ی دائمی نمی‌شود؛ با بستنِ تب مرورگر پاک می‌شود. اگر خواستی با «ذخیره» دانلودش کن.</span>
            </div>
            <div className="sidebar-actions">
              <button className="ghost-button" type="button" onClick={() => setPasteEditing(true)} disabled={!pasteHasText || showPasteEditor}><Pencil size={13} /> ویرایش متن</button>
              <button className="ghost-button" type="button" onClick={savePasteFile} disabled={!pasteHasText}><Save size={13} /> ذخیره فایل</button>
              <button className={`ghost-button ${confirmingClear ? 'danger' : ''}`} type="button" onClick={clearPaste} disabled={!pasteHasText}><Eraser size={13} /> {confirmingClear ? 'مطمئنی؟ دوباره بزن' : 'پاک کردن'}</button>
            </div>
          </>
        )}

        <div className="toc-head">
          <button className="toc-toggle" type="button" onClick={toggleAllNodes} disabled={!collapsibleIds.length}>
            {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
            <span>{allCollapsed ? 'باز کردن همه' : 'بستن همه'}</span>
          </button>
        </div>
        <nav className="toc" aria-label="فهرست مطالب">{tocContent}</nav>

        <div className="sidebar-foot">
          <span className="sidebar-source" dir="ltr" title={view === 'paste' ? 'paste.md' : source}>{view === 'paste' ? 'paste.md' : source}</span>
          <span className="sidebar-stats">{faNumber(activeDocs.length)} فایل · {faNumber(totalWords)} واژه</span>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div className="mode-switch" role="tablist" aria-label="بخش‌ها">
            <button type="button" role="tab" aria-selected={view === 'library'} className={view === 'library' ? 'active' : ''} onClick={() => switchView('library')}>
              <Library size={14} /><span>کتابخانه</span>
            </button>
            <button type="button" role="tab" aria-selected={view === 'paste'} className={view === 'paste' ? 'active' : ''} onClick={() => switchView('paste')}>
              <ClipboardPaste size={14} /><span>متن سریع</span>
            </button>
          </div>
          <span className="topbar-file" dir="ltr" title={view === 'paste' ? 'paste.md' : source}>{view === 'paste' ? 'paste.md' : source}</span>
          <div className="topbar-tools">
            <button className="icon-button sidebar-toggle" type="button" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? 'بستن سایدبار' : 'نمایش سایدبار'}>
              {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>
            <label className="search">
              <Search size={15} />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="جست‌وجو…" aria-label="جست‌وجو در سند" />
              {searchQuery && <span className="search-count">{faNumber(matchingHeadingCount)}</span>}
            </label>
            <button className="icon-button menu-button" type="button" onClick={() => setMobileTocOpen((open) => !open)} aria-label="فهرست مطالب"><Menu size={16} /></button>
            <button className="icon-button" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'حالت تیره' : 'حالت روشن'}>
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            {view === 'library' && (
              <button className="text-button" type="button" onClick={pickDirectory}><FolderOpen size={14} /> انتخاب پوشه</button>
            )}
          </div>
        </header>

        {mobileTocOpen && (
          <div className="mobile-toc">
            <div className="mobile-toc-head">
              <strong>فهرست مطالب</strong>
              <div className="mobile-toc-head-actions">
                <button className="toc-toggle" type="button" onClick={toggleAllNodes} disabled={!collapsibleIds.length} aria-label={allCollapsed ? 'باز کردن همه' : 'بستن همه'}>
                  {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
                </button>
                <button type="button" onClick={() => setMobileTocOpen(false)} aria-label="بستن"><X size={15} /></button>
              </div>
            </div>
            {tocContent}
          </div>
        )}

        {showPasteEditor ? (
          <div className="paste-editor">
            <div className="paste-editor-bar">
              <span><ClipboardPaste size={14} /> متن Markdown را بچسبانید — فقط خواندنی، ذخیره‌ی دائمی نمی‌شود</span>
              <div className="paste-editor-actions">
                <button type="button" onClick={savePasteFile} disabled={!pasteHasText}><Save size={13} /> ذخیره</button>
                <button type="button" className={confirmingClear ? 'danger' : ''} onClick={clearPaste}>
                  <Eraser size={13} /> {confirmingClear ? 'مطمئنی؟ دوباره بزن' : 'پاک کردن'}
                </button>
                <button type="button" className="primary" onClick={() => setPasteEditing(false)} disabled={!pasteHasText}><Eye size={13} /> نمایش خوانا</button>
              </div>
            </div>
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={'متن Markdown را اینجا بچسبانید (Ctrl+V)…\n\n# عنوان\nمتن فارسی با **کلمه‌ی انگلیسی** و `code`\n\n```go\nfunc main() {}\n```'}
              spellCheck={false}
              dir="auto"
              aria-label="متن Markdown"
            />
          </div>
        ) : (
          <>
            <div className="doc-head">
              <span className="doc-meta">{faNumber(activeDocs.length)} فایل</span>
              <span className="doc-meta-sep" aria-hidden="true">·</span>
              <span className="doc-meta">{faNumber(totalWords)} واژه</span>
              <span className="doc-meta-sep" aria-hidden="true">·</span>
              <span className="doc-meta">حدود {faNumber(readMinutes)} دقیقه</span>
              <span className="doc-meta-sep" aria-hidden="true">·</span>
              <span className="doc-meta">{faNumber(tocHeadings.length)} بخش، {faNumber(Math.round(codeBlockCount))} قطعه کد</span>
            </div>

            {view === 'paste' && (
              <div className="paste-strip">
                <Info size={13} />
                <span>این متن ذخیره‌ی دائمی نمی‌شود و با بستنِ تب پاک می‌شود.</span>
                <div className="paste-strip-actions">
                  <button type="button" onClick={() => { setPasteEditing(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Pencil size={12} /> ویرایش</button>
                  <button type="button" onClick={savePasteFile}><Save size={12} /> ذخیره</button>
                  <button type="button" className={confirmingClear ? 'danger' : ''} onClick={clearPaste}><Eraser size={12} /> {confirmingClear ? 'مطمئنی؟' : 'پاک کردن'}</button>
                </div>
              </div>
            )}

            {notice && (
              <div className="notice" role="status">
                <AlertCircle size={15} />
                <span>{notice}</span>
                <button type="button" onClick={() => setNotice('')} aria-label="بستن پیام"><X size={13} /></button>
              </div>
            )}

            <article className="doc">
              {activeDocs.map((doc, index) => {
                const previous = activeDocs[index - 1]
            const showFolder = Boolean(doc.dir) && doc.dir !== previous?.dir
            return (
              <Fragment key={doc.id}>
                {showFolder && (
                  <div className="folder-sep" id={`folder-${slugify(doc.dir)}`}>
                    <span className="sep-rule" />
                    <span className="path-chip is-folder" dir="ltr"><FolderOpen size={12} /> {doc.dir}</span>
                    <span className="sep-rule" />
                  </div>
                )}
                <DocSection doc={doc} onNotice={setNotice} />
              </Fragment>
            )
          })}
        </article>
          </>
        )}

        <footer className="foot">
          <span>نُما — برای خواندنِ آسان‌تر مستندات فنی</span>
        </footer>
      </main>

      {showTopButton && (
        <button className="back-to-top" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="بازگشت به بالا"><ArrowUp size={16} /></button>
      )}

      {isDragging && (
        <div className="drag-overlay">
          <div><Upload size={24} /><strong>فایل‌های Markdown را رها کنید</strong><span>پسوندهای md و markdown</span></div>
        </div>
      )}

      <input ref={fileInputRef} className="hidden-input" type="file" accept=".md,.markdown,text/markdown" onChange={handleSingleFileInputChange} />
      <input ref={dirInputRef} className="hidden-input" type="file" multiple onChange={handleDirectoryInputChange} />
    </div>
  )
}

export default App
