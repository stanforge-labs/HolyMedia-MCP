$ErrorActionPreference = 'Stop'

$distro = 'Ubuntu-24.04'
$source = '/root/holypilot-google-test-88ced'
$compose = 'infra/local-google-test/docker-compose.yml'
$envFile = '/root/.config/holypilot-google-test/compose.env'
$stateDir = Join-Path $env:LOCALAPPDATA 'HolyPilot'
$keeperFile = Join-Path $stateDir 'local-test-keeper.json'

function Invoke-WslChecked([string[]]$Arguments) {
    & wsl.exe -d $distro --user root --cd $source -- @Arguments
    if ($LASTEXITCODE -ne 0) { throw "WSL command failed with exit code $LASTEXITCODE" }
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$keeper = $null
$createdKeeper = $false
if (Test-Path -LiteralPath $keeperFile) {
    try {
        $saved = Get-Content -LiteralPath $keeperFile -Raw | ConvertFrom-Json
        $existing = Get-Process -Id ([int]$saved.pid) -ErrorAction Stop
        if ($existing.ProcessName -eq 'wsl' -and $existing.StartTime.ToUniversalTime().Ticks -eq [long]$saved.startTimeUtcTicks) {
            $keeper = $existing
        }
    } catch { }
}
if ($null -eq $keeper) {
    $keeper = Start-Process -FilePath wsl.exe -ArgumentList @('-d', $distro, '--user', 'root', '--', 'sleep', 'infinity') -WindowStyle Hidden -PassThru
    $createdKeeper = $true
    @{ pid = $keeper.Id; startTimeUtcTicks = $keeper.StartTime.ToUniversalTime().Ticks } |
        ConvertTo-Json -Compress | Set-Content -LiteralPath $keeperFile -Encoding utf8
}

try {
    Invoke-WslChecked @('test', '-f', $envFile)
    Invoke-WslChecked @('docker', 'compose', '--env-file', $envFile, '-f', $compose, 'config', '--quiet')
    Invoke-WslChecked @('docker', 'compose', '--env-file', $envFile, '-f', $compose, 'up', '--no-build', '--pull', 'never', '--wait', '-d')
    foreach ($service in @('api', 'web', 'postgres', 'redis')) {
        $container = "holypilot-google-test-local-$service-1"
        $rawPorts = & wsl.exe -d $distro --user root -- docker inspect --format '{{json .HostConfig.PortBindings}}' $container
        if ($LASTEXITCODE -ne 0) { throw "Cannot inspect local TEST $service bindings" }
        $ports = $rawPorts | ConvertFrom-Json
        if ($ports.PSObject.Properties.Count -eq 0) { throw "Local TEST $service has no expected loopback binding" }
        foreach ($entry in $ports.PSObject.Properties) {
            foreach ($binding in $entry.Value) {
                if ($binding.HostIp -ne '127.0.0.1') { throw "Local TEST $service is not loopback-only" }
            }
        }
    }
    foreach ($url in @('http://127.0.0.1:24404/ready', 'http://127.0.0.1:23300/auth', 'http://127.0.0.1:23300/mcp/approve')) {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 10
        if ($response.StatusCode -ne 200) { throw "Local TEST route failed: $url" }
    }
    Write-Output 'HolyPilot localhost TEST: API, Web, PostgreSQL and Redis healthy; all ports loopback-only. Google callbacks require separate Cloud registration.'
} catch {
    if ($createdKeeper) {
        Stop-Process -Id $keeper.Id -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $keeperFile -ErrorAction SilentlyContinue
    }
    throw
}
