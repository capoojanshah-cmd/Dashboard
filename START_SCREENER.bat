@echo off
title Stock Parameter Screener — PJ Version
echo.
echo ========================================================
echo   STOCK PARAMETER SCREENER
echo   Dhan API + Yahoo Finance
echo ========================================================
echo.
echo   Keep this window open while using the screener.
echo   Press Ctrl+C to stop.
echo.

cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo   ERROR: Python not found!
    echo   Install from https://www.python.org/downloads/
    pause
    exit /b
)

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5555"

echo   Starting server on http://localhost:5555 ...
echo.
python server.py

pause
