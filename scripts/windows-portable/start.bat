@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
echo 浏览器地址以服务打印的监听地址为准。默认 http://127.0.0.1:8080
"%CD%\local-gallery.exe" --config config.yaml
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
popd
exit /b %RESULT%
