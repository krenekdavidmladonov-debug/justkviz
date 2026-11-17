@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0" || exit /b 1
if exist ".tools\node22-pnpm\pnpm.cmd" set "PATH=%CD%\.tools\node22-pnpm;%PATH%"
if exist ".tools\node22\node.exe" (
  ".tools\node22\node.exe" tools\deploy\nasadit.mjs %*
) else (
  node.exe tools\deploy\nasadit.mjs %*
)
exit /b %ERRORLEVEL%
