# Direct curl test
Write-Host "Testing web-clinic @ 5175..."
& cmd /c "curl -v http://localhost:5175/ 2>&1" | Select-String "HTTP|Connection|timeout" | Select-Object -First 5
