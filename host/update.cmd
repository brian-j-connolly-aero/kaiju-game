@echo off
rem Get the newest copy of Monster Battle 9001 and start it again.
rem Double-click this file. Guide: docs\HOSTING.md
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mb.ps1" update
echo.
pause
