// 把已构建的 examples/hello-tool 作为"已安装插件"种入 userData/plugins/hello（模拟本地安装），
// 用于端到端验证宿主的运行时加载链路。
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.setName('ttool')

app.whenReady().then(() => {
  const pluginsRoot = path.join(app.getPath('userData'), 'plugins')
  const dir = path.join(pluginsRoot, 'hello')
  fs.mkdirSync(dir, { recursive: true })
  const root = path.join(__dirname, '..')
  // 从自包含的 dist/（构建已把 manifest.json 复制进去）整目录拷入，镜像真实安装布局
  const distDir = path.join(root, 'examples/hello-tool/dist')
  for (const f of fs.readdirSync(distDir)) fs.copyFileSync(path.join(distDir, f), path.join(dir, f))
  const idxFile = path.join(pluginsRoot, 'registry.json')
  let idx = {}
  try {
    idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'))
  } catch {
    /* ignore */
  }
  idx.hello = { enabled: true, source: { type: 'local', path: path.join(root, 'examples/hello-tool') } }
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2))
  console.log('SEEDED plugin at ' + dir)
  app.quit()
})
