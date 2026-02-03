# Stop Uptime Monitor
$pidFile = "$env:USERPROFILE\mcp-servers\uptime-monitor\monitor.pid"

if (Test-Path $pidFile) {
    $pid = Get-Content $pidFile
    $process = Get-Process -Id $pid -ErrorAction SilentlyContinue

    if ($process) {
        Stop-Process -Id $pid -Force
        Write-Host "Uptime Monitor stopped (PID: $pid)" -ForegroundColor Green
    } else {
        Write-Host "Uptime Monitor was not running" -ForegroundColor Yellow
    }

    Remove-Item $pidFile -Force
} else {
    # Try to find by name
    $procs = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try {
            $_.CommandLine -like "*uptime-monitor*"
        } catch {
            $false
        }
    }

    if ($procs) {
        $procs | Stop-Process -Force
        Write-Host "Uptime Monitor stopped" -ForegroundColor Green
    } else {
        Write-Host "Uptime Monitor is not running" -ForegroundColor Yellow
    }
}
