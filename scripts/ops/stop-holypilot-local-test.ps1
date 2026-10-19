$ErrorActionPreference = 'Stop'

$distro = 'Ubuntu-24.04'
$source = '/root/holypilot-google-test-88ced'
$compose = 'infra/local-google-test/docker-compose.yml'
$envFile = '/root/.config/holypilot-google-test/compose.env'
$keeperFile = Join-Path (Join-Path $env:LOCALAPPDATA 'HolyPilot') 'local-test-keeper.json'

& wsl.exe -d $distro --user root --cd $source -- docker compose --env-file $envFile -f $compose stop --timeout 25
if ($LASTEXITCODE -ne 0) { throw "Local TEST stop failed with exit code $LASTEXITCODE" }

if (Test-Path -LiteralPath $keeperFile) {
    try {
        $saved = Get-Content -LiteralPath $keeperFile -Raw | ConvertFrom-Json
        $keeper = Get-Process -Id ([int]$saved.pid) -ErrorAction Stop
        if ($keeper.ProcessName -eq 'wsl' -and $keeper.StartTime.ToUniversalTime().Ticks -eq [long]$saved.startTimeUtcTicks) {
            Stop-Process -Id $keeper.Id
        }
    } catch { }
    Remove-Item -LiteralPath $keeperFile -ErrorAction SilentlyContinue
}

Write-Output 'HolyPilot localhost TEST stopped; containers and PostgreSQL/Redis volumes preserved.'
