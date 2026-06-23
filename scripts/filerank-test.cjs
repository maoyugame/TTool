// fileRank.ts 的确定性单测：用 typescript 转译真实源码后运行，锁死相关性排序规则。
const ts = require('typescript')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'store', 'fileRank.ts'), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText
const mod = { exports: {} }
new Function('exports', 'require', 'module', js)(mod.exports, require, mod)
const { rankFiles } = mod.exports

let pass = true
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) pass = false }
const F = (p) => ({ path: p, name: p.replace(/.*[\\/]/, '') })
const order = (hits, q) => rankFiles(hits, q, 50).map((h) => h.name)
const before = (arr, a, b) => arr.indexOf(a) >= 0 && (arr.indexOf(b) < 0 || arr.indexOf(a) < arr.indexOf(b))

// 1) 完全匹配 > 词边界 > 中部包含
{
  const r = order([F('D:\\docs\\annual-report-2024.docx'), F('D:\\docs\\report.docx'), F('D:\\docs\\xreportx-final-v2.docx')], 'report')
  check('完全匹配 report.docx 第一', r[0] === 'report.docx')
  check('词边界 annual-report 胜过 中部 xreportx', before(r, 'annual-report-2024.docx', 'xreportx-final-v2.docx'))
}

// 2) 前缀匹配 > 中部包含
{
  const r = order([F('D:\\a\\mydata-config.json'), F('D:\\a\\config.json')], 'config')
  check('前缀 config.json 胜过 中部 mydata-config.json', before(r, 'config.json', 'mydata-config.json'))
}

// 3) 噪音目录(node_modules/Windows)大幅降权
{
  const r = order([F('C:\\proj\\node_modules\\lib\\report.js'), F('D:\\work\\report.js')], 'report')
  check('正常目录 report.js 胜过 node_modules 里的', r[0] === 'report.js' && r[0] === 'report.js' && rankFiles([F('C:\\proj\\node_modules\\lib\\report.js'), F('D:\\work\\report.js')], 'report', 50)[0].path === 'D:\\work\\report.js')
}
{
  const win = F('C:\\Windows\\System32\\setup.exe')
  const usr = F('D:\\downloads\\setup.exe')
  const r = rankFiles([win, usr], 'setup', 50)
  check('Windows\\System32 降权，用户目录 setup.exe 在前', r[0].path === 'D:\\downloads\\setup.exe')
}

// 4) 覆盖率：查询占文件名比例越大越靠前
{
  const r = order([F('D:\\x\\changelog-2024-final.txt'), F('D:\\x\\log.txt')], 'log')
  check('短名 log.txt 胜过 长名 changelog-...', before(r, 'log.txt', 'changelog-2024-final.txt'))
}

// 5) 仅路径命中(文件名不含查询)垫底
{
  const r = order([F('D:\\report\\notes.txt'), F('D:\\misc\\report.txt')], 'report')
  check('文件名含 report 的 report.txt 胜过 仅路径含 report 的 notes.txt', before(r, 'report.txt', 'notes.txt'))
}

// 6) limit 截断生效
{
  const many = Array.from({ length: 30 }, (_, i) => F('D:\\d\\report' + i + '.txt'))
  check('limit=8 截断', rankFiles(many, 'report', 8).length === 8)
}

console.log(pass ? 'FILERANK TEST PASS' : 'FILERANK TEST FAIL')
process.exit(pass ? 0 : 1)
