// 浏览器端仓储：接口形状与后端 PG 仓储一致（全部 async），localStorage 持久化。
// 真正部署时把同接口替换为 fetch 到渲染/持久化服务即可。

const KEY = 'catalpa.preflight.v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) { /* 忽略损坏数据 */ }
  return { issues: [], exemptions: [], scans: [], artifacts: [], seq: { issue: 0, exemption: 0, artifact: 0 } }
}

let db = load()

async function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)) } catch (_) { /* 配额满时保留内存态 */ }
}

export const repo = {
  // ---- 扫描任务（断点续作）----
  async upsertScan(scan) {
    const i = db.scans.findIndex((s) => s.id === scan.id)
    const row = { ...scan, updatedAt: new Date().toISOString() }
    if (i >= 0) db.scans[i] = { ...db.scans[i], ...row }
    else db.scans.push({ createdAt: new Date().toISOString(), ...row })
    await save()
    return row
  },
  async getScan(id) { return db.scans.find((s) => s.id === id) || null },
  async listScans(documentId) {
    return db.scans.filter((s) => s.documentId === documentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },
  async deleteScan(id) {
    db.scans = db.scans.filter((s) => s.id !== id)
    await save()
  },

  // ---- 问题 ----
  async replaceScanIssues(documentId, scanId, issues) {
    db.issues = db.issues.filter((x) => x.scanId !== scanId)
    for (const it of issues) {
      db.seq.issue += 1
      db.issues.push({ pk: db.seq.issue, documentId, scanId, status: 'open', ...it })
    }
    await save()
  },
  async listIssues(documentId) { return db.issues.filter((x) => x.documentId === documentId) },

  // ---- 豁免 ----
  async listExemptions(documentId) { return db.exemptions.filter((x) => x.documentId === documentId) },
  async putExemption(e) {
    const i = db.exemptions.findIndex((x) => x.documentId === e.documentId && x.code === e.code && x.nodeId === e.nodeId)
    if (i >= 0) {
      db.exemptions[i] = { ...db.exemptions[i], ...e, updatedAt: new Date().toISOString() }
    } else {
      db.seq.exemption += 1
      db.exemptions.push({ pk: db.seq.exemption, createdAt: new Date().toISOString(), ...e })
    }
    await save()
  },
  async removeExemption(documentId, code, nodeId) {
    db.exemptions = db.exemptions.filter((x) => !(x.documentId === documentId && x.code === code && x.nodeId === nodeId))
    await save()
  },

  // ---- 产物版本（下载仅指向 sealed 完成快照）----
  async nextArtifactVersion(documentId) {
    const versions = db.artifacts.filter((a) => a.documentId === documentId).map((a) => a.version)
    return (versions.length ? Math.max(...versions) : 0) + 1
  },
  async addArtifact(a) {
    db.seq.artifact += 1
    const row = { pk: db.seq.artifact, createdAt: new Date().toISOString(), status: 'sealed', ...a }
    db.artifacts.push(row)
    await save()
    return row
  },
  async listArtifacts(documentId) {
    return db.artifacts.filter((a) => a.documentId === documentId).sort((a, b) => b.version - a.version)
  },
  async getArtifact(pk) { return db.artifacts.find((a) => a.pk === pk) || null },
  async supersedeArtifacts(documentId, kind) {
    for (const a of db.artifacts) {
      if (a.documentId === documentId && a.kind === kind && a.status === 'sealed') a.status = 'superseded'
    }
    await save()
  },
  // 诊断包失败后保留（status=retained），草稿不受影响
  async retainDiagnostic(a) {
    db.seq.artifact += 1
    const row = { pk: db.seq.artifact, createdAt: new Date().toISOString(), status: 'retained', ...a }
    db.artifacts.push(row)
    await save()
    return row
  },
  async resetAll() {
    db = { issues: [], exemptions: [], scans: [], artifacts: [], seq: { issue: 0, exemption: 0, artifact: 0 } }
    await save()
  }
}
