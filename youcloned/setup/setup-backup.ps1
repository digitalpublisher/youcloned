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
# The Tools step puts gh and git in these folders; WinGet's Links folder is not always on the saved PATH.
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links') + ';' + (Join-Path $env:ProgramFiles 'GitHub CLI') + ';' + (Join-Path $env:ProgramFiles 'Git\cmd')
}
Refresh-Path
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Say "Git isn't installed yet. Run setup's Tools step first."; exit 1 }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Say "GitHub's tool (gh) isn't installed yet. Run setup's Tools step first."; exit 1 }
& gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Say "You aren't logged in to GitHub yet. Run: gh auth login --web --git-protocol https --hostname github.com"; exit 2 }
if (-not (Test-Path -LiteralPath $Folder)) { Say "The folder $Folder isn't there."; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.youcloned\git-hooks\pre-commit'))) { Say "Protection isn't on yet, so nothing was backed up. Run setup's Protection step first."; exit 1 }
Set-Location -LiteralPath $Folder
$Folder = (Get-Location).Path

# The privacy check, shared word for word with the nightly job below. Git can fetch from one address
# and push to another (remote.origin.pushurl, or url.*.insteadOf / pushInsteadOf rewriting), so EVERY
# address origin fetches from or pushes to must be a private GitHub repository this login can read.
# Addresses are never printed: one can hold a login token.
$Checks = @'
function Get-GitHubSlug([string]$Url) {
  $u = "$Url".Trim().TrimEnd('/')
  $m = [regex]::Match($u, '^(?:https://(?:[^/@]+@)?github\.com/|ssh://git@github\.com/|git@github\.com:)([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$')
  if (-not $m.Success) { return $null }
  $r = $m.Groups[2].Value
  if ($r.EndsWith('.git')) { $r = $r.Substring(0, $r.Length - 4) }
  if (-not $r) { return $null }
  return ($m.Groups[1].Value + '/' + $r)
}
function Test-Private([string]$Url) {
  $ErrorActionPreference = 'Continue'
  $slug = Get-GitHubSlug $Url
  if (-not $slug) { return $false }
  $v = (& gh repo view $slug --json isPrivate -q .isPrivate 2>$null)
  return ($LASTEXITCODE -eq 0 -and "$v".Trim() -eq 'true')
}
function Get-OriginUrls {
  $ErrorActionPreference = 'Continue'
  $all = @()
  $all += @(& git remote get-url --all origin 2>$null)
  $all += @(& git remote get-url --push --all origin 2>$null)
  $all += @(& git ls-remote --get-url origin 2>$null)
  $all += @(& git config --get-all remote.origin.url 2>$null)
  $all += @(& git config --get-all remote.origin.pushurl 2>$null)
  return @($all | ForEach-Object { "$_".Trim() } | Where-Object { $_ } | Sort-Object -Unique)
}
# 0 all private; 1 an address isn't GitHub; 2 a GitHub one is public or unreadable; 3 none
function Get-OriginState {
  $urls = @(Get-OriginUrls)
  if ($urls.Count -eq 0) { return 3 }
  foreach ($u in $urls) {
    if (-not (Get-GitHubSlug $u)) { return 1 }
    if (-not (Test-Private $u)) { return 2 }
  }
  return 0
}
function Add-LargeFileExclusions([string]$Root) {
  $ex = Join-Path $Root '.git\info\exclude'
  Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.Length -gt 50MB } | ForEach-Object {
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\').Replace('\', '/')
    $have = @()
    if (Test-Path -LiteralPath $ex) { $have = @(Get-Content -LiteralPath $ex) }
    if ($have -notcontains $rel) { Add-Content -LiteralPath $ex -Value $rel }
  }
}
'@
. ([ScriptBlock]::Create($Checks))

if (-not (Test-Path -LiteralPath '.git')) { & git init -q -b main . 2>$null; if ($LASTEXITCODE -ne 0) { & git init -q .; & git checkout -q -b main } }
if (-not (Test-Path -LiteralPath '.gitignore')) { New-Item -ItemType File -Path '.gitignore' | Out-Null }
$have = @(Get-Content -LiteralPath '.gitignore')
foreach ($line in @('.env', '*.env', '.env.*', '!.env.example', '.DS_Store', 'Thumbs.db', '.obsidian/workspace*.json', '.trash/', 'node_modules/', '.venv/', '__pycache__/')) {
  if ($have -notcontains $line) { Add-Content -LiteralPath '.gitignore' -Value $line }
}
& git check-ignore -q .env
if ($LASTEXITCODE -ne 0) { Say "The env file isn't ignored by Git, so nothing was backed up."; exit 1 }

