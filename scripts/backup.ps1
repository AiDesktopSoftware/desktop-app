# Local backup + milestone tag: two layers of protection.
# Usage: npm run backup

$ErrorActionPreference = "Stop"

$source = Split-Path -Parent $PSScriptRoot
$root = "E:\programFiles\traeCode\_backups\project3P"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $root $stamp

# 1) File snapshot: copy outside the repo, skip deps and build output.
New-Item -ItemType Directory -Path $target -Force | Out-Null
robocopy $source $target /E /XD node_modules out dist .git /NFL /NDL /NJH /NJS /NP | Out-Null

if ($LASTEXITCODE -ge 8) {
    Write-Output "BACKUP FAILED: robocopy exit code $LASTEXITCODE"
    exit 1
}

# Keep only the latest 20 snapshots.
Get-ChildItem $root -Directory |
    Sort-Object Name -Descending |
    Select-Object -Skip 20 |
    Remove-Item -Recurse -Force

Write-Output "snapshot: $target"

# 2) Git tag: points at the current commit, always recoverable.
Set-Location $source
$tag = "snapshot/$stamp"
git tag $tag
Write-Output "tag: $tag"

# Pushing the tag needs the proxy.
if ((Test-NetConnection -ComputerName 127.0.0.1 -Port 7897 -WarningAction SilentlyContinue).TcpTestSucceeded) {
    $env:HTTPS_PROXY = "http://127.0.0.1:7897"
    $env:HTTP_PROXY = "http://127.0.0.1:7897"
}

git push origin $tag
if ($LASTEXITCODE -ne 0) {
    Write-Output "WARNING: tag kept locally but push failed (check the proxy on port 7897)"
} else {
    Write-Output "tag pushed to origin"
}
