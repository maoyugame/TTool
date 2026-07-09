import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import * as ts from 'typescript'

const sourceUrl = new URL('../src/tools/impl/screenshotPinGeometry.ts', import.meta.url)
const source = await readFile(sourceUrl, 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
})

const geometry = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const { normalizeRectLike, rectFromPoints, shapeFromDrag } = geometry

assert.deepEqual(
  rectFromPoints({ x: 10, y: 20 }, { x: 60, y: 90 }),
  { x: 10, y: 20, width: 50, height: 70 },
  '正向拖拽应得到原点和正宽高'
)

assert.deepEqual(
  rectFromPoints({ x: 100, y: 80 }, { x: 20, y: 10 }),
  { x: 20, y: 10, width: 80, height: 70 },
  '向左上反向拖拽应得到左上角和正宽高'
)

assert.deepEqual(
  shapeFromDrag(
    { id: 'draft', kind: 'rect', x: 90, y: 70, width: 10, height: 10 },
    { x: 100, y: 80 },
    { x: 20, y: 10 }
  ),
  { id: 'draft', kind: 'rect', x: 20, y: 10, width: 80, height: 70 },
  '连续预览更新时应始终使用初始按下点作为锚点'
)

assert.deepEqual(
  normalizeRectLike({ kind: 'circle', x: 100, y: 80, width: -80, height: -70 }),
  { kind: 'circle', x: 20, y: 10, width: 80, height: 70 },
  '负宽高形状在绘制和提交前应归一化'
)

console.log('screenshot-pin geometry tests passed')
