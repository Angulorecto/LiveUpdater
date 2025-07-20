@echo off
mvn clean package

if %ERRORLEVEL% neq 0 (
    echo Maven build failed with error level %ERRORLEVEL%.
) else (
    echo Maven build completed successfully.
)

pause
