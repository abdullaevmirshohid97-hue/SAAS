# Test web-clinic
$ports = 5173, 5174, 5175, 5176, 4321, 4322
foreach ($port in $ports) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$port/" -TimeoutSec 2 -UseBasicParsing
        if ($r.StatusCode -eq 200) {
            $title = ($r.Content | Select-String "<title>.*</title>").Matches[0].Value
            Write-Host "✅ Port $port : $($r.StatusCode) $title"
        }
    } catch {
        Write-Host "❌ Port $port : $($_.Exception.Message)"
    }
}
