<#
.SYNOPSIS
  Deploy the backend to the VPS in one command: upload services/, rebuild, wait until healthy.

.DESCRIPTION
  The frontend is NOT deployed here: Render redeploys it on every push to main.
  .env files are never uploaded; the VPS keeps its own /root/app/.env.
  You are asked for the VPS password twice (upload, then rebuild) unless you use an SSH key.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy-vps.ps1
  powershell -ExecutionPolicy Bypass -File .\deploy-vps.ps1 -Services ai,gateway
#>
param(
    [ValidateSet('ai', 'gateway')]
    [string[]] $Services = @('ai'),
    [string] $Server = 'root@162.35.31.162',
    [string] $RemoteDir = '/root/app'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

foreach ($tool in 'ssh', 'tar') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed or not on PATH." }
}
if (-not (Test-Path 'services')) { throw "No services folder next to this script ($PSScriptRoot)." }

# Deploying uncommitted code is allowed, but say so: the VPS would then run code that is not on GitHub.
$dirty = git status --porcelain -- services 2>$null
if ($dirty) {
    Write-Warning "services/ has uncommitted changes; they will be deployed too:"
    $dirty | ForEach-Object { Write-Host "    $_" }
}

Write-Host "`n[1/2] Uploading services/ to ${Server}:$RemoteDir ..." -ForegroundColor Cyan
# cmd /c keeps the tar stream binary-safe (Windows PowerShell 5.1 pipes would corrupt it).
cmd /c "tar -czf - --exclude=.venv --exclude=__pycache__ --exclude=.pytest_cache --exclude=.env services | ssh $Server tar -xzf - -C $RemoteDir"
if ($LASTEXITCODE -ne 0) { throw "Upload failed (exit $LASTEXITCODE). Nothing was rebuilt." }

Write-Host "`n[2/2] Rebuilding $($Services -join ', ') and waiting until healthy ..." -ForegroundColor Cyan
$remote = @'
set -e
cd __DIR__
C="docker compose -f docker-compose.vps.yml"
$C up -d --build __SERVICES__
for svc in __SERVICES__; do
  echo "Waiting for $svc ..."
  ok=""
  for i in $(seq 1 36); do
    cid=$($C ps -q $svc)
    st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo missing)
    case "$st" in
      healthy|running) echo "$svc: $st"; ok=1; break ;;
      unhealthy|exited|dead|missing) break ;;
    esac
    sleep 5
  done
  if [ -z "$ok" ]; then
    echo "$svc did not become healthy (last state: $st). Last log lines:"
    $C logs --tail 40 $svc
    exit 1
  fi
done
$C ps
'@
$remote = $remote.Replace('__DIR__', $RemoteDir).Replace('__SERVICES__', ($Services -join ' '))
# The script goes over stdin; tr strips the Windows line endings PowerShell adds.
$remote | ssh $Server "tr -d '\r' | bash -s"
if ($LASTEXITCODE -ne 0) { throw "Rebuild or health check failed (exit $LASTEXITCODE). See the log lines above." }

Write-Host "`nDeployed: $($Services -join ', ') is healthy on $Server." -ForegroundColor Green
