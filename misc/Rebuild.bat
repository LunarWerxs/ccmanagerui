@echo off
setlocal
rem Standalone rebuild of the CC Manager UI GUI (no tray dependency). The tray's
rem "Rebuild & Restart" does this plus restarts the daemon; this is the manual path.
cd /d "%~dp0.."
echo Rebuilding CC Manager UI GUI...
call bun run build
echo.
echo Done.
pause
