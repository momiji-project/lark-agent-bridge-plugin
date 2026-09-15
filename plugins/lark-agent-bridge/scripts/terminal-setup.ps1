#Requires -Version 5.1

[CmdletBinding()]
param(
  [ValidateSet("codex", "claude")]
  [string]$Agent,
  [string]$Workspace,
  [string]$ProfileName = "sfl-lark",
  [switch]$PersonalLark,
  [switch]$BotOnly,
  [switch]$InstallNodeLts,
  [switch]$ReuseProfile,
  [switch]$DryRun,
  [switch]$RuntimeCheckOnly
)

$ErrorActionPreference = "Stop"
$Bootstrap = Join-Path $PSScriptRoot "bootstrap-windows.ps1"
$Manager = Join-Path $PSScriptRoot "bridge-manager.mjs"
$script:BootstrapExitCode = 0

function Invoke-Bootstrap {
  param([string[]]$Arguments)
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Bootstrap @Arguments
  $script:BootstrapExitCode = $LASTEXITCODE
}

function Confirm-Action {
  param(
    [string]$Prompt,
    [bool]$Default = $false
  )
  $answer = Read-Host $Prompt
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer -match "^(y|yes|はい)$"
}

function Refresh-ProcessPath {
  $currentPath = $env:Path
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = (@($machinePath, $userPath, $currentPath) | Where-Object { $_ }) -join ";"
}

function Resolve-Application {
  param([string[]]$Names)
  foreach ($name in $Names) {
    $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
  }
  return $null
}

function Test-AgentLoggedIn {
  param(
    [string]$AgentName,
    [string]$AgentCommand
  )
  try {
    if ($AgentName -eq "codex") {
      & $AgentCommand login status *> $null
      return $LASTEXITCODE -eq 0
    }
    $raw = (& $AgentCommand auth status 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return $false }
    $status = $raw | ConvertFrom-Json
    return $status.loggedIn -eq $true
  } catch {
    return $false
  }
}

function Confirm-AgentLogin {
  param(
    [string]$AgentName,
    [string]$AgentCommand
  )
  if (Test-AgentLoggedIn -AgentName $AgentName -AgentCommand $AgentCommand) { return }
  if ($DryRun) {
    Write-Host "[dry-run] $AgentNameのログインが必要です。"
    return
  }
  if (-not (Confirm-Action -Prompt "$AgentNameにログインしてから続行しますか？ [y/N]")) {
    throw "$AgentNameが未ログインのため、PCを変更せず終了しました。"
  }
  if ($AgentName -eq "codex") {
    & $AgentCommand login
  } else {
    & $AgentCommand auth login
  }
  if ($LASTEXITCODE -ne 0 -or -not (Test-AgentLoggedIn -AgentName $AgentName -AgentCommand $AgentCommand)) {
    throw "$AgentNameのログインを確認できませんでした。ログイン後に再実行してください。"
  }
}

function Set-ProfileLarkEnvironment {
  param(
    [string]$BridgeHome,
    [string]$BridgeProfile
  )
  $env:LARK_CHANNEL = "1"
  $env:LARK_CHANNEL_HOME = $BridgeHome
  $env:LARK_CHANNEL_PROFILE = $BridgeProfile
  $env:LARK_CHANNEL_CONFIG = Join-Path $BridgeHome "profiles\$BridgeProfile\lark-cli-source\config.json"
  $env:LARKSUITE_CLI_CONFIG_DIR = Join-Path $BridgeHome "profiles\$BridgeProfile\lark-cli"
  $env:LARKSUITE_CLI_NO_UPDATE_NOTIFIER = "1"
  $env:LARKSUITE_CLI_NO_SKILLS_NOTIFIER = "1"
}

function Test-ProfileUserReady {
  param(
    [string]$LarkCli,
    [string]$BridgeHome,
    [string]$BridgeProfile
  )
  Set-ProfileLarkEnvironment -BridgeHome $BridgeHome -BridgeProfile $BridgeProfile
  try {
    $raw = (& $LarkCli auth status --json --verify 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return $false }
    $status = $raw | ConvertFrom-Json
    $user = $status.identities.user
    if ($null -eq $user -or $user.available -ne $true) { return $false }
    $identityReady = $user.verified -eq $true -or $user.tokenStatus -eq "valid" -or $user.status -eq "ready"
    $scopes = if ($user.scope) { @($user.scope -split "\s+" | Where-Object { $_ }) } else { @() }
    return $identityReady -and
      $scopes.Contains("minutes:minutes.basic:read") -and
      $scopes.Contains("minutes:minutes.search:read") -and
      $scopes.Contains("docx:document:create")
  } catch {
    return $false
  }
}

