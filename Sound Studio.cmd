@echo off
rem Double-click launcher for Sound Studio.
rem Opens the app in Google Chrome as a standalone app window (no tabs, no
rem address bar); falls back to the default browser if Chrome isn't found.
setlocal
set "HERE=%~dp0"
set "PAGE=file:///%HERE:\=/%index.html"

set "CHROME="
for %%P in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do if exist "%%~P" set "CHROME=%%~P"

if defined CHROME (
  start "" "%CHROME%" --app="%PAGE%" --window-size=1280,860
) else (
  start "" "%PAGE%"
)
endlocal
