# YouCloned night-one setup, step "Back up to GitHub", on a PC: the twin of setup-backup.sh.
# A PRIVATE GitHub copy of the clone folder, saved every night at 2:30am by a Windows scheduled task.
# It never makes or pushes to a public repository: the nightly job checks the repository is still
# private before every push and stops if it isn't.
#   setup-backup.ps1 "<clone folder>" ["<their own private GitHub repository address>"]
# Needs gh logged in (gh auth login). Keys never go up: env files are git-ignored here, and the
# YouCloned key check (setup's Protection step) blocks any commit that holds one.
# This file stays plain ASCII: Windows PowerShell 5.1 misreads anything else in a script saved without a BOM.
param([Parameter(Mandatory = $true)][string]$Folder, [string]$Theirs = '')
$ErrorActionPreference = 'Stop'

function Say($m) { Write-Host $m }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
Refresh-Path
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Say "Git isn't installed yet. Run setup's Tools step first."; exit 1 }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Say "GitHub's tool (gh) isn't installed yet. Run setup's Tools step first."; exit 1 }
& gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Say "You aren't logged in to GitHub yet. Run: gh auth login --web --git-protocol https --hostname github.com"; exit 2 }
if (-not (Test-Path -LiteralPath $Folder)) { Say "The folder $Folder isn't there."; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.youcloned\git-hooks\pre-commit'))) { Say "Protection isn't on yet, so nothing was backed up. Run setup's Protection step first."; exit 1 }
Set-Location -LiteralPath $Folder

function Test-Private([string]$Url) {
  $v = (& gh repo view $Url --json isPrivate -q .isPrivate 2>$null)
  return ($LASTEXITCODE -eq 0 -and "$v".Trim() -eq 'true')
}

if (-not (Test-Path -LiteralPath '.git')) { & git init -q -b main . 2>$null; if ($LASTEXITCODE -ne 0) { & git init -q .; & git checkout -q -b main } }
if (-not (Test-Path -LiteralPath '.gitignore')) { New-Item -ItemType File -Path '.gitignore' | Out-Null }
$have = @(Get-Content -LiteralPath '.gitignore')
foreach ($line in @('.env', '*.env', '.env.*', '!.env.example', '.DS_Store', 'Thumbs.db', '.obsidian/workspace*.json', '.trash/', 'node_modules/', '.venv/', '__pycache__/')) {
  if ($have -notcontains $line) { Add-Content -LiteralPath '.gitignore' -Value $line }
}
& git check-ignore -q .env
if ($LASTEXITCODE -ne 0) { Say "The env file isn't ignored by Git, so nothing was backed up."; exit 1 }

$url = (& git remote get-url origin 2>$null)
if ($LASTEXITCODE -eq 0 -and $url) {
  if ($url -notmatch 'github\.com') { Say "This folder already backs up somewhere other than GitHub ($url). Nothing was changed."; exit 1 }
  if (-not (Test-Private $url)) { Say "This folder already points at a GitHub repository that is PUBLIC or can't be read. Nothing was backed up. Make it private on github.com, or remove that link, then run this again."; exit 1 }
} elseif ($Theirs) {
  if ($Theirs -notmatch 'github\.com') { Say "That doesn't look like a GitHub address. Nothing was changed."; exit 1 }
  if (-not (Test-Private $Theirs)) { Say "That repository is PUBLIC or can't be read with your GitHub login. Your clone folder only goes to a private one. Nothing was backed up."; exit 1 }
  & git remote add origin $Theirs
  $url = $Theirs
  Say 'Using your own private repository.'
} else {
  $base = ((Split-Path -Leaf $Folder) -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLower()
  $name = "youcloned-$base"
  & gh repo view $name *> $null
  if ($LASTEXITCODE -eq 0) { $name = "$name-" + (Get-Date -Format 'yyyyMMdd') }
  & gh repo create $name --private --source . --remote origin | Out-Null
  if ($LASTEXITCODE -ne 0) { Say 'GitHub did not make the repository. Nothing was pushed.'; exit 1 }
  $url = (& git remote get-url origin)
  if (-not (Test-Private $url)) { Say "GitHub made the repository but didn't report it as private. Nothing was pushed."; exit 1 }
  Say "Made your private GitHub repository: $name"
}

# The nightly job, written once and reused by the scheduled task.
$Dir = Join-Path $env:USERPROFILE '.youcloned'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Set-Content -LiteralPath (Join-Path $Dir 'backup-folder') -Value $Folder -Encoding ASCII
$Job = Join-Path $Dir 'backup-nightly.ps1'
@'
$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$Log = Join-Path $env:USERPROFILE '.youcloned\backup.log'
$Folder = (Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.youcloned\backup-folder') -TotalCount 1)
Set-Location -LiteralPath $Folder
$url = (& git remote get-url origin 2>$null)
$v = (& gh repo view $url --json isPrivate -q .isPrivate 2>$null)
if ("$v".Trim() -ne 'true') { Add-Content -LiteralPath $Log -Value "$(Get-Date): repository not private or not readable, nothing pushed"; exit 1 }
Get-ChildItem -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.Length -gt 50MB } | ForEach-Object {
  $rel = $_.FullName.Substring($Folder.Length).TrimStart('\').Replace('\', '/')
  $ex = '.git/info/exclude'
  if (-not (Select-String -LiteralPath $ex -SimpleMatch -Pattern $rel -Quiet -ErrorAction SilentlyContinue)) { Add-Content -LiteralPath $ex -Value $rel }
}
& git add -A
& git -c user.name="YouCloned backup" -c user.email="youcloned-backup@example.com" commit -qm "YouCloned backup $(Get-Date -Format yyyy-MM-dd)" 2>$null
& git push -q origin HEAD:main
if ($LASTEXITCODE -eq 0) { Add-Content -LiteralPath $Log -Value "$(Get-Date): backed up" }
'@ | Set-Content -LiteralPath $Job -Encoding ASCII

& gh auth setup-git *> $null
& git add -A
& git -c user.name="YouCloned backup" -c user.email="youcloned-backup@example.com" commit -qm ("YouCloned backup " + (Get-Date -Format 'yyyy-MM-dd')) 2>$null
& git push -q -u origin HEAD:main
if ($LASTEXITCODE -ne 0) { Say 'The first backup did not reach GitHub. Check the internet connection and run this again.'; exit 1 }
New-Item -ItemType File -Force -Path '.git\youcloned-backup-private' | Out-Null

if (-not $env:YOUCLONED_NO_SCHEDULE) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Job + '"')
  $trigger = New-ScheduledTaskTrigger -Daily -At '2:30am'
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName 'YouCloned backup' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
}

Say 'Your clone folder is saved to a private GitHub repository, and it saves again every night at 2:30am.'
Say 'BACKUP READY'
