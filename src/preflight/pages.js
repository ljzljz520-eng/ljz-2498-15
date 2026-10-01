// 固定页面参数。预检与最终 PDF 必须引用同一份参数对象（冻结），改边距即新排版。

export const PAGE_PRESETS = Object.freeze({
  A4: { width: 794, height: 1123 },
  Letter: { width: 816, height: 1056 }
})

export const DEFAULT_PARAMS = Object.freeze({
  preset: 'A4',
  width: 794,
  height: 1123,
  marginTop: 96,
  marginBottom: 96,
  marginLeft: 96,
  marginRight: 96,
  fontSize: 16,
  paragraphGap: 12,
  headingGap: 14
})

export function normalizeParams(input = {}) {
  const base = input && input.preset && PAGE_PRESETS[input.preset] ? input : { ...input, ...(PAGE_PRESETS[input.preset] || {}) }
  const preset = PAGE_PRESETS[input.preset]
  return {
    preset: input.preset || DEFAULT_PARAMS.preset,
    width: Number(input.width ?? preset?.width ?? DEFAULT_PARAMS.width),
    height: Number(input.height ?? preset?.height ?? DEFAULT_PARAMS.height),
    marginTop: Number(input.marginTop ?? DEFAULT_PARAMS.marginTop),
    marginBottom: Number(input.marginBottom ?? DEFAULT_PARAMS.marginBottom),
    marginLeft: Number(input.marginLeft ?? DEFAULT_PARAMS.marginLeft),
    marginRight: Number(input.marginRight ?? DEFAULT_PARAMS.marginRight),
    fontSize: Number(input.fontSize ?? DEFAULT_PARAMS.fontSize),
    paragraphGap: Number(input.paragraphGap ?? DEFAULT_PARAMS.paragraphGap),
    headingGap: Number(input.headingGap ?? DEFAULT_PARAMS.headingGap)
  }
}

export function validateParams(p) {
  const problems = []
  const mustBePositive = ['width', 'height', 'fontSize']
  for (const key of mustBePositive) {
    if (!Number.isFinite(p[key]) || p[key] <= 0) problems.push(`${key} 必须为正数`)
  }
  for (const key of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight']) {
    if (!Number.isFinite(p[key]) || p[key] < 0) problems.push(`${key} 不能为负`)
  }
  const innerW = p.width - p.marginLeft - p.marginRight
  const innerH = p.height - p.marginTop - p.marginBottom
  if (innerW <= 24) problems.push('左右边距过大，版心宽度不足')
  if (innerH <= 48) problems.push('上下边距过大，版心高度不足')
  return problems
}

export function contentBox(p) {
  return {
    x: p.marginLeft,
    y: p.marginTop,
    width: Math.round((p.width - p.marginLeft - p.marginRight) * 100) / 100,
    height: Math.round((p.height - p.marginTop - p.marginBottom) * 100) / 100
  }
}
