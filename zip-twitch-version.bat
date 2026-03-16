@echo off
setlocal EnableDelayedExpansion

REM Work from the folder this BAT file is in
set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"

REM Read version from manifest.json
set "VERSION="
for /f "usebackq delims=" %%V in (`powershell -NoLogo -NoProfile -Command ^
  "$m = Get-Content '%SRC%\manifest.json' -Raw | ConvertFrom-Json; $m.version"`) do (
  set "VERSION=%%V"
)

if not defined VERSION (
  echo Failed to read version from manifest.json
  pause
  exit /b 1
)

REM Output zip name
set "OUT=%SRC%\twitch-tab-manager-!VERSION!.zip"

REM Temp staging folder
set "STAGE=%SRC%\_zip_stage"

REM Clean old stage/output
if exist "%STAGE%" rmdir /s /q "%STAGE%"
if exist "%OUT%" del /f /q "%OUT%"

REM Copy everything except excluded files/folders
robocopy "%SRC%" "%STAGE%" /E ^
 /XD ".git" "_zip_stage" ^
 /XF ".gitattributes" ".gitignore" "README_old.md" "zip-twitch.bat" "twitch-tab-manager.zip" "zip-twitch-version.bat" "twitch-tab-manager-*.zip" ^
 /R:1 /W:1 >nul

REM Create zip from stage
powershell -NoLogo -NoProfile -Command ^
  "Add-Type -AssemblyName 'System.IO.Compression.FileSystem';" ^
  "if (Test-Path '%OUT%') { Remove-Item '%OUT%' -Force };" ^
  "[System.IO.Compression.ZipFile]::CreateFromDirectory('%STAGE%', '%OUT%', [System.IO.Compression.CompressionLevel]::Optimal, $false)"

REM Clean up stage folder
if exist "%STAGE%" rmdir /s /q "%STAGE%"

echo Done: %OUT%
endlocal