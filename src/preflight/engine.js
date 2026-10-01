// 确定性分页排版引擎（渲染服务的内核）。
// 固定字体度量 + 固定页面参数 + 已解码图片尺寸 => 给定输入必然得到同一分页结果。
// 预检与最终 PDF 共用本模块；两种检查路径（render-first / stream）也共用同一核心。

import { contentBox } from './pages.js'
import { lineHeight, charWidth, isGlyphCovered } from './font.js'
import { ISSUE_CODES } from './codes.js'

const HEADING_EM = { 1: 1.5, 2: 1.3, 3: 1.15, 4: 1.05, 5: 1, 6: 1 }
const CELL_PAD_X = 6
const CELL_PAD_Y = 4
const TABLE_INSET = 2

function isBreakableChar(ch) {
  const code = ch.codePointAt(0)
  if (code >= 0x4e00 && code <= 0x9fff) return true
  if (code >= 0x3400 && code <= 0x4dbf) return true
  if (code >= 0x3040 && code <= 0x30ff) return true
  if (code >= 0xac00 && code <= 0xd7a3) return true
  if (code >= 0xff00 && code <= 0xffef) return true
  if ('“”‘’—…·、。，！？；：（）《》【】〈〉「」『』〜￥'.includes(ch)) return true
  return false
}

function tokenize(text) {
  const tokens = []
  let word = ''
  const flush = () => { if (word) { tokens.push({ t: 'w', v: word }); word = '' } }
  for (const ch of text) {
    if (/\s/.test(ch)) { flush(); tokens.push({ t: 'sp' }); continue }
    if (isBreakableChar(ch)) { flush(); tokens.push({ t: 'c', v: ch }); continue }
    word += ch
  }
  flush()
  return tokens
}

function normalizeText(text) {
  return String(text ?? '').replace(/\t/g, '    ').replace(/\s+/g, ' ').trim()
}

function tokenWidth(token, font, em) {
  let w = 0
  for (const ch of token) w += charWidth(ch, font, em)
  return w
}

// 贪心折行；任何不可断单词超宽时按字符再切分，保证一定推进（分页不可能无限循环）。
// 返回行：{text,width,overflow,missing:Set}
export function wrapText(rawText, maxWidth, font, em) {
  const text = normalizeText(rawText)
  const lines = []
  let cur = newLine()
  function newLine() { return { text: '', width: 0, missing: new Set() } }
  function push() {
    cur.overflow = cur.width > maxWidth + 0.01
    lines.push(cur)
    cur = newLine()
  }
  function add(ch) {
    cur.text += ch
    cur.width += charWidth(ch, font, em)
    if (!/\s/.test(ch) && !isGlyphCovered(ch, font)) cur.missing.add(ch)
  }
  for (const tok of tokenize(text)) {
    if (tok.t === 'sp') {
      const sw = charWidth(' ', font, em)
      if (cur.text === '') continue
      if (cur.width + sw > maxWidth) { push(); continue }
      add(' ')
      continue
    }
    if (tok.t === 'c') {
      const cw = charWidth(tok.v, font, em)
      if (cur.text !== '' && cur.width + cw > maxWidth) push()
      add(tok.v)
      continue
    }
    const w = tokenWidth(tok.v, font, em)
    if (cur.text === '' || cur.width + w <= maxWidth) {
      for (const ch of tok.v) add(ch)
    } else {
      push()
      // 单词整体放不下：按字符切，保证有界
      for (const ch of tok.v) {
        const cw = charWidth(ch, font, em)
        if (cur.text !== '' && cur.width + cw > maxWidth) push()
        add(ch)
      }
    }
  }
  if (cur.text !== '' || lines.length === 0) push()
  return lines
}

