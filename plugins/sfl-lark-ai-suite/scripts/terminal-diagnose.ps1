#Requires -Version 5.1

[CmdletBinding()]
param(
  [switch]$SyntaxCheckOnly
)

$ErrorActionPreference = "Continue"
$Bootstrap = Join-Path $PSScriptRoot "bootstrap-windows.ps1"
$Manager = Join-Path $PSScriptRoot "bridge-manager.mjs"

function Resolve-Application {
  param([string[]]$Names)
  foreach ($name in $Names) {
    $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
  }
  return $null
}

if ($SyntaxCheckOnly) {
  Write-Host "Windows diagnostic script syntax check passed."
  exit 0
}

Write-Host "【Lark接続環境の診断】"
Write-Host "このコマンドは読み取り専用です。インストール・更新・設定変更・起動・再起動は行いません。"
Write-Host ""

if (-not (Test-Path -LiteralPath $Bootstrap -PathType Leaf) -or -not (Test-Path -LiteralPath $Manager -PathType Leaf)) {
  Write-Error "Pluginの診断ファイルが不足しています。sfl-lark-ai-suite Plugin本体を確認してください。"
  exit 2
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Bootstrap -CheckOnly
$runtimeStatus = $LASTEXITCODE

Write-Host ""
Write-Host "【Lark公式CLI・Bridge・AIエージェント】"
$node = Resolve-Application -Names @("node.exe", "node")
if ($node) {
  & $node $Manager preflight --json
} else {
  foreach ($item in @(
    @{ Label = "codex"; Names = @("codex.exe", "codex.cmd", "codex") },
    @{ Label = "claude"; Names = @("claude.exe", "claude.cmd", "claude") },
    @{ Label = "lark-cli"; Names = @("lark-cli.exe", "lark-cli.cmd", "lark-cli") },
    @{ Label = "lark-channel-bridge"; Names = @("lark-channel-bridge.exe", "lark-channel-bridge.cmd", "lark-channel-bridge") }
  )) {
    $application = Resolve-Application -Names $item.Names
    if ($application) {
      $version = (& $application --version 2>$null | Select-Object -First 1)
      $suffix = if ($version) { " ($version)" } else { "" }
      Write-Host "○ $($item.Label): 検出済み$suffix"
    } else {
      Write-Host "△ $($item.Label): 未検出"
    }
  }
}

$bridge = Resolve-Application -Names @("lark-channel-bridge.exe", "lark-channel-bridge.cmd", "lark-channel-bridge")
if ($bridge) {
  Write-Host ""
  Write-Host "【既存Bridgeの読取確認】"
  & $bridge profile list 2>&1
  & $bridge ps 2>&1
} else {
  Write-Host ""
  Write-Host "BridgeコマンドはPATH上で未検出のため、プロファイルと常駐状態の読取確認は省略しました。"
}

Write-Host ""
Write-Host "診断は完了しました。PCの状態は変更していません。"
if ($runtimeStatus -ne 0) {
  Write-Host "Node.js/npmに不足があります。導入を行う場合のみ、診断結果の後に `$lark-setup を実行してください。"
} else {
  Write-Host "不足・不整合が表示された場合だけ、次に `$lark-setup を実行します。"
}

exit 0

