@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\tonight-repair\Verify-TonightGoNoGo.ps1"
exit /b %ERRORLEVEL%