export function createEngine(input) {
  const { params, font, nodes, images } = input
  const inner = contentBox(params)
  const lh = (node) => lineHeight(font, node?.em || params.fontSize)
  const baseLh = lineHeight(font, params.fontSize)
  const gap = params.paragraphGap
  const hgap = params.headingGap

  const pages = []
  let pageNo = 0
  let y = inner.y
  let table = null            // 当前跨页表格上下文
  let pendingHeading = null   // 待 keep-with-next 校验的标题
  const events = []

  function newPage() {
    pageNo += 1
    const pg = { pageNo, boxes: [], inner: { ...inner } }
    pages.push(pg)
    y = inner.y
    if (table) {
      // 跨页重复表头，并保持表/行归属
      const hh = placeTableHeader(pg, true)
      y += hh
    }
    return pg
  }

  function page() { return pages[pages.length - 1] }
  function remaining() { return inner.y + inner.height - y }

  function issue(payload) {
    const ev = { type: 'issue', issue: payload }
    events.push(ev)
    return payload
  }

  function ensureRoom(needed) {
    if (remaining() + 0.001 >= needed) return
    newPage()
  }

  function box(b) {
    page().boxes.push({ pageNo: page.pageNo, ...b })
  }

  function placeLines(lines, opts) {
    const { nodeId, gid, kind, em, x, width } = opts
    const lineH = lineHeight(font, em)
    for (let i = 0; i < lines.length; i++) {
      ensureRoom(lineH)
      const ln = lines[i]
      box({
        type: 'line', kind, nodeId, gid: gid || null,
        lineInGroup: i, groupLines: lines.length,
        x, y, width: ln.width, boxWidth: width, height: lineH,
        overflow: !!ln.overflow, missing: [...ln.missing],
        text: ln.text
      })
      y += lineH
    }
  }

  function columnWidths(tableNode) {
    const cols = tableNode.header.length
    const em = params.fontSize
    const minW = new Array(cols).fill(CELL_PAD_X * 2 + 1)
    const consider = (text, c) => {
      for (const tok of tokenize(normalizeText(text))) {
        if (tok.t === 'sp') continue
        const w = (tok.t === 'c' ? charWidth(tok.v, font, em) : tokenWidth(tok.v, font, em)) + CELL_PAD_X * 2
        if (w > minW[c]) minW[c] = w
      }
    }
    tableNode.header.forEach((h, c) => consider(h, c))
    tableNode.rows.forEach((r) => r.forEach((cell, c) => consider(cell, c)))
    const total = minW.reduce((a, b) => a + b, 0)
    let widths
    let overflow = false
    if (total > inner.width + 0.01) {
      overflow = true
      const scale = inner.width / total
      widths = minW.map((w) => w * scale)
    } else {
      const extra = inner.width - total
      widths = minW.map((w, i) => w + extra * (minW[i] / total))
    }
    return { widths, minW, total, overflow }
  }

  function placeTableHeader(pg, repeated) {
    const lineH = lineHeight(font, params.fontSize)
    const wrapped = table.headerLines
    let maxLines = 1
    wrapped.forEach((a) => { if (a.length > maxLines) maxLines = a.length })
    const hh = maxLines * lineH + CELL_PAD_Y * 2
    let cx = inner.x + TABLE_INSET
    pg.boxes.push({
      type: 'thead', nodeId: table.nodeId, repeated,
      x: cx, y, width: inner.width - TABLE_INSET * 2, height: hh
    })
    for (let c = 0; c < wrapped.length; c++) {
      const colInner = table.widths[c] - CELL_PAD_X * 2
      wrapped[c].forEach((ln, li) => {
        pg.boxes.push({
          type: 'line', kind: 'th', nodeId: table.nodeId, gid: null,
          x: cx + CELL_PAD_X, y: y + CELL_PAD_Y + li * lineH,
          width: ln.width, boxWidth: colInner, height: lineH,
          overflow: !!ln.overflow, missing: [...ln.missing], text: ln.text
        })
      })
      cx += table.widths[c]
    }
    return hh
  }

  function renderTable(node) {
    const { widths, minW, total, overflow } = columnWidths(node)
    if (overflow) {
      issue({
        code: ISSUE_CODES.TABLE_OVERFLOW, nodeId: node.id, seq: node.seq,
        page: pageNo || 1, lineStart: node.lineStart, lineEnd: node.lineEnd,
        message: `表格最小宽度 ${Math.round(total)}px 超出版心 ${Math.round(inner.width)}px`,
        detail: { tableMinWidth: Math.round(total), innerWidth: Math.round(inner.width), minColWidths: minW.map((w) => Math.round(w)) }
      })
    }
    // 无论当前页是否放得下，表头总在新页起排，保持长表跨页行为稳定
    if (y > inner.y + 0.01) newPage()
    table = {
      nodeId: node.id, widths,
      headerLines: node.header.map((h, c) => wrapText(h, widths[c] - CELL_PAD_X * 2, font, params.fontSize))
    }
    const hh = placeTableHeader(page(), false)
    y += hh
    const lineH = lineHeight(font, params.fontSize)

    node.rows.forEach((row, ri) => {
      const cellLines = row.map((cell, c) => wrapText(cell, widths[c] - CELL_PAD_X * 2, font, params.fontSize))
      const maxLines = Math.max(1, ...cellLines.map((a) => a.length))
      const naturalH = maxLines * lineH + CELL_PAD_Y * 2
      // 确定诊断：该行即便独占一整页也放不下 => 长单元格超页
      if (naturalH > inner.height + 0.01) {
        const tallest = cellLines.findIndex((a) => a.length === maxLines)
        issue({
          code: ISSUE_CODES.ROW_TOO_TALL, nodeId: node.id, seq: node.seq,
          page: pageNo, lineStart: node.lineStart, lineEnd: node.lineEnd,
          message: `第 ${ri + 1} 行存在长单元格：需 ${maxLines} 行高 ${Math.round(naturalH)}px，超过整页版心 ${Math.round(inner.height)}px`,
          detail: { rowIndex: ri, rowNumber: ri + 2, lines: maxLines, cellIndex: tallest, capacityPx: Math.round(inner.height) }
        })
      }
      // 逐行切分跨页：每一页都能至少容纳一个行带，进度单调，不会死循环
      let lineIdx = 0
      let guard = 0
      while (lineIdx < maxLines) {
        guard += 1
        if (guard > maxLines + 4) throw new Error('table pagination guard tripped')
        if (remaining() < lineH + CELL_PAD_Y * 2) newPage()
        const capacity = Math.max(1, Math.floor((remaining() - CELL_PAD_Y * 2) / lineH))
        const take = Math.min(capacity, maxLines - lineIdx)
        const segH = take * lineH + CELL_PAD_Y * 2
        const seg = {
          type: 'row-segment', nodeId: node.id, rowIndex: ri, rowNumber: ri + 2,
          start: lineIdx === 0, end: lineIdx + take === maxLines,
          x: inner.x + TABLE_INSET, y, width: inner.width - TABLE_INSET * 2, height: segH
        }
        box(seg)
        let cx = inner.x + TABLE_INSET
        const overflowCells = []
        for (let c = 0; c < cellLines.length; c++) {
          for (let li = lineIdx; li < lineIdx + take; li++) {
            const ln = cellLines[c][li]
            if (!ln) continue
            box({
              type: 'line', kind: 'td', nodeId: node.id, gid: null, rowIndex: ri,
              x: cx + CELL_PAD_X, y: y + CELL_PAD_Y + (li - lineIdx) * lineH,
              width: ln.width, boxWidth: widths[c] - CELL_PAD_X * 2, height: lineH,
              overflow: !!ln.overflow, missing: [...ln.missing], text: ln.text
            })
            if (ln.overflow) overflowCells.push(c)
          }
          cx += widths[c]
        }
        if (overflowCells.length) {
          seg.overflow = true
          seg.overflowCols = [...new Set(overflowCells)]
        }
        y += segH
        lineIdx += take
      }
    })
    table = null
    y += gap
  }

  function renderImage(node) {
    const info = images[node.src]
    if (!info || info.status !== 'ready') {
      throw new Error(`IMAGE_NOT_READY:${node.src}`)
    }
    let w = info.width
    let h = info.height
    if (w > inner.width) { h = h * (inner.width / w); w = inner.width }
    if (h > inner.height + 0.01) {
      // 超高图片：独占一页（溢出页边），给出确定诊断
      if (y > inner.y + 0.01) newPage()
      issue({
        code: ISSUE_CODES.IMAGE_TOO_TALL, nodeId: node.id, seq: node.seq,
        page: pageNo, lineStart: node.lineStart, lineEnd: node.lineEnd,
        message: `图片解码高度 ${Math.round(info.height)}px（缩放后 ${Math.round(h)}px）超过版心 ${Math.round(inner.height)}px`,
        detail: { src: node.src, decodedWidth: info.width, decodedHeight: info.height, scaledHeight: Math.round(h), capacityPx: Math.round(inner.height) }
      })
      box({ type: 'image', nodeId: node.id, imageTooTall: true, src: node.src, x: inner.x, y, width: w, height: inner.height, alt: node.alt })
      y = inner.y + inner.height
      newPage()
      return
    }
    ensureRoom(h)
    box({ type: 'image', nodeId: node.id, src: node.src, x: inner.x, y, width: w, height: h, alt: node.alt })
    y += h + gap
  }

  function renderHeading(node) {
    const em = params.fontSize * (HEADING_EM[node.level] || 1)
    const lines = wrapText(node.text, inner.width, font, em)
    placeLines(lines, { nodeId: node.id, kind: 'h', em, x: inner.x, width: inner.width })
    y += hgap
    pendingHeading = { nodeId: node.id, pageNo, bottom: y, lineStart: node.lineStart }
  }

  function renderParagraph(node) {
    const lines = wrapText(node.text, inner.width, font, params.fontSize)
    placeLines(lines, { nodeId: node.id, gid: node.id, kind: 'p', em: params.fontSize, x: inner.x, width: inner.width })
    y += gap
  }

  function renderQuote(node) {
    const w = inner.width - 36
    const lines = wrapText(node.text, w, font, params.fontSize)
    placeLines(lines, { nodeId: node.id, gid: node.id, kind: 'q', em: params.fontSize, x: inner.x + 36, width: w })
    y += gap
  }

  function renderCode(node) {
    const w = inner.width - 24
    const rawLines = node.text.split('\n')
    const all = []
    for (const raw of rawLines) all.push(...wrapText(raw || ' ', w, font, params.fontSize * 0.9))
    placeLines(all, { nodeId: node.id, kind: 'code', em: params.fontSize * 0.9, x: inner.x + 12, width: w })
    y += gap
  }

  function renderList(node) {
    const indent = 26
    const w = inner.width - indent
    node.items.forEach((item, idx) => {
      const lines = wrapText(item, w, font, params.fontSize)
      placeLines(lines, {
        nodeId: node.id, gid: `${node.id}#${idx}`, kind: node.ordered ? 'ol' : 'ul',
        em: params.fontSize, x: inner.x + indent, width: w,
        marker: node.ordered ? `${idx + 1}.` : '•', markerX: inner.x + 6
      })
      y += 4
    })
    y += gap - 4
  }

  function renderHr(node) {
    ensureRoom(12)
    box({ type: 'hr', nodeId: node.id, x: inner.x, y: y + 5, width: inner.width, height: 2 })
    y += 12 + gap
  }

  const RENDERERS = {
    heading: renderHeading, paragraph: renderParagraph, image: renderImage,
    table: renderTable, quote: renderQuote, code: renderCode, list: renderList, hr: renderHr
  }

  // 生成器：每排完一个节点让出一次（边排版边检查由此获得增量进度）
  function* run() {
    newPage()
    for (const node of nodes) {
      // 标题 keep-with-next：剩余空间不足两行，后续块整体去下一页
      if (pendingHeading && node.type !== 'heading') {
        const keepNeeded = baseLh * 2
        if (pendingHeading.pageNo === pageNo && remaining() < keepNeeded) {
          newPage()
        }
        pendingHeading = null
      }
      const beforePages = pages.length
      RENDERERS[node.type](node)
      yield { node, pagesAdded: pages.length - beforePages, pages: pages.length, total: nodes.length }
    }
  }

  return {
    inner,
    events,
    pages,
    run,
    drain() {
      const gen = run()
      let next = gen.next()
      while (!next.done) next = gen.next()
      return { pages, events }
    }
  }
}
