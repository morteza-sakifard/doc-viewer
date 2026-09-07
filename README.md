# نُما

A web-based Markdown viewer with full **RTL/LTR** support, built for reading Persian technical documents that mix Persian prose with English terms and code.

Unlike typical previews, نُما detects the direction of each block intelligently: a heading that starts with English code but is written in Persian renders right-to-left, while code cells inside tables stay left-aligned.

## Features

### Library (folder scan)

- Type a folder path (e.g. `C:\docs\my-project`) and every `.md` / `.markdown` file at any depth renders on **one page**, preserving the folder hierarchy
- Numeric-aware ordering (`01-…` before `02-…` before `steps/10-…`)
- Per-file path chips, folder separators, and quick jumps between files
- Open folders via the system dialog (File System Access API), open single files, or drag & drop

### Tree table of contents

- Three levels: folder → file → headings, with per-branch collapse
- A global "collapse all / expand all" button
- Scroll-spy highlights the active folder, file and heading at once
- Heading search with a match counter and Enter-to-jump

### Quick paste (no saving)

- Paste Markdown and instantly read the rendered result — nothing is written to disk
- Text lives in `sessionStorage`: it survives a refresh and is cleared when the tab closes
- Save (downloads `paste.md`), clear (two-step confirm) and edit buttons

### RTL/LTR detection

- Every heading, paragraph, list and quote is analyzed separately: any Persian/Arabic letter makes it RTL — even if it starts with English code
- Tables take a direction from their content while each cell keeps its own (code cells like `TsEvent` stay LTR)
- Code blocks are always LTR with horizontal scrolling

### Mermaid diagrams

- ` ```mermaid ` blocks render automatically in a monochrome theme that matches light/dark mode
- Click a diagram for a fullscreen modal: wheel zoom around the cursor, drag to pan, `+` / `−` / reset buttons, and `+` `-` `0` `Esc` keys

### Look & feel

- Light/dark theme (persisted)
- Vazirmatn for Persian text, JetBrains Mono for code — self-hosted, no CDN
- Minimal editorial layout with a narrow reading column
- Collapsible sidebar (state persisted), fully responsive

### Also included

- Syntax highlighting with a copy button (highlight.js)
- Word, section and code-block counts plus reading time
- External links open in a new tab; unresolved relative links show an in-app message

## Getting started

Requires Node.js 18+.

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # outputs to dist/
npm run preview  # preview the production build
```

The app starts by rendering this `README.md`.

## Folder-scan note

Browsers cannot read arbitrary disk paths for security reasons. نُما adds a small API as Vite middleware (available in both `dev` and `preview`):

- `GET /api/docs-tree?root=…` — recursive scan (skips `node_modules`, `.git`, `dist` and hidden folders)
- `GET /api/docs-file?root=…&rel=…` — file content, guarded against path traversal

Typing a folder path therefore requires running the project's own dev/preview server. On any static host, folder picking (File System Access API), single files, drag & drop and Quick paste still work.

## Project structure

```
doc-viewer/
├── README.md                # this file — the app's default document
├── 00-architecture.md       # sample Persian/English document
├── sample-docs/             # test fixture with a subfolder
├── index.html
├── vite.config.ts           # includes the folder-scan middleware
└── src/
    ├── main.tsx             # entry + local fonts
    ├── App.tsx              # Markdown rendering, RTL, TOC tree, Mermaid modal
    └── styles.css           # editorial theme, light/dark, responsive
```

## Tech stack

| Tool | Role |
| --- | --- |
| Vite + React 18 + TypeScript | platform & UI |
| react-markdown + remark-gfm | safe Markdown rendering (no raw HTML) |
| highlight.js | syntax highlighting |
| mermaid | diagrams |
| lucide-react | icons |
| @fontsource (Vazirmatn, JetBrains Mono) | self-hosted fonts |
