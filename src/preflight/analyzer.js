// 分页结果分析。完整渲染再分析 与 边排版边检查 最终都调用本模块，保证结论一致；
// stream 模式只是在每个排版节点后拿到中间计数。

import { ISSUE_CODES } from './codes.js'
import { contentBox } from './pages.js'
import { lineHeight } from './font.js'

// 对（可能是部分的）分页结果做分析；同输入结果可复现。
export function analyze(result, ctx) {
  const { pages, events } = result
  const { nodes, params, font } = ctx
  const inner = contentBox(params)
  const baseLh = lineHeight(font, params.fontSize)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const byKey = new Map()

  function record(p) {
    const key = p.dedupKey
    if (!byKey.has(key)) byKey.set(key, { ...p })
  }

  // 1) 排版过程中的确定性诊断（表格横向溢出、长单元格超页、超高图片）
  for (const ev of events) {
    if (ev.type === 'issue') record(ev.issue)
  }

  // 行带溢出（单元格内单词超宽）并入表格横向溢出
  const overflowNodes = new Map()
  const missingByNode = new Map()

  for (const pg of pages) {
    for (const b of pg.boxes) {
      if (b.type !== 'line') continue
      if (b.overflow) {
        if ((b.kind === 'td' || b.kind === 'th') && b.nodeId) {
          const set = overflowNodes.get(b.nodeId) || new Set()
          set.add(b.text)
          overflowNodes.set(b.nodeId, set)
        }
      }
      if (b.missing && b.missing.length) {
        const set = missingByNode.get(b.nodeId) || new Set()
        b.missing.forEach((c) => set.add(c))
        missingByNode.set(b.nodeId, set)
      }
    }
  }

  for (const [nodeId, samples] of overflowNodes) {
    const node = nodeMap.get(nodeId)
    record({
      code: ISSUE_CODES.TABLE_OVERFLOW, nodeId, seq: node?.seq ?? 0,
      page: pages[0]?.pageNo ?? 1,
      lineStart: node?.lineStart ?? 1, lineEnd: node?.lineEnd ?? 1,
      message: `表格单元格存在不可折行的超长内容（示例：${[...samples].slice(0, 3).join(' / ')}）`,
      detail: { overflowSamples: [...samples].slice(0, 5) },
      dedupKey: `${ISSUE_CODES.TABLE_OVERFLOW}|${nodeId}|cell`
    })
  }

  // 2) 无字形：按节点聚合，给出具体字符与定位
  for (const [nodeId, chars] of missingByNode) {
    const node = nodeMap.get(nodeId)
    const sample = [...chars].slice(0, 8).join(' ')
    record({
      code: ISSUE_CODES.MISSING_GLYPH, nodeId, seq: node?.seq ?? 0,
      page: firstPageOf(pages, nodeId),
      lineStart: node?.lineStart ?? 1, lineEnd: node?.lineEnd ?? 1,
      message: `${node?.type === 'table' ? '表格' : '正文'}中存在 ${chars.size} 个字体未覆盖字符：${sample}`,
      detail: { chars: [...chars], fontVersion: font.version },
      dedupKey: `${ISSUE_CODES.MISSING_GLYPH}|${nodeId}`
    })
  }

  // 3) 孤行：同一段落（gid）>=2 行却跨页
  const groups = new Map()
  for (const pg of pages) {
    for (const b of pg.boxes) {
      if (b.type !== 'line' || !b.gid) continue
      const g = groups.get(b.gid) || { nodeId: b.nodeId, groupLines: b.groupLines, pages: new Set(), firstLinePage: pg.pageNo }
      g.pages.add(pg.pageNo)
      groups.set(b.gid, g)
    }
  }
  for (const [gid, g] of groups) {
    if (g.groupLines < 2 || g.pages.size < 2) continue
    const node = nodeMap.get(g.nodeId)
    record({
      code: ISSUE_CODES.WIDOW_ORPHAN, nodeId: g.nodeId, seq: node?.seq ?? 0,
      page: Math.min(...g.pages),
      lineStart: node?.lineStart ?? 1, lineEnd: node?.lineEnd ?? 1,
      message: `段落共 ${g.groupLines} 行却被分到 ${g.pages.size} 页（页 ${[...g.pages].join('、')}），出现孤行`,
      detail: { group: gid, groupLines: g.groupLines, pages: [...g.pages] },
      dedupKey: `${ISSUE_CODES.WIDOW_ORPHAN}|${gid}`
    })
  }

  // 4) 标题压底：标题末行距页底不足两行（keep-with-next 已把后续内容推到下一页）
  for (const node of nodes.filter((n) => n.type === 'heading')) {
    let last = null
    for (const pg of pages) {
      for (const b of pg.boxes) {
        if (b.type === 'line' && b.nodeId === node.id && b.kind === 'h') last = b
      }
    }
    if (!last) continue
    const bottomGap = inner.y + inner.height - (last.y + last.height)
    if (bottomGap < baseLh * 2 - 0.01) {
      record({
        code: ISSUE_CODES.HEADING_AT_BOTTOM, nodeId: node.id, seq: node.seq,
        page: last.pageNo,
        lineStart: node.lineStart, lineEnd: node.lineEnd,
        message: `标题落在第 ${last.pageNo} 页底部（距页底 ${Math.round(bottomGap)}px < 两行 ${Math.round(baseLh * 2)}px），与下文被分页拆散`,
        detail: { bottomGap: Math.round(bottomGap), threshold: Math.round(baseLh * 2) },
        dedupKey: `${ISSUE_CODES.HEADING_AT_BOTTOM}|${node.id}|${last.pageNo}`
      })
    }
  }

  const issues = [...byKey.values()].sort((a, b) =>
    (a.seq - b.seq) || (a.page - b.page) || (a.lineStart - b.lineStart) || a.code.localeCompare(b.code)
  )
  return { issues, counts: countByCode(issues) }
}

function firstPageOf(pages, nodeId) {
  for (const pg of pages) {
    if (pg.boxes.some((b) => b.nodeId === nodeId)) return pg.pageNo
  }
  return pages[0]?.pageNo ?? 1
}

function countByCode(issues) {
  const c = {}
  for (const i of issues) c[i.code] = (c[i.code] || 0) + 1
  return c
}

// 结论一致性校验：两种模式得到的问题集合（按 dedupKey+code+定位）必须相同
export function sameFindings(a, b) {
  const ka = new Set(a.map((i) => i.dedupKey).sort())
  const kb = new Set(b.map((i) => i.dedupKey).sort())
  if (ka.size !== kb.size) return false
  for (const k of ka) if (!kb.has(k)) return false
  return true
}
