# مزامنة shared/ → renderer/shared/ (مصدر واحد للحقيقتين)
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot '..\shared'
$dst = Join-Path $PSScriptRoot 'renderer\shared'

if (Test-Path $dst) {
    Remove-Item -Recurse -Force $dst
}
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item -Recurse -Force "$src\*" $dst
Write-Output "shared synced -> $dst"
