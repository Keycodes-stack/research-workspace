<#
.SYNOPSIS
  Local Postgres + pgvector for the database tests, with the same settings CI uses.

.DESCRIPTION
  Needs Docker Desktop running. The tests DROP and recreate the public schema, so this is a throwaway database
  on localhost only. It never points at the live database.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\test-db.ps1 start
  powershell -ExecutionPolicy Bypass -File .\scripts\test-db.ps1 stop
  powershell -ExecutionPolicy Bypass -File .\scripts\test-db.ps1 remove
#>
param(
    [ValidateSet('start', 'stop', 'remove', 'status')]
    [string] $Action = 'start'
)

$ErrorActionPreference = 'Stop'
$name = 'rw-test-db'
$image = 'pgvector/pgvector:pg16'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is not installed or not on PATH. Install Docker Desktop, start it, and run this again.'
}
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) { throw 'Docker is installed but not running. Start Docker Desktop and try again.' }

$exists = (docker ps -a --filter "name=^$name$" --format '{{.Names}}') -eq $name

switch ($Action) {
    'start' {
        if ($exists) {
            docker start $name | Out-Null
        } else {
            docker run -d --name $name `
                -e POSTGRES_USER=rw -e POSTGRES_PASSWORD=rw_dev_password -e POSTGRES_DB=rwtest `
                -p 5432:5432 $image | Out-Null
        }
        for ($i = 0; $i -lt 30; $i++) {
            cmd /c "docker exec $name pg_isready -U rw >nul 2>&1"
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 1
        }
        if ($LASTEXITCODE -ne 0) { throw 'The test database did not become ready in 30 seconds.' }
        Write-Host 'Test database ready: postgresql://rw:rw_dev_password@localhost:5432/rwtest' -ForegroundColor Green
    }
    'stop' {
        if ($exists) { docker stop $name | Out-Null; Write-Host 'Stopped.' }
    }
    'remove' {
        if ($exists) { docker rm -f $name | Out-Null; Write-Host 'Removed.' }
    }
    'status' {
        if ($exists) { docker ps -a --filter "name=^$name$" } else { Write-Host 'Not created yet.' }
    }
}
