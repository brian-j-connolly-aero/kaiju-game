@echo off
rem Show the latest messages from Monster Battle 9001 (useful when something goes wrong).
rem Double-click this file. Guide: docs\HOSTING.md
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mb.ps1" logs
echo.
pause
