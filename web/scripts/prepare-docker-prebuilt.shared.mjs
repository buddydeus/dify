import * as os from 'node:os'

export function resolveBuildPlatform(
  buildCmd,
  runtimePlatform = os.platform(),
  runtimeArch = os.arch(),
  explicitPlatform = process.env.PREBUILT_IMAGE_PLATFORM || process.env.CONTAINER_PLATFORM || '',
) {
  if (explicitPlatform)
    return explicitPlatform

  if (buildCmd !== 'podman' || runtimePlatform !== 'darwin')
    return ''

  if (runtimeArch === 'arm64')
    return 'linux/arm64'

  if (runtimeArch === 'x64')
    return 'linux/amd64'

  return `linux/${runtimeArch}`
}
