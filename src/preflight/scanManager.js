// 任务管理：创建 / 取消 / 断点续作 / 扫描中输入失效 / 产物封存 / 诊断包保留。
import { repo } from './persist/browserRepo.js'
import { executeScan, readinessCheck } from './runner.js'
import { SCAN_STATUS } from './codes.js'
import { typesetFingerprint, exemptionState } from './fingerprint.js'
import { buildArtifact, buildDiagnostic, downloadJson } from './artifacts.js'

const uid = () => `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export class ScanManager {
  constructor({ documentId, getInput, onUpdate }) {
    this.documentId = documentId
    this.getInput = getInput            // () => 当前实时排版输入
    this.onUpdate = onUpdate || (() => {})
    this.current = null
    this.token = null
    this.baselineFp = null              // 任务启动时的排版指纹（用于"扫描中改边距"失效判定）
  }

  snapshotInput() {
    const input = this.getInput()
    return {
      ...input,
      fingerprint: typesetFingerprint(input)
    }
  }

  async start({ mode = 'compare', resumeId = null } = {}) {
    // 续作
    if (resumeId) {
      const saved = await repo.getScan(resumeId)
      if (!saved) throw new Error('断点不存在')
      return this._resume(saved)
    }

    const live = this.snapshotInput()
    const blockers = readinessCheck({
      nodes: live.nodes, images: live.images, params: live.params, fontReady: live.fontReady
    })
    if (blockers.length) {
      const scan = await this._persist({
        id: uid(), mode, status: SCAN_STATUS.BLOCKED,
        fingerprint: live.fingerprint.digest, bodyHash: live.fingerprint.body,
        progress: { processed: 0, total: live.nodes.length },
        error: { blockers }, result: null
      })
      await repo.retainDiagnostic(buildDiagnostic(this.documentId, scan.id, scan.fingerprint, scan.bodyHash, scan))
      this.current = scan
      this.onUpdate(scan)
      return scan
    }

    this.baselineFp = live.fingerprint.digest
    const scan = await this._persist({
      id: uid(), mode, status: SCAN_STATUS.RUNNING,
      fingerprint: live.fingerprint.digest, bodyHash: live.fingerprint.body,
      params: live.params, fontVersion: live.font.version,
      progress: { processed: 0, total: live.nodes.length },
      frozenInput: stripPages(live),
      result: null, error: null
    })
    this.token = { cancelled: false }
    this.current = scan
    this.onUpdate(scan)
    this._run(live, scan, 0)
    return scan
  }

  async _run(input, scan, resumeFrom) {
    const self = this
    try {
      const result = await executeScan(input, scan.mode, {
        token: this.token,
        resumeFrom,
        onProgress(p) {
          // 用户在扫描中改边距/字体/图片尺寸 => 实时指纹漂移 => 任务立即失效
          const liveFp = self.snapshotInput().fingerprint.digest
          if (liveFp !== self.baselineFp && !self.token.cancelled) {
            self.token.cancelled = true
            self.invalidated = true
          }
          self._patch(scan.id, { progress: { ...p, phase: p.phase } })
        }
      })

      if (this.token?.cancelled) {
        const status = this.invalidated ? SCAN_STATUS.CANCELLED : SCAN_STATUS.CANCELLED
        const checkpoint = { processed: result.processed, pages: result.pages.length }
        const updated = await this._patch(scan.id, {
          status,
          checkpoint,
          partialPages: result.pages,
          invalidatedBy: this.invalidated ? 'typeset-input-changed' : null,
          error: this.invalidated ? { reason: '排版输入在扫描期间变化（边距/字体/图片），旧结论作废，请重试' } : null
        })
        await repo.retainDiagnostic(buildDiagnostic(this.documentId, scan.id, updated.fingerprint, updated.bodyHash, updated))
        return
      }

      // 结论必须基于"冻结输入"。完成时再核对一次实时输入是否仍一致。
      const liveFp = this.snapshotInput().fingerprint.digest
      if (liveFp !== this.baselineFp) {
        const updated = await this._patch(scan.id, {
          status: SCAN_STATUS.CANCELLED, checkpoint: { processed: result.processed },
          invalidatedBy: 'typeset-input-changed',
          error: { reason: '排版输入在扫描完成前变化，旧结论作废' }
        })
        await repo.retainDiagnostic(buildDiagnostic(this.documentId, scan.id, updated.fingerprint, updated.bodyHash, updated))
        return
      }

      await repo.replaceScanIssues(this.documentId, scan.id, result.issues)
      const updated = await this._patch(scan.id, {
        status: SCAN_STATUS.COMPLETED,
        result: { issues: result.issues, counts: result.counts, timings: result.timings, compare: result.compare || null },
        pages: result.pages
      })

      // 只有完成态才封存产物快照；下载只指向它
      const version = await repo.nextArtifactVersion(this.documentId)
      const artifact = buildArtifact({
        documentId: this.documentId, scanId: scan.id, version,
        fingerprint: updated.fingerprint, bodyHash: updated.bodyHash,
        input, pages: result.pages, issues: result.issues, mode: scan.mode
      })
      await repo.supersedeArtifacts(this.documentId, 'snapshot')
      await repo.addArtifact(artifact)
      this._patch(scan.id, { artifactPk: artifact.pk })
      this.onUpdate(await repo.getScan(scan.id))
    } catch (err) {
      const updated = await this._patch(scan.id, { status: SCAN_STATUS.FAILED, error: { message: err.message, stack: err.stack } })
      await repo.retainDiagnostic(buildDiagnostic(this.documentId, scan.id, updated.fingerprint, updated.bodyHash, updated))
      this.onUpdate(updated)
    }
  }

  async _resume(saved) {
    if (![SCAN_STATUS.CANCELLED, SCAN_STATUS.FAILED].includes(saved.status)) return saved
    // 续作时校验断点输入与当前输入一致，否则拒绝续作（避免用旧断点+新输入）
    const liveFp = this.snapshotInput().fingerprint.digest
    if (liveFp !== saved.fingerprint) {
      const updated = await this._patch(saved.id, {
        status: SCAN_STATUS.FAILED,
        error: { reason: '断点对应的排版输入已变化（正文/边距/字体/图片），不能续作，请重新扫描' }
      })
      await repo.retainDiagnostic(buildDiagnostic(this.documentId, updated.fingerprint, updated.bodyHash, updated))
      return updated
    }
    // 若上次是被资源未就绪阻断，资源到位后也允许"重试"为全新扫描
    if (!saved.frozenInput) return this.start({ mode: saved.mode })
    const from = saved.checkpoint?.processed || 0
    const updated = await this._patch(saved.id, { status: SCAN_STATUS.RUNNING, error: null, invalidatedBy: null })
    this.current = updated
    this.baselineFp = saved.fingerprint
    this.token = { cancelled: false }
    this.invalidated = false
    this.onUpdate(updated)
    // 确定性续作：上面已校验实时指纹 == 断点指纹，故实时输入与冻结输入排版等价；
    // 从头重放（结果可复现）并记录断点进度，随后任务正常收尾。
    this._run(this.snapshotInput(), updated, from)
    return updated
  }

  async cancel() {
    if (this.token) this.token.cancelled = true
  }

  async _persist(scan) {
    await repo.upsertScan(scan)
    this.current = scan
    this.onUpdate(scan)
    return scan
  }
  async _patch(id, patch) {
    const cur = await repo.getScan(id)
    const next = { ...cur, ...patch }
    await repo.upsertScan(next)
    this.current = next
    this.onUpdate(next)
    return next
  }
}

function stripPages(input) {
  // 冻结输入：不含图片二进制，只含确定排版所需维度
  return {
    source: input.source, params: input.params,
    fontVersion: input.font.version,
    images: Object.fromEntries(Object.entries(input.images || {}).map(([k, v]) => [k, { ...v }]))
  }
}

// 豁免注解：active / needs_review
export async function annotateExemptions(documentId, issues, fingerprint, nodes, font) {
  const exemptions = await repo.listExemptions(documentId)
  return issues.map((issue) => {
    const ex = exemptions.find((e) => e.code === issue.code && e.nodeId === issue.nodeId)
    if (!ex) return { ...issue, exempt: false }
    const state = exemptionState(ex, fingerprint)
    return { ...issue, exempt: state === 'active', exemptionState: state, exemptionReason: ex.reason }
  })
}

export function downloadDiagnostic(scan) {
  const diag = buildDiagnostic(scan.documentId, scan.id, scan.fingerprint, scan.bodyHash, scan)
  downloadJson(diag.storageKey, diag.payload)
}
