@echo off
REM Este archivo es ejecutado por Windows Task Scheduler diariamente.
REM Sincroniza los contactos de GHL automaticamente.
cd /d "%~dp0"
node export-contacts.js >> data\sync-log.txt 2>&1
