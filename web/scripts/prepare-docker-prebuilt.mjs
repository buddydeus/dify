#!/usr/bin/env node
/**
 * 准备 prebuilt Docker 构建上下文并构建镜像（给 `pnpm build:image` 使用）。
 *
 * 设计目标：
 * - 只替换 Next.js 编译产物（`.next/*`）与 `server.js`，其余全部复用基础镜像
 * - 避免复制/处理 node_modules、pm2、entrypoint、用户权限等，减少构建复杂度
 * - 严格校验 `next build` 的 `output: 'standalone'` 产物路径，错误提示可直接修复
 *
 * 用法（推荐）：
 *   pnpm build:image -- <image-name>
 *
 * 兼容用法（pnpm 也会把参数透传给脚本）：
 *   pnpm build:image <image-name>
 *
 * 构建上下文结构（需与 `web/Dockerfile.prebuilt` 的 COPY 对齐）：
 *   .docker-prebuilt-context/server.js  ← .next/standalone/server.js
 *   .docker-prebuilt-context/.next/     ← .next/standalone/.next/ + .next/static/ 合并
 *   .docker-prebuilt-context/public/    ← web/public/
 */

import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.join(__dirname, '..')
const contextDir = path.join(webRoot, '.docker-prebuilt-context')

export async function resetContextDir(contextDir) {
  await rm(contextDir, { recursive: true, force: true })
  await mkdir(contextDir, { recursive: true })
}

export async function copyPrebuiltContext({
  contextDir,
  standaloneAppDir,
  webRoot,
}) {
  const recursiveCopyOptions = {
    recursive: true,
    dereference: true,
  }

  await cp(
    path.join(standaloneAppDir, 'server.js'),
    path.join(contextDir, 'server.js'),
  )
  await cp(
    path.join(standaloneAppDir, '.next'),
    path.join(contextDir, '.next'),
    recursiveCopyOptions,
  )
  await cp(
    path.join(webRoot, '.next', 'static'),
    path.join(contextDir, '.next', 'static'),
    recursiveCopyOptions,
  )
  await cp(
    path.join(webRoot, 'public'),
    path.join(contextDir, 'public'),
    recursiveCopyOptions,
  )
}

function parseArgs(argv) {
  const args = argv.slice(2)
  if (args.includes('-h') || args.includes('--help')) {
    console.log(
      [
        'Usage:',
        '  node scripts/prepare-docker-prebuilt.mjs [image-name]',
        '',
        'Examples:',
        '  pnpm build:image -- swr.cn-south-1.myhuaweicloud.com/hw36423330/dify-web:jinglong',
        '',
        'Environment:',
        '  DOCKER_CMD   override docker command (e.g. "docker" or "podman")',
      ].join('\n'),
    )
    process.exit(0)
  }

  // `pnpm <script> -- <args>` or `pnpm <script> <args>` will both land here.
  // We only need the first positional arg as image tag.
  const image = args.find(a => !a.startsWith('-'))
  return {
    imageName: image || 'dify-web',
  }
}

function getBuildCmd() {
  if (process.env.DOCKER_CMD)
    return process.env.DOCKER_CMD

  const r = spawnSync('docker', ['version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (r.status === 0)
    return 'docker'

  const r2 = spawnSync('podman', ['version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (r2.status === 0)
    return 'podman'

  console.error('❌ 未找到 docker 或 podman，请安装其一或设置 DOCKER_CMD')
  process.exit(1)
}

async function exists(p) {
  try {
    await stat(p)
    return true
  }
  catch {
    return false
  }
}

async function getStandaloneAppDir() {
  const standaloneRoot = path.join(webRoot, '.next', 'standalone')

  // Next.js sometimes emits the standalone bundle at `.next/standalone/<projectName>/...`
  // (e.g. monorepo or custom output file tracing layouts).
  const directServer = path.join(standaloneRoot, 'server.js')
  const directNextDir = path.join(standaloneRoot, '.next')
  if ((await exists(directServer)) && (await exists(directNextDir))) {
    return standaloneRoot
  }

  const entries = await readdir(standaloneRoot, { withFileTypes: true }).catch(
    () => [],
  )
  for (const e of entries) {
    if (!e.isDirectory())
      continue
    const candidate = path.join(standaloneRoot, e.name)
    const server = path.join(candidate, 'server.js')
    const nextDir = path.join(candidate, '.next')
    if ((await exists(server)) && (await exists(nextDir))) {
      return candidate
    }
  }

  return ''
}

async function verifySourceArtifacts() {
  const dockerfile = path.join(webRoot, 'Dockerfile.prebuilt')
  if (!(await exists(dockerfile))) {
    console.error(
      '❌ 未找到 web/Dockerfile.prebuilt，请确认仓库完整且路径正确',
    )
    process.exit(1)
  }

  const standaloneAppDir = await getStandaloneAppDir()
  const checks = [
    [
      standaloneAppDir ? path.join(standaloneAppDir, 'server.js') : '',
      '.next/standalone/**/server.js',
    ],
    [
      standaloneAppDir ? path.join(standaloneAppDir, '.next') : '',
      '.next/standalone/**/.next/',
    ],
    [path.join(webRoot, '.next', 'static'), '.next/static/'],
    [path.join(webRoot, 'public'), 'public/'],
  ]
  const missing = []
  for (const [abs, label] of checks) {
    if (!abs || !(await exists(abs)))
      missing.push(label)
  }
  if (missing.length) {
    console.error(
      '❌ 缺少构建产物，请先在 web/ 下执行: pnpm install && pnpm build',
    )
    console.error('   缺失:', missing.join(', '))
    process.exit(1)
  }
}

function getCommitSha() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: webRoot,
  })
  if (r.status !== 0)
    return ''
  return (r.stdout || '').trim()
}

async function main() {
  const { imageName } = parseArgs(process.argv)
  await verifySourceArtifacts()

  const standaloneAppDir = await getStandaloneAppDir()
  if (!standaloneAppDir) {
    console.error(
      '❌ 未定位到 standalone 产物目录（期望存在 `.next/standalone/**/server.js`）',
    )
    process.exit(1)
  }

  console.log('📦 Preparing prebuilt Docker build context...')
  await resetContextDir(contextDir)
  await copyPrebuiltContext({ contextDir, standaloneAppDir, webRoot })

  const buildCmd = getBuildCmd()
  console.log(`🐳 Building image "${imageName}" (using ${buildCmd})...`)

  const commitSha = process.env.COMMIT_SHA || getCommitSha()
  const buildArgs = [
    '-f',
    path.join(webRoot, 'Dockerfile.prebuilt'),
    '-t',
    imageName,
    ...(commitSha ? ['--build-arg', `COMMIT_SHA=${commitSha}`] : []),
    contextDir,
  ]
  if (os.platform() === 'win32')
    buildArgs.unshift('--provenance=false')
  buildArgs.unshift('build')

  const proc = spawn(buildCmd, buildArgs, { stdio: 'inherit', cwd: webRoot })
  const code = await new Promise((resolve) => {
    proc.on('close', resolve)
    proc.on('error', (err) => {
      console.error(`❌ 无法执行构建命令: ${buildCmd}`)
      console.error(err)
      resolve(1)
    })
  })
  await rm(contextDir, { recursive: true, force: true }).catch(() => {})
  process.exit(code ?? 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
