@echo off
rem Save everything Monster Battle 9001 and its tunnel wrote since they started into one
rem dated text file, in the "Monster Battle logs" folder on your desktop (the folder opens).
rem Double-click this file after a session and send the file. Guide: docs\HOSTING.md
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mb.ps1" savelog
echo.
pause