function Get-JsonValue {
  param(
    [Parameter(Mandatory = $true)]$InputObject,
    [Parameter(Mandatory = $true)][string[]]$Names,
    [int]$Depth = 0
  )
  if ($null -eq $InputObject -or $Depth -gt 5) { return $null }
  foreach ($name in $Names) {
    $property = $InputObject.PSObject.Properties[$name]
    if ($null -ne $property -and $property.Value -is [string] -and -not [string]::IsNullOrWhiteSpace($property.Value)) {
      return $property.Value
    }
  }
  foreach ($property in $InputObject.PSObject.Properties) {
    if ($property.Value -is [string] -or $null -eq $property.Value) { continue }
    $found = Get-JsonValue -InputObject $property.Value -Names $Names -Depth ($Depth + 1)
    if ($found) { return $found }
  }
  return $null
}

function Enable-PersonalLarkAccess {
  param(
    [string]$LarkCli,
    [string]$BridgeHome,
    [string]$BridgeProfile
  )
  if (Test-ProfileUserReady -LarkCli $LarkCli -BridgeHome $BridgeHome -BridgeProfile $BridgeProfile) {
    Write-Host "Minutes・Larkドキュメント用のユーザー認証は確認済みです。"
    return
  }

  Write-Host ""
  Write-Host "MinutesとLarkドキュメントを使うため、QR方式のLarkユーザー認証を行います。"
  Set-ProfileLarkEnvironment -BridgeHome $BridgeHome -BridgeProfile $BridgeProfile
  $authDir = Join-Path ([IO.Path]::GetTempPath()) ("lark-bridge-auth-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $authDir | Out-Null
  try {
    $authFile = Join-Path $authDir "auth.json"
    $completionFile = Join-Path $authDir "completion.json"
    & $LarkCli auth login --domain minutes --domain docs --no-wait --json 1> $authFile
    if ($LASTEXITCODE -ne 0) { throw "Larkユーザー認証の開始に失敗しました。" }
    $auth = Get-Content -LiteralPath $authFile -Raw | ConvertFrom-Json
    $verificationUrl = Get-JsonValue -InputObject $auth -Names @("verification_uri_complete", "verification_url", "verification_uri", "url")
    $deviceCode = Get-JsonValue -InputObject $auth -Names @("device_code", "deviceCode")
    if (-not $verificationUrl -or -not $deviceCode) { throw "認証URLを取得できませんでした。" }

    Write-Host ""
    Write-Host "QRコードをLarkを利用する端末で読み取り、許可してください。"
    Write-Host "QRを読み取れない場合は、次の同じ認証URLを開けます。"
    Write-Host $verificationUrl
    $qrPath = Join-Path $authDir "lark-auth.png"
    $qrCreated = $false
    Push-Location $authDir
    try {
      & $LarkCli auth qrcode $verificationUrl --output "lark-auth.png" *> $null
      if ($LASTEXITCODE -eq 0) {
        $qrCreated = $true
        Write-Host "QRコード: $qrPath"
      }
    } finally {
      Pop-Location
    }
    if ($qrCreated) {
      try { Start-Process $qrPath | Out-Null } catch { }
    } else {
      Write-Host "QRコード画像を生成できなかったため、上記URLを使用してください。"
    }

    Write-Host "承認を待っています。このPowerShellは閉じないでください。"
    & $LarkCli auth login --device-code $deviceCode --json 1> $completionFile
    if ($LASTEXITCODE -ne 0) { throw "Larkユーザー認証が完了しませんでした。" }
    if (-not (Test-ProfileUserReady -LarkCli $LarkCli -BridgeHome $BridgeHome -BridgeProfile $BridgeProfile)) {
      throw "認証後の権限確認に失敗しました。MinutesとDocsの許可状態を確認して再実行してください。"
    }
    Write-Host "Minutes・Larkドキュメント用のユーザー認証が完了しました。"
  } finally {
    if (Test-Path -LiteralPath $authDir) { Remove-Item -LiteralPath $authDir -Recurse -Force }
  }
}

if (-not (Test-Path -LiteralPath $Bootstrap -PathType Leaf) -or -not (Test-Path -LiteralPath $Manager -PathType Leaf)) {
  Write-Error "Plugin files are incomplete. Reinstall lark-agent-bridge before continuing."
  exit 2
}
if ($PersonalLark -and $BotOnly) {
  Write-Error "Use either -PersonalLark or -BotOnly, not both."
  exit 2
}

Invoke-Bootstrap -Arguments @("-CheckOnly")
$runtimeStatus = $script:BootstrapExitCode
if ($RuntimeCheckOnly) { exit $runtimeStatus }

if ($runtimeStatus -ne 0 -and -not $InstallNodeLts) {
  Write-Host ""
  Write-Host "Node.jsとnpmが必要です。Node.js LTSをこのPCへ導入します。"
  if (Confirm-Action -Prompt "続行しますか？ [y/N]") {
    $InstallNodeLts = $true
  } else {
    Write-Host "Node.jsの導入を行わず終了しました。Lark CLIとBridgeは変更していません。"
    exit 20
  }
}

if ($runtimeStatus -ne 0) {
  if ($DryRun) {
    Invoke-Bootstrap -Arguments @("-InstallNodeLts", "-RuntimeOnly", "-DryRun")
    if ($script:BootstrapExitCode -ne 0) { exit $script:BootstrapExitCode }
    Write-Host "[dry-run] Runtime installation must finish before profile setup can continue."
    exit 0
  }
  Invoke-Bootstrap -Arguments @("-InstallNodeLts", "-RuntimeOnly")
  if ($script:BootstrapExitCode -ne 0) { exit $script:BootstrapExitCode }
}

Refresh-ProcessPath
if (${env:ProgramFiles}) { $env:Path = "$(Join-Path ${env:ProgramFiles} 'nodejs');$env:Path" }

$nodeForPreflight = Resolve-Application -Names @("node.exe", "node")
if (-not $nodeForPreflight) {
  throw "Node.jsの導入後もnodeコマンドを確認できません。新しいPowerShellで同じセットアップを再実行してください。"
}
Write-Host ""
Write-Host "Lark接続基盤の自動診断を行います（この段階では設定を変更しません）。"
& $nodeForPreflight $Manager preflight --json
if ($LASTEXITCODE -ne 0) {
  Write-Host "診断で不足または不整合が見つかりました。合格済みの項目は再利用し、不足分だけを次の工程で整えます。"
}

if (-not $Agent) {
  $codex = Resolve-Application -Names @("codex.exe", "codex.cmd", "codex")
  $claude = Resolve-Application -Names @("claude.exe", "claude.cmd", "claude")
  if ($codex -and -not $claude) {
    $Agent = "codex"
  } elseif ($claude -and -not $codex) {
    $Agent = "claude"
  } elseif ($codex -and $claude) {
    $choice = Read-Host "診断ではCodexとClaude Codeの両方を確認しました。Bridgeへ接続する方を選んでください。1=Codex、2=Claude Code [1]"
    $Agent = if ($choice -eq "2") { "claude" } else { "codex" }
  } else {
    throw "CodexまたはClaude Codeが見つかりません。先に利用するエージェントを導入してください。"
  }
}
$agentCommand = Resolve-Application -Names @("$Agent.exe", "$Agent.cmd", $Agent)
if (-not $agentCommand) { throw "$Agent is not installed or not available after the diagnostic." }

Confirm-AgentLogin -AgentName $Agent -AgentCommand $agentCommand

if ($DryRun) {
  Invoke-Bootstrap -Arguments @("-DryRun")
} else {
  Invoke-Bootstrap -Arguments @()
}
if ($script:BootstrapExitCode -ne 0) { exit $script:BootstrapExitCode }

if (-not $Workspace) {
  $defaultWorkspace = (Get-Location).Path
  $workspaceInput = Read-Host "Bridgeで利用する作業フォルダ [$defaultWorkspace]"
  $Workspace = if ([string]::IsNullOrWhiteSpace($workspaceInput)) { $defaultWorkspace } else { $workspaceInput }
}
if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) {
  Write-Error "Workspace does not exist: $Workspace"
  exit 31
}
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
$homePath = [Environment]::GetFolderPath("UserProfile")
$tempPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd("\")
$workspaceNormalized = $Workspace.TrimEnd("\")
$rootPath = [IO.Path]::GetPathRoot($workspaceNormalized).TrimEnd("\")
if (
  $workspaceNormalized -ieq $homePath.TrimEnd("\") -or
  $workspaceNormalized -ieq $rootPath -or
  $workspaceNormalized -ieq $tempPath -or
  $workspaceNormalized.StartsWith("$tempPath\", [StringComparison]::OrdinalIgnoreCase)
) {
  Write-Error "安全のため、このフォルダはworkspaceに指定できません: $Workspace"
  exit 31
}

if ($ProfileName -notmatch "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$") {
  Write-Error "Profile name must use 1-64 letters, digits, hyphens, or underscores."
  exit 2
}

$larkCliIdentity = "bot-only"
if ($PersonalLark) {
  $larkCliIdentity = "user-default"
} elseif (-not $BotOnly) {
  if (Confirm-Action -Prompt "このBridgeを議事録（Minutes・Larkドキュメント）にも使いますか？ [y/N]") {
    $larkCliIdentity = "user-default"
  }
}

$bridge = Resolve-Application -Names @("lark-channel-bridge.cmd", "lark-channel-bridge.exe", "lark-channel-bridge")
$node = Resolve-Application -Names @("node.exe", "node")
$larkCli = Resolve-Application -Names @("lark-cli.cmd", "lark-cli.exe", "lark-cli")
$bridgeHome = if ($env:LARK_CHANNEL_HOME) { $env:LARK_CHANNEL_HOME } else { Join-Path ([Environment]::GetFolderPath("UserProfile")) ".lark-channel" }
if (-not $bridge -or -not $node -or -not $larkCli) {
  Write-Error "Bridge, Lark CLI, or Node.js is not available after installation. Open a new terminal and rerun this command."
  exit 32
}

$profileOutput = & $bridge profile list 2>$null
$escapedProfile = [regex]::Escape($ProfileName)
$profileExists = ($profileOutput | Where-Object { $_ -match "(^|\s)$escapedProfile(\s|$)" }).Count -gt 0
$profileWasRunning = $false
if ($profileExists) {
  $profileStatus = (& $bridge status --profile $ProfileName 2>$null | Out-String)
  $profileWasRunning = $profileStatus -match "正在后台运行|is (currently )?running in the background|background service is running|バックグラウンドで実行中|(^|\s)(process\s*id|pid|プロセス\s*id)\s*[:=]\s*\d+"
}
if ($profileExists -and -not $ReuseProfile) {
  if (Confirm-Action -Prompt "既存プロファイル $ProfileName を再利用しますか？ [y/N]") {
    $ReuseProfile = $true
  } else {
    Write-Host "既存プロファイルを変更せず終了しました。別名は -ProfileName NAME で指定できます。"
    exit 33
  }
}

Write-Host ""
Write-Host "実行内容"
Write-Host "  Agent: $Agent"
Write-Host "  Workspace: $Workspace"
Write-Host "  Profile: $ProfileName"
Write-Host "  Lark access: $larkCliIdentity"

if ($DryRun) {
  Write-Host "[dry-run] Profile registration, permission preset, daemon start, and connectivity checks were not executed."
  exit 0
}

if (-not $profileExists) {
  & $bridge profile create $ProfileName --agent $Agent --workspace $Workspace
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($larkCliIdentity -eq "user-default") {
  Enable-PersonalLarkAccess -LarkCli $larkCli -BridgeHome $bridgeHome -BridgeProfile $ProfileName
}
$presetArguments = @(
  $Manager, "preset",
  "--profile", $ProfileName,
  "--preset", "safe-edit",
  "--agent", $Agent,
  "--workspace", $Workspace,
  "--lark-cli-identity", $larkCliIdentity
)
if ($larkCliIdentity -eq "user-default") { $presetArguments += "--confirm-user-default" }
& $node @presetArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($profileWasRunning) {
  & $bridge restart --profile $ProfileName
} else {
  & $bridge start --profile $ProfileName
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $node $Manager doctor --profile $ProfileName --json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $bridge status --profile $ProfileName
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "ターミナル側の設定は完了しました。LarkでBotへ /status を送り、返信を確認してください。"
