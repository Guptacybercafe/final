@echo off
REM ===== Gupta Cyber Cafe print agent (shop laptop) =====
REM 1. Paste your token below (the same AGENT_TOKEN value that is set on Render).
set AGENT_TOKEN=PASTE_TOKEN_HERE
set SERVER_URL=https://gupta-cyber-cafe.onrender.com
cd /d "%~dp0"
if not exist node_modules (
  echo Installing, please wait...
  call npm install
)
:loop
node print-agent.js
echo Agent stopped. Restarting in 5 seconds... (close this window to quit)
timeout /t 5 >nul
goto loop
