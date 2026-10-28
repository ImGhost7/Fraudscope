@echo off
title Fraudscope AI — Demo Launcher
color 0B
echo.
echo  ███████╗██╗   ██╗███╗   ██╗██████╗ ████████╗██████╗  █████╗  ██████╗███████╗
echo  ██╔════╝██║   ██║████╗  ██║██╔══██╗╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔════╝
echo  █████╗  ██║   ██║██╔██╗ ██║██║  ██║   ██║   ██████╔╝███████║██║     █████╗
echo  ██╔══╝  ██║   ██║██║╚██╗██║██║  ██║   ██║   ██╔══██╗██╔══██║██║     ██╔══╝
echo  ██║     ╚██████╔╝██║ ╚████║██████╔╝   ██║   ██║  ██║██║  ██║╚██████╗███████╗
echo  ╚═╝      ╚═════╝ ╚═╝  ╚═══╝╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝
echo.
echo                    AI-Powered Fund Flow Fraud Detection Platform
echo                         Hackathon Round 2 Demo - PS3
echo.
echo ============================================================
echo  Starting Fraudscope AI Demo (No MongoDB Required)
echo ============================================================
echo.

:: Install backend dependencies if missing
if not exist "%~dp0backend\node_modules\express\" (
    echo [Setup] backend dependencies not found. Installing...
    cd /d "%~dp0backend" && call npm install
)

:: Install frontend dependencies if missing
if not exist "%~dp0frontend\node_modules\vite\" (
    echo [Setup] frontend dependencies not found. Installing...
    cd /d "%~dp0frontend" && call npm install
)

:: Start backend in new window
echo [1/2] Starting Backend Server (Demo Mode)...
start "Fraudscope Backend" cmd /k "cd /d %~dp0backend && node mock-server.js"

:: Wait 3 seconds for backend to initialize
timeout /t 3 /nobreak >nul

:: Start frontend in new window
echo [2/2] Starting Frontend (React + Vite)...
start "Fraudscope Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

:: Wait for frontend to be ready
timeout /t 5 /nobreak >nul

echo.
echo ============================================================
echo  Fraudscope AI is RUNNING!
echo ============================================================
echo.
echo  Backend:  http://localhost:5000/health
echo  Frontend: http://localhost:5173
echo.
echo  Login:    admin@fraudscope.ai
echo  Password: Fraudscope@2024
echo.
echo  Fraud scenarios auto-trigger every 25 seconds
echo ============================================================
echo.

:: Open browser
start "" "http://localhost:5173"

echo  Press any key to stop all servers...
pause >nul

:: Kill processes
taskkill /f /fi "WINDOWTITLE eq Fraudscope Backend" >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq Fraudscope Frontend" >nul 2>&1
echo  Servers stopped.
