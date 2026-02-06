# Production Build Optimization Scripts

## optimize-standalone.js

This script removes unnecessary development dependencies from the Next.js standalone build output to reduce the production Docker image size.

### What it does

The script specifically targets and removes `jest-worker` packages that are bundled with Next.js but not needed in production. These packages are included because:

1. Next.js includes jest-worker in its compiled dependencies
1. terser-webpack-plugin (used by Next.js for minification) depends on jest-worker
1. pnpm's dependency resolution creates symlinks to jest-worker in various locations

### Usage

The script is automatically run during Docker builds via the `build:docker` npm script:

```bash
# Docker build (removes jest-worker after build)
pnpm build:docker
```

To run the optimization manually:

```bash
node scripts/optimize-standalone.js
```

### What gets removed

- `node_modules/.pnpm/next@*/node_modules/next/dist/compiled/jest-worker`
- `node_modules/.pnpm/terser-webpack-plugin@*/node_modules/jest-worker` (symlinks)
- `node_modules/.pnpm/jest-worker@*` (actual packages)

### Impact

Removing jest-worker saves approximately 36KB per instance from the production image. While this may seem small, it helps ensure production images only contain necessary runtime dependencies.

## prepare-docker-prebuilt.mjs (build image without compiling in Docker)

Build the production Docker image by copying pre-built artifacts only. No compilation runs inside Docker, so this avoids OOM (exit code 137) when Docker has limited memory.

### Usage

1. Build on the host (requires enough RAM for Next.js build, e.g. 4GB+):

```bash
cd web
pnpm install
pnpm build:docker
```

2. Build the image (only copies files; no heavy build in container):

```bash
pnpm run build:docker:image
# Or with custom image name:
node scripts/prepare-docker-prebuilt.mjs my-dify-web
```

The script prepares a minimal context (`.next/standalone`, `.next/static`, `public`, `docker/`), runs `docker build -f Dockerfile.prebuilt`, then removes the context. The image is equivalent to the one produced by the default `Dockerfile` but built without running `next build` inside Docker.

## test-standalone.mjs (verify standalone after build)

Run after `pnpm build:docker` to check whether the standalone output is valid and will work in Docker (e.g. `require('next')` resolves).

### What it does

1. **Structure** – Checks that `server.js` and `node_modules` (and `node_modules/next`) exist.
2. **Symlinks** – Lists top-level `node_modules` entries and whether each symlink points inside or outside `.next/standalone`. Links pointing outside break in Docker if only the standalone tree is copied.
3. **require from standalone** – Runs `require('next')` and `require('next/dist/server/lib/start-server')` with `cwd` set to `.next/standalone` (same as the container). If this fails, the issue is with Next.js standalone output or host-only symlinks.
4. **Isolated copy** – Builds a dereferenced copy of standalone (no symlinks to host paths) and runs the same require tests. If (3) passes but (4) fails, the problem is symlinks; if (4) passes, the prebuilt Docker image should work.

6. **Start server (entrypoint-like)** – Runs `node server.js` with the same environment variables as `docker/entrypoint.sh` / `Dockerfile.prebuilt` (NODE_ENV, PORT, NEXT_PUBLIC_* etc.). Uses an available port (chosen at runtime to avoid conflicts). Checks that the server responds within a timeout; then the process is stopped (SIGTERM then SIGKILL). Ensures the app actually starts without throwing.

### Usage

```bash
cd web
pnpm build:docker
pnpm run test:standalone
```

By default, step 5 (isolated copy) is skipped because it can be very slow on Windows. To run the full check including step 5:

```bash
pnpm run test:standalone -- --isolated
```

Use this to confirm whether "Cannot find module 'next'" in the container is due to Next.js packaging (symlinks outside standalone) or the prebuilt copy step.

## verify-docker-image.mjs (check image has node_modules)

After building the image with `pnpm run build:docker:image`, run this to confirm the image contains `/app/web/node_modules` and `/app/web/node_modules/next` so that the container does not throw "Cannot find module 'next'".

### Usage

```bash
pnpm run verify:docker:image
# Or with custom image name:
node scripts/verify-docker-image.mjs my-dify-web
```

The script runs `docker run --rm <image> ls -la /app/web/node_modules` and checks for `node_modules/next` and `next/package.json`. If any check fails, the prebuilt context likely had incomplete copy (e.g. symlinks not fully dereferenced).
