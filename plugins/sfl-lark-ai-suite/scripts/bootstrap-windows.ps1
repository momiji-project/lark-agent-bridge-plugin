#Requires -Version 5.1

[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$InstallNodeLts,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$MinimumNodeVersion = [version]"20.12.0"
$Manager = Join-Path $PSScriptRoot "bridge-manager.mjs"

function Resolve-CommandPath {
  param(
    [string[]]$Names,
    [string[]]$Candidates = @()
  )

  foreach ($name in $Names) {
    $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
  }
  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
  }
  return $null
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = (@($machinePath, $userPath) | Where-Object { $_ }) -join ";"
}

function Get-RuntimeState {
  param([switch]$PreferOfficialLocation)

  $programFilesNode = if (${env:ProgramFiles}) { Join-Path ${env:ProgramFiles} "nodejs\node.exe" } else { $null }
  $programFilesNpm = if (${env:ProgramFiles}) { Join-Path ${env:ProgramFiles} "nodejs\npm.cmd" } else { $null }
  $nodeCandidates = if ($PreferOfficialLocation) { @($programFilesNode) } else { @() }
  $npmCandidates = if ($PreferOfficialLocation) { @($programFilesNpm) } else { @() }

  $node = Resolve-CommandPath -Names @("node.exe", "node") -Candidates $nodeCandidates
  if ($PreferOfficialLocation -and $programFilesNode -and (Test-Path -LiteralPath $programFilesNode)) {
    $node = $programFilesNode
  }
  $npm = Resolve-CommandPath -Names @("npm.cmd", "npm.exe", "npm") -Candidates $npmCandidates
  if ($PreferOfficialLocation -and $programFilesNpm -and (Test-Path -LiteralPath $programFilesNpm)) {
    $npm = $programFilesNpm
  }

  $nodeVersion = $null
  if ($node) {
    try {
      $rawVersion = & $node --version 2>$null
      if ($LASTEXITCODE -eq 0 -and $rawVersion) {
        $nodeVersion = [version]($rawVersion.Trim().TrimStart("v").Split("-")[0])
      }
    } catch {
      $nodeVersion = $null
    }
  }
  $npmAvailable = $false
  $npmVersion = $null
  if ($npm) {
    try {
      $rawNpmVersion = & $npm --version 2>$null
      if ($LASTEXITCODE -eq 0 -and $rawNpmVersion) {
        $npmVersion = $rawNpmVersion.Trim()
        $npmAvailable = $true
      }
    } catch {
      $npmAvailable = $false
    }
  }

  [pscustomobject]@{
    Node = $node
    NodeVersion = $nodeVersion
    Npm = $npm
    NpmVersion = $npmVersion
    Ready = ($null -ne $nodeVersion -and $nodeVersion -ge $MinimumNodeVersion -and $npmAvailable)
  }
}

function Write-RuntimeState {
  param($State)
  Write-Host "[bootstrap] OS: Windows ($([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture))"
  if ($State.NodeVersion) { Write-Host "[bootstrap] Node.js: v$($State.NodeVersion) ($($State.Node))" }
  else { Write-Host "[bootstrap] Node.js: not found or unreadable" }
  if ($State.NpmVersion) { Write-Host "[bootstrap] npm: $($State.NpmVersion) ($($State.Npm))" }
  else { Write-Host "[bootstrap] npm: not found" }
}

$runtime = Get-RuntimeState
Write-RuntimeState $runtime

if ($CheckOnly) {
  if ($runtime.Ready) {
    Write-Host "[bootstrap] Runtime check passed."
    exit 0
  }
  Write-Error "Node.js $MinimumNodeVersion or newer with npm is required."
  exit 20
}

if (-not $runtime.Ready) {
  if (-not $InstallNodeLts) {
    Write-Error "Node.js $MinimumNodeVersion or newer with npm is required. Rerun with -InstallNodeLts only after the user approves the system change."
    exit 20
  }
  if ($DryRun) {
    Write-Host "[dry-run] Install the official Node.js LTS package with Windows Package Manager, then install the official Lark CLI before lark-channel-bridge."
    exit 0
  }

  $winget = Resolve-CommandPath -Names @("winget.exe", "winget") -Candidates @(
    $(if (${env:LOCALAPPDATA}) { Join-Path ${env:LOCALAPPDATA} "Microsoft\WindowsApps\winget.exe" } else { $null })
  )
  if (-not $winget) {
    Write-Error "Windows Package Manager (winget) is unavailable. Install the official Node.js LTS package, reopen the terminal, and rerun setup. No Bridge package was installed."
    exit 21
  }

  $verb = if ($runtime.NodeVersion) { "upgrade" } else { "install" }
  Write-Host "[bootstrap] Installing the official Node.js LTS package with winget..."
  & $winget $verb --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) {
    Write-Error "winget could not install Node.js LTS (exit $LASTEXITCODE). No Bridge package was installed."
    exit 22
  }

  Refresh-ProcessPath
  if (${env:ProgramFiles}) { $env:Path = "$(Join-Path ${env:ProgramFiles} 'nodejs');$env:Path" }
  $runtime = Get-RuntimeState -PreferOfficialLocation
  Write-RuntimeState $runtime
  if (-not $runtime.Ready) {
    Write-Error "Node.js was installed but is not visible yet. Open a new terminal and rerun setup. No Bridge package was installed."
    exit 23
  }
}

$env:LARK_BRIDGE_MANAGER_NPM = $runtime.Npm
$managerArguments = @($Manager, "install")
if ($DryRun) { $managerArguments += "--dry-run" }
& $runtime.Node @managerArguments
exit $LASTEXITCODE
