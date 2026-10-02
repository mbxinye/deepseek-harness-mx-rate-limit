/**
 * Runs the integration suite against a real DeepSeek Harness checkout.
 *
 * The suite imports `@deepseek-ai/cordis` and `@deepseek-ai/dsh-llm`, which are
 * not npm dependencies here — they resolve through the harness tsconfig path
 * table, and that table is only found when the working directory is the harness
 * root. So this spawns Node from there rather than running in-process.
 *
 * Override the location with DSH_ROOT when the checkout is not a sibling.
 * Uses the harness's own `tsx`, so nothing extra is installed here.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const harnessRoot = process.env.DSH_ROOT === undefined
  ? resolve(projectRoot, '..', 'deepseek-harness')
  : resolve(process.env.DSH_ROOT)

const bin = join(harnessRoot, 'apps', 'cli', 'src', 'bin.ts')
if (!existsSync(bin)) {
  console.error(
    `test:e2e needs a harness checkout; ${bin} does not exist.\n`
    + 'Set DSH_ROOT to the deepseek-harness directory and try again.',
  )
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  [
    '--import', 'tsx/esm', '--test',
    join(projectRoot, 'e2e', 'integration.test.ts'),
    join(projectRoot, 'e2e', 'artifact.test.ts'),
    join(projectRoot, 'e2e', 'mount.test.ts'),
  ],
  { cwd: harnessRoot, stdio: 'inherit' },
)

process.exit(result.status ?? 1)