// 扫描执行器：同一份排版输入分别走
//  A) 完整渲染再分析（drain 后 analyze）
//  B) 边排版边检查（生成器逐节点推进，可增量分析、可取消/续作）
// 两者共用 engine + analyzer，结论必须一致（compare 模式校验）。

import { createEngine } from './engine.js'
import { analyze, sameFindings } from './analyzer.js'
import { validateParams } from './pages.js'
import { pendingImages } from './resources.js'
import { RUNNER_CODES, SCAN_STATUS } from './codes.js'

const tick = (ms) => new Promise((r) => setTimeout(r, ms))

export function readinessCheck({ nodes, images, params, fontReady }) {
  const problems = []
  if (!fontReady) {
    problems.push({
      code: RUNNER_CODES.RESOURCES_NOT_READY, severity: 'error',
      message: `固定字体 ${'尚未就绪（字体晚到）'}，不能开始排版`,
      detail: { resource: 'font' }
    })
  }
  const pending = pendingImages(
    nodes.filter((n) => n.type === 'image').map((n) => ({ src: n.src })),
    images
  )
  if (pending.length) {
    problems.push({
      code: RUNNER_CODES.RESOURCES_NOT_READY, severity: 'error',
      message: `有 ${pending.length} 张图片尚未解码完成：${pending.map((p) => p.src).join('、')}（晚到会重排，禁止带占位尺寸预检）`,
      detail: { resource: 'image', pending: pending.map((p) => p.src) }
    })
  }
  const invalid = validateParams(params)
  if (invalid.length) {
    problems.push({ code: RUNNER_CODES.PARAMS_INVALID, severity: 'error', message: invalid.join('；'), detail: { invalid } })
  }
  return problems
}

function buildEngine(input) {
  return createEngine({ params: input.params, font: input.font, nodes: input.nodes, images: input.images })
}

// 完整渲染再分析
async function runFull(input, { token, onProgress, resumeFrom = 0 }) {
  const engine = buildEngine(input)
  const gen = engine.run()
  let processed = 0
  const t0 = performance.now()
  let next = gen.next()
  while (!next.done) {
    if (token.cancelled) break
    processed += 1
    if (processed > resumeFrom || true) {
      onProgress?.({ phase: 'layout', processed, total: input.nodes.length, pages: next.value.pages })
      await tick(16)
    }
    next = gen.next()
  }
  const layoutMs = performance.now() - t0
  const t1 = performance.now()
  const { issues, counts } = analyze({ pages: engine.pages, events: engine.events }, input)
  const analyzeMs = performance.now() - t1
  return {
    pages: engine.pages, issues, counts,
    timings: { layoutMs, analyzeMs },
    processed,
    cancelled: token.cancelled,
    intermediate: []
  }
}

// 边排版边检查：每个节点后做一次增量分析（中间计数），结论在结束时定稿
async function runStream(input, { token, onProgress, resumeFrom = 0 }) {
  const engine = buildEngine(input)
  const gen = engine.run()
  let processed = 0
  const intermediate = []
  const t0 = performance.now()
  let next = gen.next()
  while (!next.done) {
    if (token.cancelled) break
    processed += 1
    const mid = analyze({ pages: engine.pages, events: engine.events }, input)
    intermediate.push({ seq: next.value.node.seq, pages: engine.pages.length, issueCount: mid.issues.length })
    onProgress?.({ phase: 'layout', processed, total: input.nodes.length, pages: engine.pages.length, interimCounts: mid.counts })
    await tick(16)
    next = gen.next()
  }
  const layoutMs = performance.now() - t0
  const t1 = performance.now()
  const finalA = analyze({ pages: engine.pages, events: engine.events }, input)
  const analyzeMs = performance.now() - t1
  return {
    pages: engine.pages, issues: finalA.issues, counts: finalA.counts,
    timings: { layoutMs, analyzeMs },
    processed,
    cancelled: token.cancelled,
    intermediate
  }
}

export async function executeScan(input, mode, options = {}) {
  const { onProgress, resumeFrom = 0 } = options
  const token = options.token || { cancelled: false }

  if (mode === 'render-first') {
    return { mode, ...(await runFull(input, { token, onProgress, resumeFrom })) }
  }
  if (mode === 'stream') {
    return { mode, ...(await runStream(input, { token, onProgress, resumeFrom })) }
  }
  if (mode === 'compare') {
    // 两条路径各跑一遍并比对（顺序执行，同一输入）
    const full = await runFull(input, { token: { cancelled: token.cancelled }, onProgress: (p) => onProgress?.({ ...p, lane: 'render-first' }) })
    if (token.cancelled) return { mode, ...full, compare: null, cancelled: true }
    const stream = await runStream(input, { token, onProgress: (p) => onProgress?.({ ...p, lane: 'stream' }) })
    const equal = sameFindings(full.issues, stream.issues)
    return {
      mode: 'compare',
      pages: stream.pages, issues: stream.issues, counts: stream.counts,
      timings: { fullMs: full.timings.layoutMs + full.timings.analyzeMs, streamMs: stream.timings.layoutMs + stream.timings.analyzeMs },
      cancelled: token.cancelled,
      compare: { equal, fullCount: full.issues.length, streamCount: stream.issues.length },
      processed: stream.processed
    }
  }
  throw new Error(`unknown mode ${mode}`)
}

export function verdictOf(issues, activeExemptionKeys) {
  const remaining = issues.filter((i) => !activeExemptionKeys.has(`${i.code}|${i.nodeId}`))
  const errors = remaining.filter((i) => i.severity === 'error')
  const warnings = remaining.filter((i) => i.severity === 'warning')
  return {
    pass: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    exemptedCount: issues.length - remaining.length
  }
}

export { SCAN_STATUS }
