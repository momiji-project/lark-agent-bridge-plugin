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
const shellTerminalDiagnose = join(pluginRoot, 'scripts', 'terminal-diagnose.sh')
const windowsTerminalDiagnose = join(pluginRoot, 'scripts', 'terminal-diagnose.ps1')

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
const shellTerminalDiagnoseStat = await lstat(shellTerminalDiagnose)
requireValue(shellTerminalDiagnoseStat.isFile(), 'macOS diagnostic must be a regular file')
requireValue((shellTerminalDiagnoseStat.mode & 0o111) !== 0, 'macOS diagnostic must be executable')
requireValue((await lstat(windowsTerminalDiagnose)).isFile(), 'Windows diagnostic must be a regular file')

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
const shellDiagnosticSource = await readFile(shellTerminalDiagnose, 'utf8')
const windowsDiagnosticSource = await readFile(windowsTerminalDiagnose, 'utf8')
const readmeSource = await readFile(join(repositoryRoot, 'README.md'), 'utf8')
const docsSource = await readFile(join(repositoryRoot, 'docs', 'index.html'), 'utf8')

requireOrderedSnippets(shellDiagnosticSource, [
  'bash "$BOOTSTRAP" --check-only',
  'node "$MANAGER" preflight --json',
  'lark-channel-bridge profile list',
  'lark-channel-bridge ps',
], 'macOS/Linux read-only diagnostic')
requireOrderedSnippets(windowsDiagnosticSource, [
  '& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Bootstrap -CheckOnly',
  '& $node $Manager preflight --json',
  '& $bridge profile list',
  '& $bridge ps',
], 'Windows read-only diagnostic')

const mutatingDiagnosticPatterns = [
  /\b(?:npm|winget)\s+(?:install|upgrade|uninstall)\b/i,
  /\bauth\s+login\b/i,
  /\bprofile\s+(?:create|remove|delete)\b/i,
  /\b(?:start|stop|restart)\s+--profile\b/i,
  /\$MANAGER["']?\s+(?:install|update|preset|rules)\b/i,
]
for (const [label, source] of [
  ['macOS/Linux diagnostic', shellDiagnosticSource],
  ['Windows diagnostic', windowsDiagnosticSource],
]) {
  for (const pattern of mutatingDiagnosticPatterns) {
    requireValue(!pattern.test(source), `${label}: contains a prohibited mutating command (${pattern})`)
  }
  requireValue(source.includes('PCの状態は変更していません'), `${label}: missing explicit no-change completion message`)
}

const diagnoseSkillSource = await readFile(join(pluginRoot, 'skills', 'lark-diagnose', 'SKILL.md'), 'utf8')
const diagnoseAgentSource = await readFile(join(pluginRoot, 'skills', 'lark-diagnose', 'agents', 'openai.yaml'), 'utf8')
const setupAgentSource = await readFile(join(pluginRoot, 'skills', 'lark-setup', 'agents', 'openai.yaml'), 'utf8')
const legacySetupSource = await readFile(join(pluginRoot, 'skills', 'lark-bridge-setup', 'SKILL.md'), 'utf8')
requireValue(diagnoseSkillSource.includes('これは基盤導入ではない'), 'lark-diagnose must be independent from setup')
requireValue(diagnoseSkillSource.includes('Plugin導入前の初回診断には使わない'), 'lark-diagnose must not be presented as the pre-install entry')
requireValue(diagnoseAgentSource.includes('allow_implicit_invocation: true'), 'lark-diagnose must remain discoverable for post-install rechecks')
requireValue(setupAgentSource.includes('allow_implicit_invocation: false'), 'lark-setup must require explicit invocation after diagnosis')
requireValue(readmeSource.includes('/downloads/diagnose-windows.ps1'), 'README must expose the standalone Windows pre-install diagnosis')
requireValue(readmeSource.includes('/downloads/diagnose-macos.sh'), 'README must expose the standalone macOS pre-install diagnosis')
requireValue(!readmeSource.includes('codex exec --sandbox read-only'), 'README must not use Codex sandbox as the pre-install diagnosis')
requireValue(readmeSource.indexOf('Plugin導入前の診断専用コマンド') < readmeSource.indexOf('/install/lark-foundation-windows.ps1'), 'README must diagnose before adding the bridge plugin')
requireValue(!legacySetupSource.includes('New users must run the read-only lark-diagnose command first'), 'legacy setup must not require a Plugin skill for pre-install diagnosis')
requireValue(docsSource.includes(`SFL · v${codexManifest?.version}`), 'public docs version must match the plugin manifest')
requireValue(!docsSource.includes('https://github.com'), 'public docs must not link visitors directly to GitHub')
const claudePanel = docsSource.slice(docsSource.indexOf('id="install-panel-claude"'), docsSource.indexOf('</div>\n        </div>\n\n        <div class="skills-grid">'))
requireValue(claudePanel.includes('/downloads/diagnose-windows.ps1'), 'Claude installation panel must expose the standalone Windows diagnosis')
requireValue(claudePanel.includes('/downloads/diagnose-macos.sh'), 'Claude installation panel must expose the standalone macOS diagnosis')
requireValue(claudePanel.includes('/install/lark-foundation-windows.ps1'), 'Claude installation panel must expose the shared Windows installer')
requireValue(claudePanel.includes('/install/lark-foundation-macos.sh'), 'Claude installation panel must expose the shared macOS installer')
requireValue(claudePanel.indexOf('/downloads/diagnose-windows.ps1') < claudePanel.indexOf('/install/lark-foundation-windows.ps1'), 'Claude installation panel must diagnose before adding the plugin')
requireValue(!docsSource.includes('| iex'), 'public docs must not pipe a remote PowerShell script into iex')
requireOrderedSnippets(shellTerminalSource, [
  'bash "$BOOTSTRAP" --check-only',
  '"$NODE_COMMAND" "$MANAGER" preflight --json',
  '診断ではCodexとClaude Codeの両方を確認しました。',
  'bash "$BOOTSTRAP"',
], 'macOS/Linux diagnostic-first order')
requireOrderedSnippets(windowsTerminalSource, [
  'Invoke-Bootstrap -Arguments @("-CheckOnly")',
  '& $nodeForPreflight $Manager preflight --json',
  '診断ではCodexとClaude Codeの両方を確認しました。',
  'Invoke-Bootstrap -Arguments @()',
], 'Windows diagnostic-first order')
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
