$body = @{ email = 'admin@nur.uz'; password = 'Admin!2026' } | ConvertTo-Json
$headers = @{
    'Content-Type' = 'application/json'
    'apikey'       = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
}
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' -Method POST -Headers $headers -Body $body -TimeoutSec 10
    Write-Host "STATUS:" $r.StatusCode
    Write-Host ($r.Content.Substring(0, [Math]::Min(500, $r.Content.Length)))
} catch {
    Write-Host "ERROR:" $_.Exception.Message
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host "BODY:" $reader.ReadToEnd()
    }
}
