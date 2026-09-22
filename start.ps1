$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Get-Command node.exe -ErrorAction SilentlyContinue

if (-not $node) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "未找到 Node.js。请先安装 Node.js 20 或更高版本。",
    "中国象棋",
    "OK",
    "Warning"
  ) | Out-Null
  exit 1
}

Set-Location -LiteralPath $root
& $node.Source "server.js"
