@echo off
setlocal EnableExtensions
title Keycodes Research Workspace Launcher

rem Everything is resolved relative to this file, so the folder can live anywhere.
set "ROOT=%~dp0"
set "AI_DIR=%ROOT%services\ai"
set "GW_DIR=%ROOT%services\gateway"
set "WEB_DIR=%ROOT%apps\web"
set "PY=%AI_DIR%\.venv\Scripts\python.exe"
set "AI_PORT=8001"
set "WEB_PORT=3000"

rem Port 3000 may belong to another project on this machine: fall back to 3001 (allowed by CORS_ORIGINS).
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul && set "WEB_PORT=3001"

echo ===================================================
echo   Keycodes AI Research Workspace
echo ===================================================

if not exist "%ROOT%.env" (
  echo [ERROR] %ROOT%.env not found. Copy .env.example to .env and fill it in.
  pause & exit /b 1
)
if not exist "%PY%" (
  echo [ERROR] Python virtual environment missing: %PY%
  echo         Create it:  cd services\ai ^&^& python -m venv .venv ^&^& .venv\Scripts\python.exe -m pip install -r requirements.txt
  pause & exit /b 1
)
if not exist "%WEB_DIR%\node_modules" (
  echo [setup] Installing web dependencies ^(first run only^)...
  pushd "%WEB_DIR%" & call npm install & popd
)

rem "python -m uvicorn" instead of uvicorn.exe: the .exe shims of a copied venv point at the machine it was built on.
echo [1/3] Starting AI backend on port %AI_PORT% ^(loads the embedding model, ~1 minute on first start^)...
start "AI Backend (%AI_PORT%)" /D "%AI_DIR%" cmd /k ""%PY%" -m uvicorn app.main:app --port %AI_PORT%"

echo [2/3] Starting gateway on port 8080...
start "Gateway (8080)" /D "%GW_DIR%" cmd /k ""%PY%" gateway.py"

echo [3/3] Starting web frontend on port %WEB_PORT%...
start "Web (%WEB_PORT%)" /D "%WEB_DIR%" cmd /k "npm run dev -- -p %WEB_PORT%"

echo.
echo Waiting for the AI backend to become healthy...
set /a tries=0
:wait
set /a tries+=1
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:%AI_PORT%/health).StatusCode -eq 200}catch{exit 1}" >nul 2>&1
if %errorlevel%==0 goto ready
if %tries% GEQ 60 (
  echo [WARN] The AI backend did not answer after 3 minutes. Check its window for errors.
  goto open
)
timeout /t 3 >nul
goto wait

:ready
echo AI backend is up.

:open
rem Mint a short-lived sign-in token from JWT_SECRET and pass it in the URL fragment (never sent to a server).
for /f "usebackq delims=" %%T in (`"%PY%" "%GW_DIR%\mint_token.py" --raw`) do set "KC_TOKEN=%%T"
if defined KC_TOKEN (
  start "" "http://localhost:%WEB_PORT%/#kc_token=%KC_TOKEN%"
) else (
  echo [WARN] Could not mint a token. Open http://localhost:%WEB_PORT% and paste one from: python services\gateway\mint_token.py
  start "" "http://localhost:%WEB_PORT%"
)
endlocal
