// 排版指纹：决定豁免能否复用。
// 仅同一正文哈希不足以复用结论 —— 页面参数、字体版本/度量、图片解码尺寸任一变化即重排。

import { hash32, normalizeSource } from './text.js'
import { resolvedImages } from './resources.js'

export function bodyHash(source) {
  return hash32(normalizeSource(source))
}

export function fontMetricsSignature(font) {
  return `${font.family}@${font.version}:${font.ascent}/${font.descent}/${font.cjkAdvance}/${font.latinAdvance}/${font.spaceAdvance}`
}

// 规范序列化：键序固定，避免对象遍历顺序差异
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
}

export function typesetFingerprint({ source, params, font, nodes, images }) {
  const body = bodyHash(source)
  const fontSig = fontMetricsSignature(font)
  const imgs = resolvedImages(nodes || [], images || {})
  const payload = {
    body,
    params,
    fontSig,
    images: imgs
  }
  return {
    body,
    fontSig,
    digest: hash32(stable(payload)),
    parts: { body, params: hash32(stable(params)), fontSig: hash32(fontSig), images: hash32(stable(imgs)) }
  }
}

// 豁免记录复核判定
export function exemptionState(exemption, currentFp) {
  if (!exemption) return null
  if (exemption.fingerprint === currentFp.digest) return 'active'
  return 'needs_review'
}
