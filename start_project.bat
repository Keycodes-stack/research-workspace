@echo off
title Keycodes Research Workspace Launcher
echo ===================================================
echo   Starting Keycodes AI Research Workspace...
echo ===================================================

:: 1. Start AI Backend on Port 8001
echo [1/3] Starting AI Backend (Port 8001)...
start "AI Backend (8001)" cmd /k "cd /d D:\research-workspace-complete\research-workspace\services\ai && .\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8001"

:: 2. Start Gateway Proxy on Port 8080
echo [2/3] Starting Gateway Proxy (Port 8080)...
start "Gateway Proxy (8080)" cmd /k "cd /d D:\research-workspace-complete\research-workspace\services\ai && .\.venv\Scripts\python.exe ..\gateway\gateway.py"

:: 3. Start Next.js Frontend on Port 3000
echo [3/3] Starting Next.js Web Frontend (Port 3000)...
start "Web Frontend (3000)" cmd /k "cd /d D:\research-workspace-complete\research-workspace\apps\web && npm run dev"

echo ===================================================
echo All services launched successfully!
echo Opening browser in 5 seconds...
echo ===================================================
timeout /t 5 >nul
start http://localhost:3000
