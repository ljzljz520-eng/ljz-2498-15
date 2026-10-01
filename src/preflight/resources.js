// 资源清单：图片真实尺寸只在"解码完成"后确定；未就绪前扫描必须阻断，
// 因为晚到的尺寸会改变布局（图片解码导致重排）。

import { normalizeSource } from './text.js'

export function collectImageRefs(nodes, source) {
  const refs = []
  for (const n of nodes) {
    if (n.type === 'image') {
      refs.push({ src: n.src, alt: n.alt, declaredWidth: n.declaredWidth, declaredHeight: n.declaredHeight })
    }
  }
  // 正文之外的声明（测试夹具用）：<!-- @image key WxH -->
  const re = /<!--\s*@image\s+(\S+)\s+(\d+)x(\d+)\s*-->/g
  let m
  while ((m = re.exec(normalizeSource(source))) !== null) {
    if (!refs.some((r) => r.src === m[1])) refs.push({ src: m[1], alt: '', declaredWidth: Number(m[2]), declaredHeight: Number(m[3]) })
  }
  return refs
}

// images: Record<src, {status:'pending'|'ready'|'error', width, height, decodedAt}>
export function imageStatus(images, src) {
  return images[src] || { status: 'pending' }
}

export function pendingImages(refs, images) {
  return refs.filter((r) => (images[r.src]?.status || 'pending') !== 'ready')
}

// 把正文引用与已解码清单合成为"本次排版实际使用"的资源维度
export function resolvedImages(nodes, images) {
  const out = {}
  for (const n of nodes) {
    if (n.type !== 'image') continue
    const info = images[n.src]
    if (info && info.status === 'ready') {
      out[n.src] = { width: info.width, height: info.height }
    }
  }
  return out
}
