@echo off
setlocal EnableExtensions DisableDelayedExpansion
echo POZOR: nasazuje na PRODUKCI justkviz.cz
set "JUSTKVIZ_DEPLOY_CONFIRM="
set /p "JUSTKVIZ_DEPLOY_CONFIRM=Pro pokracovani napis ANO: "
if not defined JUSTKVIZ_DEPLOY_CONFIRM exit /b 1
set JUSTKVIZ_DEPLOY_CONFIRM | "%SystemRoot%\System32\findstr.exe" /l /x /c:"JUSTKVIZ_DEPLOY_CONFIRM=ANO" >nul
if errorlevel 1 exit /b 1

cd /d "%~dp0..\.." || exit /b 1
if not exist ".tools\node22\node.exe" (
  echo Node 22 is required at .tools\node22\node.exe
  exit /b 1
)
".tools\node22\node.exe" tools\staging\deploy.mjs filmovy-kviz-v2-staging
exit /b %errorlevel%
