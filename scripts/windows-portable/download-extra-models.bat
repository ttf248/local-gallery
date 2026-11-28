@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
"aiworker\runtime\python.exe" -E -s "aiworker\download_models.py" --profile extras
set "RESULT=%ERRORLEVEL%"
pause
popd
exit /b %RESULT%