if (Test-Path -LiteralPath '.git\youcloned-backup-private') { Remove-Item -LiteralPath '.git\youcloned-backup-private' -Force }
$hasOrigin = @(& git remote) -contains 'origin'
if ($hasOrigin) {
  # checked below, with every address it fetches from or pushes to
} elseif ($Theirs) {
  if (-not (Get-GitHubSlug $Theirs)) { Say "That doesn't look like a GitHub address. Nothing was changed."; exit 1 }
  if (-not (Test-Private $Theirs)) { Say "That repository is PUBLIC or can't be read with your GitHub login. Your clone folder only goes to a private one. Nothing was backed up."; exit 1 }
  & git remote add origin $Theirs
  Say 'Using your own private repository.'
} else {
  $base = ((Split-Path -Leaf $Folder) -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLower()
  $name = "youcloned-$base"
  $ErrorActionPreference = 'Continue'
  & gh repo view $name *> $null
  $exists = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = 'Stop'
  if ($exists) { $name = "$name-" + (Get-Date -Format 'yyyyMMdd') }
  & gh repo create $name --private --source . --remote origin | Out-Null
  if ($LASTEXITCODE -ne 0) { Say 'GitHub did not make the repository. Nothing was pushed.'; exit 1 }
  Say "Made your private GitHub repository: $name"
}

$state = Get-OriginState
if ($state -eq 1) { Say "This folder fetches from or pushes to somewhere that isn't a GitHub repository. Nothing was backed up."; exit 1 }
if ($state -ne 0) { Say "This folder's GitHub link (where it fetches from or pushes to) is PUBLIC or can't be read. Nothing was backed up. Make it private on github.com, or remove that link, then run this again."; exit 1 }

# The nightly job, written once and reused by the scheduled task.
$Dir = Join-Path $env:USERPROFILE '.youcloned'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Set-Content -LiteralPath (Join-Path $Dir 'backup-folder') -Value $Folder -Encoding ASCII
$Job = Join-Path $Dir 'backup-nightly.ps1'
$JobBody = @'
$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links') + ';' + (Join-Path $env:ProgramFiles 'GitHub CLI') + ';' + (Join-Path $env:ProgramFiles 'Git\cmd')
$Log = Join-Path $env:USERPROFILE '.youcloned\backup.log'
$Folder = (Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.youcloned\backup-folder') -TotalCount 1)
Set-Location -LiteralPath $Folder
if ((Get-OriginState) -ne 0) { Add-Content -LiteralPath $Log -Value "$(Get-Date): an address this folder fetches from or pushes to is not a private GitHub repository you can read, nothing pushed"; exit 1 }
Add-LargeFileExclusions $Folder
& git add -A
& git -c user.name="YouCloned backup" -c user.email="youcloned-backup@example.com" commit -qm "YouCloned backup $(Get-Date -Format yyyy-MM-dd)" 2>$null
& git push -q origin HEAD:main
if ($LASTEXITCODE -eq 0) { Add-Content -LiteralPath $Log -Value "$(Get-Date): backed up" }
'@
($Checks + "`r`n" + $JobBody) | Set-Content -LiteralPath $Job -Encoding ASCII

# Files over 50MB stay on this computer (GitHub refuses files over 100MB), from the very first backup.
Add-LargeFileExclusions $Folder

$ErrorActionPreference = 'Continue'
& gh auth setup-git *> $null
& git add -A
& git -c user.name="YouCloned backup" -c user.email="youcloned-backup@example.com" commit -qm ("YouCloned backup " + (Get-Date -Format 'yyyy-MM-dd')) 2>$null
& git push -q -u origin HEAD:main
$pushed = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $pushed) { Say 'The first backup did not reach GitHub. Check the internet connection and run this again.'; exit 1 }

if ($env:YOUCLONED_NO_SCHEDULE) {
  Say 'Test run: the nightly schedule was not set.'
} else {
  try {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Job + '"')
    $trigger = New-ScheduledTaskTrigger -Daily -At '2:30am'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
    Register-ScheduledTask -TaskName 'YouCloned backup' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  } catch { }
  $task = Get-ScheduledTask -TaskName 'YouCloned backup' -ErrorAction SilentlyContinue
  if (-not $task) {
    Say "Your clone folder is saved to your private GitHub repository, but the nightly backup could not be scheduled, so this step isn't finished. Restart the computer, then run this again."
    exit 1
  }
}

# Written only now: the first backup reached GitHub AND the nightly task is scheduled.
New-Item -ItemType File -Force -Path '.git\youcloned-backup-private' | Out-Null
Say 'Your clone folder is saved to a private GitHub repository, and it saves again every night at 2:30am.'
Say 'BACKUP READY'
