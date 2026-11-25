<#
.SYNOPSIS
  Runs the same checks as .github/workflows/ci.yml, locally, and reports every failure at once.

.DESCRIPTION
  Run this before every push to main. It needs the local test database (scripts/test-db.ps1 start) for the
  database tests. A skipped database test counts as a failure, as it does in CI.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
#>
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$ai = Join-Path $root 'services\ai'
$web = Join-Path $root 'apps\web'
$failures = New-Object System.Collections.Generic.List[string]
$results = New-Object System.Collections.Generic.List[string]

function Invoke-Step([string] $Label, [scriptblock] $Block) {
    Write-Host "`n== $Label" -ForegroundColor Cyan
    & $Block
    if ($LASTEXITCODE -eq 0) {
        $results.Add("PASS  $Label")
    } else {
        $failures.Add($Label)
        $results.Add("FAIL  $Label (exit $LASTEXITCODE)")
    }
}

$env:TEST_DATABASE_URL = 'postgresql://rw:rw_dev_password@localhost:5432/rwtest'
$env:NEXT_PUBLIC_API_URL = 'http://localhost:8080'

Invoke-Step 'AI service tests (database tests included)' {
    Push-Location $ai
    try {
        $out = & (Join-Path $ai '.venv\Scripts\python.exe') -m pytest -q -rs --no-header -p no:cacheprovider 2>&1
        $out | Write-Host
        $summary = ($out | Select-Object -Last 1) -join ''
        if ($summary -match '(\d+) skipped') {
            # CI runs every database test: any skip means the database was not there.
            Write-Host "Skipped tests: $($Matches[1]). CI counts this as a failure." -ForegroundColor Yellow
            $global:LASTEXITCODE = 1
        } elseif ($LASTEXITCODE -eq 0) {
            $global:LASTEXITCODE = 0
        }
    } finally { Pop-Location }
}

Invoke-Step 'Gateway tests (Python)' {
    Push-Location $root
    try { & (Join-Path $ai '.venv\Scripts\python.exe') -m pytest services/gateway/test_gateway_py.py -q --no-header -p no:cacheprovider }
    finally { Pop-Location }
}

Invoke-Step 'Web type check' { Push-Location $web; try { npm run typecheck } finally { Pop-Location } }
Invoke-Step 'Web tests' { Push-Location $web; try { npm test } finally { Pop-Location } }
Invoke-Step 'Web build' { Push-Location $web; try { npm run build } finally { Pop-Location } }

Write-Host "`n== Summary" -ForegroundColor Cyan
$results | ForEach-Object { Write-Host $_ }
if ($failures.Count -gt 0) {
    Write-Host "`n$($failures.Count) step(s) failed. Do not push to main until this is green." -ForegroundColor Red
    exit 1
}
Write-Host "`nAll checks passed. Safe to push (with the user's OK)." -ForegroundColor Green
exit 0
