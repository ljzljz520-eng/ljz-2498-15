// Catalpa 解析器：输出带稳定 id 与源码行范围的块节点树（1-based，含尾行）
import { normalizeSource, stripInline } from './text.js'

let nodeSeq = 0
function nid() {
  nodeSeq += 1
  return `n${nodeSeq}`
}

const IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+(\d+)x(\d+))?\)\s*$/

function parseTableAlign(divider) {
  return divider
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => {
      const t = cell.trim()
      if (/^:?-+:?$/.test(t)) {
        if (t.startsWith(':') && t.endsWith(':')) return 'center'
        if (t.endsWith(':')) return 'right'
        return 'left'
      }
      return null
    })
}

function splitRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => stripInline(c.trim()))
}

export function parseDocument(source) {
  const lines = normalizeSource(source).split('\n')
  const nodes = []
  let i = 0
  let seq = 0

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()

    if (trimmed === '') { i += 1; continue }

    // 代码围栏
    if (trimmed.startsWith('```')) {
      const start = i
      i += 1
      const code = []
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i += 1 }
      if (i < lines.length) i += 1 // 收尾围栏
      seq += 1
      nodes.push({ id: nid(), seq, type: 'code', text: code.join('\n'), lineStart: start + 1, lineEnd: i })
      continue
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (h) {
      seq += 1
      nodes.push({ id: nid(), seq, type: 'heading', level: h[1].length, text: stripInline(h[2]), lineStart: i + 1, lineEnd: i + 1 })
      i += 1
      continue
    }

    // 表格（当前行像表头，下一行是分隔行）
    if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]) && /-:?\s*(\||$)/.test(lines[i + 1])) {
      const start = i
      const header = splitRow(trimmed)
      const aligns = parseTableAlign(lines[i + 1])
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitRow(lines[i].trim()))
        i += 1
      }
      const colCount = header.length
      seq += 1
      nodes.push({
        id: nid(), seq, type: 'table',
        aligns,
        header,
        rows: rows.map((r) => {
          const row = r.slice(0, colCount)
          while (row.length < colCount) row.push('')
          return row
        }),
        lineStart: start + 1, lineEnd: i
      })
      continue
    }

    // 图片独占段落
    const img = IMAGE_RE.exec(trimmed)
    if (img) {
      seq += 1
      nodes.push({
        id: nid(), seq, type: 'image', alt: img[1], src: img[2],
        declaredWidth: img[3] ? Number(img[3]) : null,
        declaredHeight: img[4] ? Number(img[4]) : null,
        lineStart: i + 1, lineEnd: i + 1
      })
      i += 1
      continue
    }

    // 分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      seq += 1
      nodes.push({ id: nid(), seq, type: 'hr', text: '', lineStart: i + 1, lineEnd: i + 1 })
      i += 1
      continue
    }

    // 引用块
    if (/^>\s?/.test(trimmed)) {
      const start = i
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      seq += 1
      nodes.push({ id: nid(), seq, type: 'quote', text: stripInline(buf.join(' ')), lineStart: start + 1, lineEnd: i })
      continue
    }

    // 列表（ul / ol 连续同型）
    const listTag = /^\s*[-*+]\s+/.test(trimmed) ? 'ul' : (/^\s*\d+\.\s+/.test(trimmed) ? 'ol' : '')
    if (listTag) {
      const start = i
      const items = []
      while (i < lines.length) {
        const t = lines[i].trim()
        const tag = /^\s*[-*+]\s+/.test(t) ? 'ul' : (/^\s*\d+\.\s+/.test(t) ? 'ol' : '')
        if (tag !== listTag) break
        items.push(stripInline(t.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')))
        i += 1
      }
      seq += 1
      nodes.push({ id: nid(), seq, type: 'list', ordered: listTag === 'ol', items, lineStart: start + 1, lineEnd: i })
      continue
    }

    // 普通段落（连续非空、非块起始行）
    const start = i
    const buf = []
    while (
      i < lines.length && lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !/^\s*[-*+]\s+/.test(lines[i].trim()) &&
      !/^\s*\d+\.\s+/.test(lines[i].trim()) &&
      !IMAGE_RE.test(lines[i].trim()) &&
      !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]))
    ) {
      buf.push(lines[i].trim())
      i += 1
    }
    seq += 1
    nodes.push({ id: nid(), seq, type: 'paragraph', text: stripInline(buf.join(' ')), lineStart: start + 1, lineEnd: i })
  }

  return nodes
}
