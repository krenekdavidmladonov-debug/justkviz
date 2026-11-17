@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\event-night\Start-EventNight.ps1"
exit /b %ERRORLEVEL%
