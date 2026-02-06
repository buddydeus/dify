#!/usr/bin/env node
/**
 * 准备 prebuilt Docker 构建上下文并构建镜像。
 *
 * 策略：基于 langgenius/dify-web 官方镜像，只替换 .next 编译产物和 server.js。
 * node_modules / pm2 / entrypoint / 用户等全部复用基础镜像，无需复制也无需处理符号链接。
 *
 * 使用前在 web/ 下执行:
 *   pnpm install && pnpm build:docker
 * 然后:
 *   node scripts/prepare-docker-prebuilt.mjs [image-name]
 *
 * 构建上下文结构（对应 Dockerfile.prebuilt 的 COPY）:
 *   context/server.js  ← .next/standalone/server.js
 *   context/.next/      ← .next/standalone/.next/ + .next/static/ 合并
 *   context/public/     ← web/public/
 */

import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function getBuildCmd() {
  if (process.env.DOCKER_CMD) return process.env.DOCKER_CMD
  const r = spawnSync('docker', ['version'], { encoding: 'utf8', stdio: 'pipe' })
  if (r.status === 0) return 'docker'
  const r2 = spawnSync('podman', ['version'], { encoding: 'utf8', stdio: 'pipe' })
  if (r2.status === 0) return 'podman'
  console.error('❌ 未找到 docker 或 podman，请安装其一或设置 DOCKER_CMD')
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.join(__dirname, '..')
const contextDir = path.join(webRoot, '.docker-prebuilt-context')
const imageName = process.argv[2] || 'dify-web'

async function exists(p) {
  try {
    await stat(p)
    return true
  }
  catch {
    return false
  }
}

async function verifySourceArtifacts() {
  const checks = [
    [path.join(webRoot, '.next', 'standalone', 'server.js'), '.next/standalone/server.js'],
    [path.join(webRoot, '.next', 'standalone', '.next'), '.next/standalone/.next/'],
    [path.join(webRoot, '.next', 'static'), '.next/static/'],
    [path.join(webRoot, 'public'), 'public/'],
  ]
  const missing = []
  for (const [abs, label] of checks) {
    if (!(await exists(abs)))
      missing.push(label)
  }
  if (missing.length) {
    console.error('❌ 缺少构建产物，请先执行: pnpm install && pnpm build:docker')
    console.error('   缺失:', missing.join(', '))
    process.exit(1)
  }
}

async function main() {
  await verifySourceArtifacts()

  console.log('📦 Preparing prebuilt Docker context...')
  await rm(contextDir, { recursive: true }).catch(() => {})
  await mkdir(contextDir, { recursive: true })

  await cp(path.join(webRoot, '.next', 'standalone', 'server.js'), path.join(contextDir, 'server.js'))
  await cp(path.join(webRoot, '.next', 'standalone', '.next'), path.join(contextDir, '.next'), { recursive: true })
  await cp(path.join(webRoot, '.next', 'static'), path.join(contextDir, '.next', 'static'), { recursive: true })
  await cp(path.join(webRoot, 'public'), path.join(contextDir, 'public'), { recursive: true })

  const buildCmd = getBuildCmd()
  console.log(`🐳 Building image "${imageName}" (using ${buildCmd})...`)
  const proc = spawn(
    buildCmd,
    ['build', '-f', path.join(webRoot, 'Dockerfile.prebuilt'), '-t', imageName, contextDir],
    { stdio: 'inherit', cwd: webRoot },
  )
  const code = await new Promise(resolve => proc.on('close', resolve))
  await rm(contextDir, { recursive: true }).catch(() => {})
  process.exit(code ?? 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
