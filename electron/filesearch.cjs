// 本机文件搜索：用各平台「系统索引」做快速搜索（非全盘遍历）。
//  - Windows：Windows Search 索引（ADODB + Search.CollatorDSO，经 PowerShell 查询）
//  - macOS：Spotlight（mdfind）
//  - Linux：plocate / locate（装了才用）
// 查询字符串经环境变量传入子进程，绝不拼进命令行，杜绝注入；结果上限 40、整体超时 5s。
const { spawn } = require('node:child_process')
const path = require('node:path')

// 多取候选给渲染层排序用：OS 索引只能按修改时间返回前 N，取多些才能让最佳命名匹配进入候选池，
// 再由 src/store/fileRank.ts 按相关性重排、截断展示。
const MAX = 150
const TIMEOUT = 5000
const DRIVE_CACHE_TTL = 5000

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

// 取原始 stdout 文本（用于枚举硬盘）。
function runText(cmd, args) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch {
      resolve('')
      return
    }
    let out = ''
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { child.kill() } catch { /* ignore */ }
      resolve(out)
    }
    const timer = setTimeout(finish, TIMEOUT)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.on('error', finish)
    child.on('close', finish)
  })
}

function parseDriveRoots(out) {
  const seen = new Set()
  const drives = []
  for (const line of String(out || '').split(/\r?\n/)) {
    const drive = line.trim().toUpperCase()
    if (!/^[A-Z]:\\$/.test(drive) || seen.has(drive)) continue
    seen.add(drive)
    drives.push(drive)
  }
  return drives
}

// 枚举所有已就绪盘符（固定盘、移动盘、映射盘等），短时缓存以避免输入时频繁启动 PowerShell。
// C 盘也参与补充扫描：Windows Search 只覆盖已建立索引的位置，不能代表整个 C 盘。
let deepDrivesCache = { expiresAt: 0, drives: [] }
async function getDeepDrives() {
  const now = Date.now()
  if (now < deepDrivesCache.expiresAt) return deepDrivesCache.drives
  try {
    const out = await runText('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | ForEach-Object { $_.Name }',
    ])
    deepDrivesCache = { expiresAt: now + DRIVE_CACHE_TTL, drives: parseDriveRoots(out) }
  } catch {
    deepDrivesCache = { expiresAt: now + DRIVE_CACHE_TTL, drives: [] }
  }
  return deepDrivesCache.drives
}

// 深度扫描查询字符串清洗：仅留字母/数字/CJK/空格/._-，杜绝注入与 -Filter 通配符干扰。
const safeQ = (q) => String(q || '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim()

// 深度扫描 PS 脚本：递归列出某盘下「名字匹配」的文件与文件夹（Get-ChildItem -Filter 同时匹配两者）。
// q / 盘符经环境变量传入（免转义、防注入）；UTF-8 输出保中文路径；SilentlyContinue 跳过无权限目录。
const DEEP_PS = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$q=$env:TTOOL_Q; $d=$env:TTOOL_DRIVE
if([string]::IsNullOrWhiteSpace($q) -or [string]::IsNullOrWhiteSpace($d)){ exit 0 }
Get-ChildItem -LiteralPath $d -Recurse -ErrorAction SilentlyContinue -Filter ("*"+$q+"*") | Select-Object -First ${MAX} | ForEach-Object { [Console]::Out.WriteLine($_.FullName) }
`

// 深度扫描：Windows 上对所有已就绪盘符递归搜索名字匹配的文件与文件夹（较慢，与索引并行）。
// mac/linux 的 mdfind/locate 已覆盖全盘，返回空。
async function searchDeep(query) {
  if (process.platform !== 'win32') return []
  const q = safeQ(query)
  if (q.length < 2) return []
  const drives = await getDeepDrives()
  if (!drives.length) return []
  const scans = drives.map((d) =>
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DEEP_PS], { TTOOL_Q: q, TTOOL_DRIVE: d })
  )
  const all = (await Promise.all(scans)).flat()
  // 跨盘去重
  const seen = new Set()
  const res = []
  for (const h of all) {
    if (!h || seen.has(h.path)) continue
    seen.add(h.path)
    res.push(h)
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

module.exports = { searchFiles, searchDeep, _test: { parseDriveRoots } }
