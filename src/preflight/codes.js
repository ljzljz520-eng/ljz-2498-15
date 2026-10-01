// 分页预检问题代码与严重级
export const SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning'
})

export const ISSUE_CODES = Object.freeze({
  MISSING_GLYPH: 'MISSING_GLYPH',                 // 无字形（正文使用了字体覆盖表之外的字符）
  IMAGE_TOO_TALL: 'IMAGE_TOO_TALL',               // 超高图片：解码高度超过可用版心
  TABLE_OVERFLOW: 'TABLE_OVERFLOW',               // 表格横向溢出
  ROW_TOO_TALL: 'ROW_TOO_TALL',                   // 长单元格：单行内容高度超过一整页（确定诊断）
  WIDOW_ORPHAN: 'WIDOW_ORPHAN',                   // 孤行：段落首行或末行单独落在页底/页顶
  HEADING_AT_BOTTOM: 'HEADING_AT_BOTTOM'          // 标题压底：标题与其后首段被分页拆散
})

// 扫描器级问题（资源/参数，不属于某个正文节点）
export const RUNNER_CODES = Object.freeze({
  RESOURCES_NOT_READY: 'RESOURCES_NOT_READY',     // 图片未解码 / 字体晚到
  PARAMS_INVALID: 'PARAMS_INVALID'                // 页面参数非法
})

const META = {
  [ISSUE_CODES.MISSING_GLYPH]: { severity: SEVERITY.ERROR, title: '无字形' },
  [ISSUE_CODES.IMAGE_TOO_TALL]: { severity: SEVERITY.ERROR, title: '超高图片' },
  [ISSUE_CODES.TABLE_OVERFLOW]: { severity: SEVERITY.ERROR, title: '表格横向溢出' },
  [ISSUE_CODES.ROW_TOO_TALL]: { severity: SEVERITY.ERROR, title: '长单元格超页' },
  [ISSUE_CODES.WIDOW_ORPHAN]: { severity: SEVERITY.WARNING, title: '孤行' },
  [ISSUE_CODES.HEADING_AT_BOTTOM]: { severity: SEVERITY.WARNING, title: '标题压底' },
  [ISSUE_CODES.RUNNER_CODES]: null
}

export function issueMeta(code) {
  return META[code] || { severity: SEVERITY.ERROR, title: code }
}

export const EXEMPTION_STATUS = Object.freeze({
  ACTIVE: 'active',                 // 指纹一致，豁免有效
  NEEDS_REVIEW: 'needs_review'      // 排版指纹漂移（重排/资源晚到/参数变更），需复核
})

export const SCAN_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  BLOCKED: 'blocked'
})
