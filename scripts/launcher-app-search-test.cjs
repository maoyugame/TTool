const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const electron = require('electron')

const app = {
  id: 'app_launcher_test',
  name: '示例手动应用',
  path: 'C:\\LauncherTest\\ExampleManualApp.exe',
}

async function run() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ttool-launcher-test-'))
  const child = spawn(electron, [path.join(__dirname, 'capture-launcher.cjs')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      CAP_QUERY: 'slsdyy',
      CAP_APPS: JSON.stringify([app]),
      CAP_EXPECT_APP: app.name,
      CAP_ACTIVATE_APP: app.name,
      CAP_EXPECT_APP_PATH: app.path,
      CAP_USER_DATA: userData,
    },
    stdio: 'inherit',
    windowsHide: true,
  })

  try {
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('Launcher manual-app regression timed out'))
      }, 30_000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (exitCode) => {
        clearTimeout(timeout)
        resolve(exitCode)
      })
    })

    assert.equal(code, 0, `Launcher manual-app regression failed with exit code ${code}`)
    console.log('launcher manual-app search tests passed')
  } finally {
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
