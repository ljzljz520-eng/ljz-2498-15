// 正文规范化与内联文本工具

export function normalizeSource(source) {
  return String(source ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/g, '') + '\n'
}

// 去掉内联标记得到纯文本（排版只对纯文本做度量）
export function stripInline(text) {
  return String(text ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[*_~]/g, '')
    .replace(/\t/g, '    ')
    .trim()
}

// 32 位 FNV-1a
export function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
