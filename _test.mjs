import { parseDocument } from './src/preflight/parser.js'
import { fontDescriptor, isGlyphCovered } from './src/preflight/font.js'
import { normalizeParams } from './src/preflight/pages.js'
import { createEngine } from './src/preflight/engine.js'
import { analyze } from './src/preflight/analyzer.js'

function run(doc, images = {}, fontV = '1.0.0', params = normalizeParams({})) {
  const nodes = parseDocument(doc)
  const font = fontDescriptor(fontV)
  const engine = createEngine({ params, font, nodes, images })
  engine.drain()
  const res = analyze({ pages: engine.pages, events: engine.events }, { nodes, params, font })
  return { engine, res, nodes }
}

const f11 = fontDescriptor('1.1.0')
console.log('coverage v1.1.0:', ['§','😀','龘','𪚥','Ǡ'].map(c=>c+':'+isGlyphCovered(c,f11)).join(' '))
const f10 = fontDescriptor('1.0.0')
console.log('coverage v1.0.0:', ['§','😀','龘'].map(c=>c+':'+isGlyphCovered(c,f10)).join(' '))

// 孤行 + 标题压底：多段落
const para = '中文排版测试内容不断重复以填满每一行版心宽度确保能够稳定折行。'
const doc1 = Array.from({length:60},()=>para).join('\n\n') + '\n\n## 页底标题\n' + para
let { engine: e1, res: r1 } = run(doc1)
console.log('case1 pages', e1.pages.length)
r1.issues.forEach(i=>console.log(' ', i.code, 'p'+i.page, i.message.slice(0,50)))

// 缺字形
let { res: r2 } = run('这里有特殊符号 § 与表情 😀 和数学字母 𝕏。普通中文正常。', {}, '1.1.0')
r2.issues.forEach(i=>console.log(' case2', i.code, JSON.stringify(i.detail?.chars)))

// 表格横向溢出
const t3 = `| 名称 | 说明 |
|---|---|
| x | SupercalifragilisticexpialidociousUnbreakableVeryLongTokenXXXXXXXXXXXXX |
`
let { res: r3 } = run(t3)
r3.issues.forEach(i=>console.log(' case3', i.code, i.message.slice(0,50)))

// 长单元格超页
const longcell = '| A | B |\n|---|---|\n| x | ' + Array.from({length:900},()=>'长').join('') + ' |'
let { engine:e4, res: r4 } = run(longcell)
console.log(' case4 pages', e4.pages.length)
r4.issues.forEach(i=>console.log(' ', i.code, i.message.slice(0,70)))
// 普通长行跨页归属
const segs4 = e4.pages.flatMap(p=>p.boxes.filter(b=>b.type==='row-segment'))
console.log('  row segments per page:', e4.pages.map(p=>p.boxes.filter(b=>b.type==='row-segment').length), 'sameRow:', segs4.every(s=>s.rowIndex===0))
