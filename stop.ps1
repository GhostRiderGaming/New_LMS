# AnimeEdu — Stop all services
Write-Host "  Stopping AnimeEdu services..." -ForegroundColor Yellow

function Kill-Port($port) {
    $pids = (netstat -ano 2>$null | Select-String ":$port\s" | ForEach-Object {
        ($_ -split '\s+')[-1]
    } | Sort-Object -Unique | Where-Object { $_ -match '^\d+$' })
    foreach ($p in $pids) {
        try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } catch {}
    }
}

Kill-Port 3000
Kill-Port 8000

# Kill Redis
Get-Process -Name "redis-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Kill Celery
Get-Process -Name "python*" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*celery*" } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "  All services stopped." -ForegroundColor Green
