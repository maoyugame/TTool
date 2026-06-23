// 本机文件搜索：用各平台「系统索引」做快速搜索（非全盘遍历）。
//  - Windows：Windows Search 索引（ADODB + Search.CollatorDSO，经 PowerShell 查询）
//  - macOS：Spotlight（mdfind）
//  - Linux：plocate / locate（装了才用）
// 查询字符串经环境变量传入子进程，绝不拼进命令行，杜绝注入；结果上限 40、整体超时 5s。
const { spawn } = require('node:child_process')
const path = require('node:path')

const MAX = 40
const TIMEOUT = 5000

// Windows Search：PS 脚本读 $env:TTOOL_Q，自行转义 LIKE 项，输出每行一个路径（UTF-8）。
const PS_SCRIPT = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$q = $env:TTOOL_Q
if([string]::IsNullOrWhiteSpace($q)){ exit 0 }
$q = $q -replace "'","''" -replace '[%_\\[\\]]',''
if([string]::IsNullOrWhiteSpace($q)){ exit 0 }
try {
  $conn = New-Object -ComObject ADODB.Connection
  $rs = New-Object -ComObject ADODB.Recordset
  $conn.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
  $sql = "SELECT TOP ${MAX} System.ItemPathDisplay FROM SystemIndex WHERE System.FileName LIKE '%$q%' ORDER BY System.DateModified DESC"
  $rs.Open($sql, $conn)
  while(-not $rs.EOF){
    $p = $rs.Fields.Item('System.ItemPathDisplay').Value
    if($p){ [Console]::Out.WriteLine($p) }
    $rs.MoveNext()
  }
  $rs.Close(); $conn.Close()
} catch { exit 0 }
`

function run(cmd, args, env) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true })
    } catch {
      resolve([])
      return
    }
    let out = ''
    let done = false
    const finish = (lines) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { child.kill() } catch { /* ignore */ }
      resolve(lines)
    }
    const timer = setTimeout(() => finish(parse(out)), TIMEOUT)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      out += d
      // 行数足够即可提前结束（mac/linux 流式输出）
      if (out.split('\n').length > MAX + 2) finish(parse(out))
    })
    child.on('error', () => finish([]))
    child.on('close', () => finish(parse(out)))
  })
}

function parse(out) {
  const seen = new Set()
  const res = []
  for (const raw of out.split(/\r?\n/)) {
    const p = raw.trim()
    if (!p || seen.has(p)) continue
    seen.add(p)
    res.push({ path: p, name: path.basename(p) || p })
    if (res.length >= MAX) break
  }
  return res
}

async function searchFiles(query) {
  const q = String(query || '').trim()
  if (q.length < 2) return [] // 太短不搜，避免海量结果
  if (process.platform === 'win32') {
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT], { TTOOL_Q: q })
  }
  if (process.platform === 'darwin') {
    // q 是 -name 的操作数（被消费为文件名，不会当作新选项），但仍拒绝纯 '-' 前缀以稳妥
    return run('mdfind', ['-name', q], {})
  }
  // linux：优先 plocate，回退 locate；'--' 终止选项，防 '-' 前缀查询被当成 locate 选项
  const tryLocate = (bin) => run(bin, ['-i', '-l', String(MAX), '--', q], {})
  let r = await tryLocate('plocate')
  if (!r.length) r = await tryLocate('locate')
  return r
}

module.exports = { searchFiles }
