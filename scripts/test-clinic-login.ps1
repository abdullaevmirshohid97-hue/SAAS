# Test login
Write-Host "Testing clinic app..."
$r = Invoke-WebRequest -Uri "http://localhost:5173/login" -TimeoutSec 5 -UseBasicParsing
Write-Host "Status:" $r.StatusCode
Write-Host ($r.Content.Substring(0, 300) + "...")
