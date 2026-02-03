# Start Uptime Monitor in background
$scriptPath = "$env:USERPROFILE\mcp-servers\uptime-monitor\monitor.js"
$logFile = "$env:USERPROFILE\mcp-servers\uptime-monitor\console.log"

# Check if already running
$existing = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*uptime-monitor*"
}

if ($existing) {
    Write-Host "Uptime Monitor is already running (PID: $($existing.Id))" -ForegroundColor Yellow
    exit 0
}

# Start the monitor
Write-Host "Starting Uptime Monitor..." -ForegroundColor Green
$process = Start-Process -FilePath "node" -ArgumentList $scriptPath -WindowStyle Hidden -PassThru -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"

Write-Host "Uptime Monitor started (PID: $($process.Id))" -ForegroundColor Green
Write-Host "Log file: $logFile" -ForegroundColor Cyan

# Save PID for later
$process.Id | Out-File "$env:USERPROFILE\mcp-servers\uptime-monitor\monitor.pid"
