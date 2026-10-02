/**
 * Fails when the committed `lib/` no longer matches a fresh build of `src/`.
 *
 * `lib/` is committed so that a git install needs no build step (see
 * .gitignore). The cost is that the two can drift: an edit to `src/` that is
 * never rebuilt installs an older plugin than the source describes, and nothing
 * in the install path would notice. This makes that state loud instead.
 *
 * The comparison is against what git has recorded, not the working tree —
 * otherwise a freshly built lib/ would trivially agree with itself.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lib = join(root, 'lib')
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** Every file under `lib/`, as path relative to `lib/` → content hash. */
function fingerprint(dir, prefix = '') {
  const result = new Map()
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    const name = `${prefix}${entry}`
    if (statSync(full).isDirectory()) {
      for (const [k, v] of fingerprint(full, `${name}/`)) result.set(k, v)
    } else {
      result.set(name, sha(readFileSync(full)))
    }
  }
  return result
}

function run(command, args) {
  return spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: true })
}

const build = run('npx', ['tsc', '-p', 'tsconfig.build.json'])
if (build.status !== 0) {
  console.error('verify:build — the build failed, so it cannot be compared:')
  console.error(build.stdout || build.stderr)
  process.exit(1)
}

const client = run('npx', ['tsdown', '--config', 'tsdown.client.config.mjs'])
if (client.status !== 0) {
  console.error('verify:build — the client bundle failed, so it cannot be compared:')
  console.error(client.stdout || client.stderr)
  process.exit(1)
}

const built = fingerprint(lib)
const problems = []

// What git currently records under lib/, so a stale commit is caught even
// though the working tree was just rebuilt over it.
const tracked = run('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'lib/'])
const trackedNames = tracked.status === 0
  ? tracked.stdout.split('\n').map(line => line.replace(/^lib\//, '')).filter(Boolean)
  : []

for (const name of trackedNames) {
  if (!built.has(name)) {
    problems.push(`${name} — tracked under lib/ but no longer produced by the build`)
    continue
  }
  const committed = run('git', ['show', `HEAD:lib/${name}`])
  if (committed.status !== 0) {
    problems.push(`${name} — could not be read from git`)
  } else if (sha(Buffer.from(committed.stdout, 'utf8')) !== built.get(name)) {
    problems.push(`${name} — committed content differs from a fresh build`)
  }
}
for (const name of built.keys()) {
  if (!trackedNames.includes(name)) problems.push(`${name} — built but not committed`)
}

if (problems.length > 0) {
  console.error('verify:build — the committed lib/ does not match a fresh build of src/:')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\nRun `npm run build` and commit the result.')
  process.exit(1)
}

console.log(`verify:build — ${built.size} committed files in lib/ match a fresh build of src/.`)