// 产物：完成快照（唯一允许下载的成品）、最终 PDF（与预检同源排版）、诊断包（失败/取消保留）。
// 快照是自描述的：保存完整冻结输入 + 分页结果，打印/PDF 视图从快照重建，杜绝二次排版差异。

import { fontDescriptor } from './font.js'

export function buildArtifact({ documentId, scanId, version, fingerprint, bodyHash, input, pages, issues, mode }) {
  const payload = {
    kind: 'preflight-snapshot',
    documentId,
    scanId,
    version,
    sealedAt: new Date().toISOString(),
    fingerprint,
    bodyHash,
    engine: {
      fixedFont: { family: input.font.family, version: input.font.version },
      params: input.params
    },
    mode,
    pageCount: pages.length,
    pages,
    issues,
    images: input.images || {}
  }
  return {
    documentId, scanId, version, kind: 'snapshot',
    fingerprint, bodyHash,
    storageKey: `artifacts/${documentId}/snapshot-v${version}.json`,
    pageCount: pages.length,
    payload
  }
}

export function buildDiagnostic(documentId, scanId, fingerprint, bodyHash, scan) {
  const payload = {
    kind: 'preflight-diagnostic',
    documentId, scanId,
    retainedAt: new Date().toISOString(),
    fingerprint, bodyHash,
    status: scan.status,
    mode: scan.mode,
    params: scan.params || null,
    checkpoint: scan.checkpoint || null,
    progress: scan.progress || null,
    invalidatedBy: scan.invalidatedBy || null,
    error: scan.error || null,
    partialPages: scan.partialPages || null,
    pages: scan.pages ? { count: scan.pages.length } : null
  }
  return {
    documentId, scanId, version: 0, kind: 'diagnostic',
    fingerprint, bodyHash,
    storageKey: `artifacts/${documentId}/diagnostic-${scanId}.json`,
    pageCount: scan.pages?.length || null,
    payload
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.split('/').pop()
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 从完成快照取渲染 PDF 所需的全部输入 —— 不重新排版，只重放同一分页结果。
export function snapshotForPdf(artifact) {
  const p = artifact.payload
  return {
    pages: p.pages,
    params: p.engine.params,
    font: fontDescriptor(p.engine.fixedFont.version),
    fingerprint: p.fingerprint,
    bodyHash: p.bodyHash
  }
}
