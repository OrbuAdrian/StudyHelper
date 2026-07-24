@echo off
set PORT=8080
if not "%~1"=="" set PORT=%~1
cd /d "%~dp0"
echo Study Forge is available at http://localhost:%PORT%
py -3 -m http.server %PORT% 2>nul || python -m http.server %PORT%
