@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
echo http://127.0.0.1:8080
"%CD%\local-gallery.exe" --config config.yaml
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
popd
exit /b %RESULT%
