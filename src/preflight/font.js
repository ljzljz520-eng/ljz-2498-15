// 固定字体：渲染服务不依赖系统字体，所有度量来自这里的固定描述符。
// 字体"晚到"只能改变 ready 状态；一旦替换度量（version 变化）排版必然变化，旧豁免需复核。

export const FONT = Object.freeze({
  family: 'CatalpaSerifFixed',
  // 两个版本度量不同：模拟渲染服务端字体晚到后换成真实度量文件，触发重排
  versions: {
    '1.0.0': {
      ascent: 0.85,
      descent: 0.22,
      cjkAdvance: 1.0,        // 全角字符占 em 的倍数
      latinAdvance: 0.52,
      spaceAdvance: 0.28,
      // 覆盖表之外的字符即"无字形"
      coverage: {
        ascii: true,
        hiragana: true,
        katakana: true,
        cjk: true,
        punctuation: true,
        extra: '“”‘’—…·、。，！？；：（）《》【】〈〉「」『』〜￥％＃＆＊＋－／＜＝＞＠＼＾＿｜￠￡§←↑→↓★☆○●◎◇◆□■△▲▽▼'
      }
    },
    '1.1.0': {
      ascent: 0.88,
      descent: 0.24,
      cjkAdvance: 1.04,
      latinAdvance: 0.55,
      spaceAdvance: 0.3,
      coverage: {
        ascii: true,
        hiragana: true,
        katakana: true,
        cjk: true,
        punctuation: true,
        // v1.1.0 覆盖表缩减：部分符号与生僻字变为无字形
        extra: '“”‘’—…·、。，！？；：（）《》【】〈〉「」『』'
      }
    }
  }
})

export function fontDescriptor(version) {
  const v = FONT.versions[version]
  if (!v) throw new Error(`未知字体版本: ${version}`)
  return { family: FONT.family, version, ...v }
}

export function isGlyphCovered(ch, font) {
  const code = ch.codePointAt(0)
  // 控制字符与空白不参与字形检查
  if (/\s/.test(ch)) return true
  const cov = font.coverage
  if (cov.ascii && code < 0x80) return true
  if (cov.cjk && code >= 0x4e00 && code <= 0x9fff) return true
  if (cov.hiragana && code >= 0x3040 && code <= 0x309f) return true
  if (cov.katakana && code >= 0x30a0 && code <= 0x30ff) return true
  if (cov.cjk && ((code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff))) {
    return true
  }
  if (cov.extra.includes(ch)) return true
  return false
}

function isFullwidth(ch) {
  const code = ch.codePointAt(0)
  if (code >= 0x1100 && code <= 0x115f) return true
  if (code >= 0x2e80 && code <= 0xa4cf) return true
  if (code >= 0xac00 && code <= 0xd7a3) return true
  if (code >= 0xf900 && code <= 0xfaff) return true
  if (code >= 0xff00 && code <= 0xffef) return true
  // 全角标点表
  return '“”‘’—…·、。，！？；：（）《》【】〈〉「」『』〜￥'.includes(ch)
}

// 字符前进宽度（px）。em = fontSize
export function charWidth(ch, font, em) {
  if (ch === '\t') return font.spaceAdvance * em * 4
  if (ch === ' ') return font.spaceAdvance * em
  if (isFullwidth(ch)) return font.cjkAdvance * em
  return font.latinAdvance * em
}

export function lineHeight(font, fontSize) {
  return Math.round((font.ascent + font.descent) * fontSize * 100) / 100
}
