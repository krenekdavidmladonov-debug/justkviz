@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\event-night\Backup-EventNight.ps1"
exit /b %ERRORLEVEL%
