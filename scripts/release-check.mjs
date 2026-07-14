import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageInfo = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const sdkPackageInfo = JSON.parse(readFileSync(resolve(root, 'packages', 'sdk', 'package.json'), 'utf8'))
const examplePackageInfo = JSON.parse(readFileSync(resolve(root, 'examples', 'hello-tool', 'package.json'), 'utf8'))
const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

function unquote(value) {
  const text = value.trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1)
  return text
}

function sha512Base64(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
assert.match(packageInfo.version, semver, `package.json version 不是合法 SemVer：${packageInfo.version}`)
assert.equal(packageInfo.repository?.url, 'https://github.com/maoyugame/TTool.git', 'repository 必须指向发布仓库')
assert.equal(packageInfo.build?.appId, 'com.maoyugame.ttool', 'appId 不得改变，否则会破坏 NSIS 原地升级')
assert.equal(packageInfo.build?.electronUpdaterCompatibility, '>=2.16', '必须锁定 electron-updater 元数据兼容格式')
assert.equal(packageInfo.build?.win?.target?.[0]?.target, 'nsis', 'Windows 自动更新必须使用 NSIS target')
assert.deepEqual(packageInfo.build?.win?.target?.[0]?.arch, ['x64'], '首期 Windows 发布只允许 x64')
assert.equal(packageInfo.build?.nsis?.differentialPackage, true, 'NSIS 必须启用差分包元数据')
assert.equal(packageInfo.build?.nsis?.artifactName, '${productName}-${version}-windows-${arch}-setup.${ext}', '安装包命名必须稳定且无空格')

assert.equal(packageInfo.dependencies?.react, '19.2.7', 'Host React must stay pinned to 19.2.7')
assert.equal(packageInfo.dependencies?.['react-dom'], packageInfo.dependencies?.react, 'react-dom must match React')
assert.equal(sdkPackageInfo.peerDependencies?.react, '^18 || ^19', 'SDK v1 must remain compatible with React 18 and 19')
assert.equal(examplePackageInfo.devDependencies?.react, '^19.2.7', 'Example plugin must use React 19')
assert.equal(examplePackageInfo.devDependencies?.['react-dom'], examplePackageInfo.devDependencies?.react, 'Example react-dom must match React')

const publish = packageInfo.build?.publish?.[0]
assert.equal(publish?.provider, 'github', '更新 Provider 必须为 GitHub Releases')
assert.equal(publish?.owner, 'maoyugame')
assert.equal(publish?.repo, 'TTool')
assert.equal(publish?.private, true, '内部发布仓库必须显式使用 private GitHub Provider')
assert.equal(publish?.releaseType, 'release', 'latest channel 不能发布为 draft（客户端不可见）')

for (const workflowName of ['ci.yml', 'release-windows.yml']) {
  const workflowPath = resolve(root, '.github', 'workflows', workflowName)
  const workflow = readFileSync(workflowPath, 'utf8')
  const actionRefs = [...workflow.matchAll(/^\s*uses:\s*([^@\s]+)@([^\s#]+)/gm)]
  assert.ok(actionRefs.length > 0, `${workflowName} 没有可验证的 Action 引用`)
  for (const [, action, ref] of actionRefs) {
    assert.match(ref, /^[0-9a-f]{40}$/, `${workflowName} 的 ${action} 必须固定到完整 commit SHA`)
  }
}

const releaseWorkflow = readFileSync(resolve(root, '.github', 'workflows', 'release-windows.yml'), 'utf8')
assert.match(releaseWorkflow, /secrets\.WIN_CSC_LINK/, 'Windows release must support optional WIN_CSC_LINK signing credentials')
assert.match(releaseWorkflow, /secrets\.WIN_CSC_KEY_PASSWORD/, 'Windows release must support optional WIN_CSC_KEY_PASSWORD signing credentials')
assert.match(releaseWorkflow, /Get-AuthenticodeSignature/, 'Windows release must inspect Authenticode state')
assert.match(releaseWorkflow, /'Valid', 'NotSigned'/, 'Internal release must only accept consistently valid or unsigned Authenticode state')
assert.match(releaseWorkflow, /Publishing unsigned Windows artifacts for controlled internal distribution/, 'Unsigned release must emit an explicit warning')

const explicitTag = option('--tag')
const environmentTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null
const tag = explicitTag || environmentTag
if (tag) assert.equal(tag.replace(/^v/, ''), packageInfo.version, `Git tag ${tag} 与 package.json v${packageInfo.version} 不一致`)

const artifactOption = option('--artifacts')
if (artifactOption) {
  const artifactDir = resolve(root, artifactOption)
  const metadataPath = resolve(artifactDir, 'latest.yml')
  assert.ok(existsSync(metadataPath), `缺少 Windows 更新元数据：${metadataPath}`)
  const metadata = readFileSync(metadataPath, 'utf8')
  const metadataVersion = /^version:\s*(.+)$/m.exec(metadata)?.[1]
  assert.equal(unquote(metadataVersion || ''), packageInfo.version, 'latest.yml 版本与 package.json 不一致')

  const references = [...metadata.matchAll(/^\s*(?:path|url):\s*(.+)$/gm)]
    .map((match) => basename(unquote(match[1])))
    .filter((name) => name.toLowerCase().endsWith('.exe'))
  assert.ok(references.length > 0, 'latest.yml 没有引用 Windows 安装包')
  const uniqueReferences = [...new Set(references)]
  assert.equal(uniqueReferences.length, 1, `latest.yml 引用了多个安装包：${uniqueReferences.join(', ')}`)

  const installerName = uniqueReferences[0]
  const installerPath = resolve(artifactDir, installerName)
  assert.ok(existsSync(installerPath), `latest.yml 引用的安装包不存在：${installerName}`)
  assert.ok(statSync(installerPath).size > 0, `安装包为空：${installerName}`)
  assert.ok(existsSync(`${installerPath}.blockmap`), `缺少差分更新 blockmap：${installerName}.blockmap`)

  const hashes = [...metadata.matchAll(/^\s*sha512:\s*(.+)$/gm)].map((match) => unquote(match[1]))
  const actualHash = sha512Base64(installerPath)
  assert.ok(hashes.includes(actualHash), 'latest.yml 的 SHA-512 与实际安装包不一致')

  const installers = readdirSync(artifactDir).filter((name) => name.toLowerCase().endsWith('.exe'))
  assert.deepEqual(installers, [installerName], `发布目录必须只包含元数据引用的一个安装包：${installers.join(', ')}`)
  console.log(`RELEASE ARTIFACT OK: ${installerName} (${statSync(installerPath).size} bytes), latest.yml and blockmap verified`)
}

console.log(`RELEASE CONFIG OK: v${packageInfo.version}, GitHub private latest channel, Windows NSIS x64`)
