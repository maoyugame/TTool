const assert = require('node:assert/strict')
const { _test } = require('../electron/filesearch.cjs')

assert.deepEqual(
  _test.parseDriveRoots('C:\\\r\nD:\\\r\ne:\\\r\nZ:\\\r\n'),
  ['C:\\', 'D:\\', 'E:\\', 'Z:\\'],
  '应保留包括 C 盘、移动盘和映射盘在内的所有有效盘符'
)

assert.deepEqual(
  _test.parseDriveRoots('D:\\\nD:\\\nnot-a-drive\nE:\\folder\n'),
  ['D:\\'],
  '应去重并拒绝非盘符根路径'
)

console.log('filesearch drive tests passed')
