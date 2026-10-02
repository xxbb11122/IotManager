@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Please install it first.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  if not exist "node_modules\vite" call npm ci --no-audit --no-fund
  if errorlevel 1 goto failed
  call npm run build
  if errorlevel 1 goto failed
)
echo Open http://127.0.0.1:5188/ in your browser.
node scripts\serve.mjs
pause
exit /b
:failed
echo Demo setup failed. See the output above.
pause
exit /b 1
