@echo off
title Keycodes Research Workspace - Halden Improved UI
echo ===================================================
echo   Starting Keycodes AI - Halden Improved Workspace
echo ===================================================

:: 1. Start AI Backend on Port 8001
echo [1/3] Starting AI Backend (Port 8001)...
start "AI Backend (8001)" cmd /k "cd /d D:\research-workspace-complete-improved-ui\research-workspace\services\ai && .\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8001"

:: 2. Start Gateway Proxy on Port 8080
echo [2/3] Starting Gateway Proxy (Port 8080)...
start "Gateway Proxy (8080)" cmd /k "cd /d D:\research-workspace-complete-improved-ui\research-workspace\services\ai && .\.venv\Scripts\python.exe ..\gateway\gateway.py"

:: 3. Start Next.js Frontend (Port 3001 or auto)
echo [3/3] Starting Next.js Web Frontend with Halden View...
start "Web Frontend (Halden Improved UI)" cmd /k "cd /d D:\research-workspace-complete-improved-ui\research-workspace\apps\web && npx next dev -p 3001"

echo ===================================================
echo Services launching!
echo Original project: http://localhost:3000
echo Improved UI project: http://localhost:3001/intelligence
echo Opening browser in 5 seconds...
echo ===================================================
timeout /t 5 >nul
start http://localhost:3001/intelligence
start http://localhost:3001/
