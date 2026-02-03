# Check Uptime Monitor Status
$pidFile = "$env:USERPROFILE\mcp-servers\uptime-monitor\monitor.pid"
$stateFile = "$env:USERPROFILE\mcp-servers\uptime-monitor\state.json"
$logFile = "$env:USERPROFILE\mcp-servers\uptime-monitor\uptime.log"

Write-Host ""
Write-Host "=" * 50 -ForegroundColor Cyan
Write-Host "UPTIME MONITOR STATUS" -ForegroundColor White
Write-Host "=" * 50 -ForegroundColor Cyan
Write-Host ""

# Check if running
$running = $false
if (Test-Path $pidFile) {
    $monitorPid = Get-Content $pidFile
    $process = Get-Process -Id $monitorPid -ErrorAction SilentlyContinue
    if ($process) {
        $running = $true
        Write-Host "Status: " -NoNewline
        Write-Host "RUNNING" -ForegroundColor Green -NoNewline
        Write-Host " (PID: $monitorPid)"
    }
}

if (-not $running) {
    Write-Host "Status: " -NoNewline
    Write-Host "STOPPED" -ForegroundColor Red
}

# Show state
if (Test-Path $stateFile) {
    Write-Host ""
    Write-Host "Site Status:" -ForegroundColor Yellow
    $state = Get-Content $stateFile | ConvertFrom-Json

    foreach ($site in $state.siteStatus.PSObject.Properties) {
        $status = if ($site.Value) { "UP" } else { "DOWN" }
        $color = if ($site.Value) { "Green" } else { "Red" }
        Write-Host "  $($site.Name): " -NoNewline
        Write-Host $status -ForegroundColor $color
    }
}

# Show recent logs
if (Test-Path $logFile) {
    Write-Host ""
    Write-Host "Recent Activity:" -ForegroundColor Yellow
    Get-Content $logFile -Tail 10 | ForEach-Object {
        if ($_ -match "ALERT|DOWN|FAILED") {
            Write-Host "  $_" -ForegroundColor Red
        } elseif ($_ -match "RECOVERED|OK") {
            Write-Host "  $_" -ForegroundColor Green
        } else {
            Write-Host "  $_" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "=" * 50 -ForegroundColor Cyan
