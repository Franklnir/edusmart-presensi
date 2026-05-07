param(
    [switch] $SkipBuild,
    [switch] $SkipTests,
    [switch] $SkipAudit
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

function Invoke-Step {
    param(
        [string] $Title,
        [scriptblock] $Command
    )

    Write-Host ""
    Write-Host "==> $Title"
    & $Command
}

function Assert-TrackedSecretsAbsent {
    $tracked = @(git ls-files)
    $forbidden = $tracked | Where-Object {
        (($_ -match '(^|/)\.env($|[.])') -and ($_ -notmatch '(^|/)\.env.*\.example$')) -or
        $_ -eq 'env_vps.txt' -or
        $_ -eq 'composer.phar' -or
        $_ -eq 'composer-setup.php' -or
        $_ -match '(^|/)database/.*\.sqlite'
    }

    if ($forbidden.Count -gt 0) {
        Write-Error ("File sensitif/artifact sudah tracked dan harus dikeluarkan dulu:`n" + ($forbidden -join "`n"))
    }
}

function Assert-LocalSecretsIgnored {
    $paths = @(
        ".env",
        ".env.production",
        "backend/.env",
        "env_vps.txt",
        "composer.phar",
        "composer-setup.php"
    )

    foreach ($path in $paths) {
        if (Test-Path $path) {
            git check-ignore -q -- $path
            if ($LASTEXITCODE -ne 0) {
                Write-Error "$path ada di workspace tapi belum di-ignore. Jangan push sebelum .gitignore diperbaiki."
            }
        }
    }
}

Invoke-Step "Cek file sensitif tidak tracked" {
    Assert-TrackedSecretsAbsent
    Assert-LocalSecretsIgnored
}

if (-not $SkipBuild) {
    Invoke-Step "Frontend production build" {
        npm run build
    }
}

if (-not $SkipAudit) {
    Invoke-Step "Frontend security audit" {
        npm run security:audit
    }

    Invoke-Step "Backend composer audit" {
        Push-Location backend
        try {
            php ..\composer.phar audit
        } finally {
            Pop-Location
        }
    }
}

if (-not $SkipTests) {
    Invoke-Step "Backend test suite" {
        Push-Location backend
        try {
            php ..\composer.phar test
        } finally {
            Pop-Location
        }
    }
}

Write-Host ""
Write-Host "Pre-push check selesai. Aman untuk git add/commit/push jika tidak ada file rahasia di staging."
