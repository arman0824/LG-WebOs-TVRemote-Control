@echo off
cd /d "%~dp0"
echo Starting Local LG TV Remote in phone mode...
echo.
call npm run start:phone
echo.
echo Open the URL shown above on your phone.
echo Your phone and computer must be on the same Wi-Fi.
pause