#!/usr/bin/env node

import { readFile, readdir, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pluginRoot = join(repositoryRoot, 'plugins', 'lark-agent-bridge')

const failures = []

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    failures.push(`${path}: invalid JSON (${error instanceof Error ? error.message : 'unknown error'})`)
    return null
  }
}

function requireValue(condition, message) {
  if (!condition) failures.push(message)
}

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true })
  const paths = []
  for (const entry of entries) {
    const child = join(path, entry.name)
    paths.push(child)
    if (entry.isDirectory()) paths.push(...(await walk(child)))
  }
  return paths
}

const codexManifest = await readJson(join(pluginRoot, '.codex-plugin', 'plugin.json'))
const claudeManifest = await readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'))
const compatibility = await readJson(join(pluginRoot, 'compatibility.json'))
const codexMarketplace = await readJson(join(repositoryRoot, '.agents', 'plugins', 'marketplace.json'))
const claudeMarketplace = await readJson(join(repositoryRoot, '.claude-plugin', 'marketplace.json'))

for (const manifest of [codexManifest, claudeManifest]) {
  requireValue(manifest?.name === 'lark-agent-bridge', 'plugin manifest name must be lark-agent-bridge')
  requireValue(/^\d+\.\d+\.\d+$/.test(manifest?.version ?? ''), 'plugin manifest version must be strict semver')
}

requireValue(codexManifest?.version === claudeManifest?.version, 'Claude and Codex manifest versions must match')
requireValue(compatibility?.pluginVersion === codexManifest?.version, 'compatibility pluginVersion must match manifests')
requireValue(compatibility?.bridge?.package === 'lark-channel-bridge', 'compatibility must use lark-channel-bridge')
requireValue(codexMarketplace?.name === 'momiji-lark-tools', 'Codex marketplace name mismatch')
requireValue(claudeMarketplace?.name === 'momiji-lark-tools', 'Claude marketplace name mismatch')

const presetNames = ['read-only', 'safe-edit', 'full']
for (const name of presetNames) {
  const preset = await readJson(join(pluginRoot, 'assets', 'presets', `${name}.json`))
  requireValue(preset?.name === name, `preset name mismatch: ${name}`)
  const permissions = preset?.profile?.permissions
  requireValue(
    ['read-only', 'workspace', 'full'].includes(permissions?.defaultAccess),
    `invalid defaultAccess in ${name}`,
  )
  requireValue(
    ['read-only', 'workspace', 'full'].includes(permissions?.maxAccess),
    `invalid maxAccess in ${name}`,
  )
}

const skillRoot = join(pluginRoot, 'skills')
for (const skillName of await readdir(skillRoot)) {
  const skillPath = join(skillRoot, skillName, 'SKILL.md')
  const skill = await readFile(skillPath, 'utf8')
  requireValue(skill.startsWith('---\n'), `${skillPath}: missing YAML frontmatter`)
  requireValue(skill.includes(`name: ${skillName}`), `${skillPath}: name must match directory`)
  requireValue(!skill.includes('TODO'), `${skillPath}: TODO placeholder remains`)
}

const forbiddenNames = /(^|\/)(secrets\.enc|config\.json|profile\.json|\.env)$/
for (const path of await walk(repositoryRoot)) {
  if (path.includes(`${join(repositoryRoot, '.git')}/`)) continue
  const relative = path.slice(repositoryRoot.length + 1)
  const stat = await lstat(path)
  requireValue(!stat.isSymbolicLink(), `${relative}: symlinks are not allowed in release contents`)
  requireValue(!forbiddenNames.test(relative), `${relative}: secret-bearing file name is forbidden`)
}

if (failures.length > 0) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Repository validation passed.\n')
}
