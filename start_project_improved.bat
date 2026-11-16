
@echo off
setlocal

title Keycodes AI - Halden Improved Workspace

set "ROOT=C:\Users\dell\OneDrive\Desktop\keycodes\research-workspace\research-workspace"
set "AI=%ROOT%\services\ai"
set "WEB=%ROOT%\apps\web"
set "GATEWAY=%ROOT%\services\gateway"

echo ===================================================
echo Starting Keycodes AI - Halden Improved Workspace
echo ===================================================

:: Start AI Backend
echo [1/3] Starting AI Backend on Port 8001...
start "AI Backend (8001)" cmd /k "cd /d "%AI%" && .\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8001"

:: Start Gateway
echo [2/3] Starting Gateway Proxy on Port 8080...
start "Gateway Proxy (8080)" cmd /k "cd /d "%AI%" && .\.venv\Scripts\python.exe "%GATEWAY%\gateway.py""

:: Start Frontend
echo [3/3] Starting Next.js Frontend on Port 3001...
start "Web Frontend (3001)" cmd /k "cd /d "%WEB%" && npx next dev -p 3001"

echo ===================================================
echo Startup commands launched.
echo Improved UI: http://localhost:3001/intelligence
echo ===================================================

timeout /t 5 >nul
start http://localhost:3001/intelligence

endlocal
