@echo off
rem Stop Monster Battle 9001 (it saves the game's log first, like savelog.cmd).
rem Double-click this file. Guide: docs\HOSTING.md
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mb.ps1" stop
echo.
pause
