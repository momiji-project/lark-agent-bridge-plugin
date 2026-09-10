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
const shellBootstrap = join(pluginRoot, 'scripts', 'bootstrap.sh')
const windowsBootstrap = join(pluginRoot, 'scripts', 'bootstrap-windows.ps1')
const shellTerminalSetup = join(pluginRoot, 'scripts', 'terminal-setup.sh')
const windowsTerminalSetup = join(pluginRoot, 'scripts', 'terminal-setup.ps1')

for (const manifest of [codexManifest, claudeManifest]) {
  requireValue(manifest?.name === 'lark-agent-bridge', 'plugin manifest name must be lark-agent-bridge')
  requireValue(/^\d+\.\d+\.\d+$/.test(manifest?.version ?? ''), 'plugin manifest version must be strict semver')
}

requireValue(codexManifest?.version === claudeManifest?.version, 'Claude and Codex manifest versions must match')
requireValue(compatibility?.pluginVersion === codexManifest?.version, 'compatibility pluginVersion must match manifests')
requireValue(compatibility?.bridge?.package === 'lark-channel-bridge', 'compatibility must use lark-channel-bridge')
requireValue(codexMarketplace?.name === 'momiji-lark-tools', 'Codex marketplace name mismatch')
requireValue(claudeMarketplace?.name === 'momiji-lark-tools', 'Claude marketplace name mismatch')

const shellBootstrapStat = await lstat(shellBootstrap)
requireValue(shellBootstrapStat.isFile(), 'macOS bootstrap must be a regular file')
requireValue((shellBootstrapStat.mode & 0o111) !== 0, 'macOS bootstrap must be executable')
requireValue((await lstat(windowsBootstrap)).isFile(), 'Windows bootstrap must be a regular file')
const shellTerminalSetupStat = await lstat(shellTerminalSetup)
requireValue(shellTerminalSetupStat.isFile(), 'macOS terminal setup must be a regular file')
requireValue((shellTerminalSetupStat.mode & 0o111) !== 0, 'macOS terminal setup must be executable')
requireValue((await lstat(windowsTerminalSetup)).isFile(), 'Windows terminal setup must be a regular file')

function requireOrderedSnippets(source, snippets, label) {
  let cursor = -1
  for (const snippet of snippets) {
    const index = source.indexOf(snippet, cursor + 1)
    requireValue(index > cursor, `${label}: expected ordered setup action ${snippet}`)
    if (index > cursor) cursor = index
  }
}

const shellTerminalSource = await readFile(shellTerminalSetup, 'utf8')
const windowsTerminalSource = await readFile(windowsTerminalSetup, 'utf8')
for (const [label, source, executionStart, markers] of [
  ['macOS/Linux terminal setup', shellTerminalSource, 'if [ "$PROFILE_EXISTS" -eq 0 ]', ['ensure_personal_lark_auth', 'preset --profile', 'start --profile']],
  ['Windows terminal setup', windowsTerminalSource, 'if (-not $profileExists)', ['Enable-PersonalLarkAccess', '$Manager, "preset"', '& $bridge start']],
]) {
  requireValue(source.includes('auth login --domain minutes --domain docs --no-wait --json'), `${label}: missing fixed Minutes/Docs device-flow start`)
  requireValue(source.includes('auth qrcode'), `${label}: missing QR generation`)
  requireValue(source.includes('auth login --device-code'), `${label}: missing device-flow completion`)
  const executionIndex = source.lastIndexOf(executionStart)
  requireValue(executionIndex >= 0, `${label}: setup execution block not found`)
  requireOrderedSnippets(executionIndex >= 0 ? source.slice(executionIndex) : '', markers, label)
}

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
