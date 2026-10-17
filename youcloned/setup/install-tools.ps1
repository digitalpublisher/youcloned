# YouCloned night one, the Tools step: puts the free tools your clone uses on this Windows PC.
# Git, Node, Python 3.12, ffmpeg, GitHub's tool gh (the backup step needs it), yt-dlp and Obsidian,
# all from winget, the app installer built into Windows. The PC twin of install-tools.sh.
# Your clone runs it from the chat:
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-tools.ps1            installs what is missing
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-tools.ps1 -Check     one line per tool, changes nothing
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-tools.ps1 -DryRun    says what it would run, changes nothing
# Exit codes: 0 every tool is ready. 1 something is missing or did not install.
# 3 winget is missing: a Microsoft Store window opened for App Installer; update it, then run this again.
# Safe to run again: it skips anything already here and never removes or upgrades anything.
# Nothing here prints a key or a password. Runs in Windows PowerShell 5.1 and PowerShell 7.
# This file stays plain ASCII: Windows PowerShell 5.1 misreads anything else in a script saved without a BOM.

param([switch]$Check, [switch]$DryRun)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$MinNode = 20
$Links = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'

function Say($m) { Write-Host $m }

# Picks up programs that winget just installed, without opening a new window.
function Update-PathFromWindows {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$m;$u;$Links;$env:Path"
}

# Runs a program and answers what it printed, or $null when it failed or isn't there.
# Windows PowerShell stops on any line a program writes to its error output, so the stop is turned off here.
function Get-Answer([string]$Exe, [string[]]$ArgList) {
  if (-not (Test-Path -LiteralPath $Exe) -and -not (Get-Command $Exe -ErrorAction SilentlyContinue)) { return $null }
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Exe @ArgList 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { return $out.Trim() }
  } catch {
  } finally {
    $ErrorActionPreference = $old
  }
  return $null
}

# The first answer from these programs that matches the pattern, as its first group.
function Get-Version([string[]]$Exes, [string[]]$ArgList, [string]$Pattern) {
  foreach ($e in $Exes) {
    if (-not $e) { continue }
    $a = Get-Answer $e $ArgList
    if ($a -and ($a -match $Pattern)) { return $Matches[1] }
  }
  return $null
}

function Find-Ffmpeg {
  $list = @('ffmpeg', (Join-Path $Links 'ffmpeg.exe'))
  $pk = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path -LiteralPath $pk) {
    $f = Get-ChildItem -LiteralPath $pk -Directory -Filter 'Gyan.FFmpeg*' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue } |
      Select-Object -First 1
    if ($f) { $list += $f.FullName }
  }
  return $list
}

# Each probe answers the version, '!note' when it is there but too old, or $null when it is missing.
function Get-ToolVersion([string]$Name) {
  switch ($Name) {
    'git' {
      return Get-Version @('git', "$env:ProgramFiles\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe") @('--version') 'version (\S+)'
    }
    'node' {
      $v = Get-Version @('node', "$env:ProgramFiles\nodejs\node.exe") @('--version') 'v(\d+\.\S+)'
      if (-not $v) { return $null }
      if ([int]($v.Split('.')[0]) -lt $MinNode) { return "!found $v, needs $MinNode or newer" }
      return $v
    }
    'python' {
      # Windows ships python.exe stand-ins that only open the Microsoft Store, so Python counts only when it answers 3.12.
      $v = Get-Version @('py') @('-3.12', '--version') 'Python (3\.12\S*)'
      if (-not $v) {
        $v = Get-Version @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:ProgramFiles\Python312\python.exe", 'python') @('--version') 'Python (3\.12\S*)'
      }
      return $v
    }
    'ffmpeg' { return Get-Version (Find-Ffmpeg) @('-version') 'ffmpeg version (\S+)' }
    'gh' { return Get-Version @('gh', "$env:ProgramFiles\GitHub CLI\gh.exe", (Join-Path $Links 'gh.exe')) @('--version') 'gh version (\S+)' }
    'yt-dlp' { return Get-Version @('yt-dlp', (Join-Path $Links 'yt-dlp.exe')) @('--version') '^(\S+)' }
    'obsidian' {
      foreach ($p in @("$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe", "$env:LOCALAPPDATA\Obsidian\Obsidian.exe", "$env:ProgramFiles\Obsidian\Obsidian.exe")) {
        if (Test-Path -LiteralPath $p) {
          $v = (Get-Item -LiteralPath $p).VersionInfo.ProductVersion
          if ($v) { return $v.Trim() }
          return 'installed'
        }
      }
      return $null
    }
  }
  return $null
}

$Tools = @(
  @{ Name = 'git'; Label = 'Git'; Id = 'Git.Git' },
  @{ Name = 'node'; Label = 'Node'; Id = 'OpenJS.NodeJS.LTS' },
  @{ Name = 'python'; Label = 'Python 3.12'; Id = 'Python.Python.3.12' },
  @{ Name = 'ffmpeg'; Label = 'ffmpeg, the video tool'; Id = 'Gyan.FFmpeg' },
  @{ Name = 'gh'; Label = "GitHub's tool (gh)"; Id = 'GitHub.cli' },
  @{ Name = 'yt-dlp'; Label = 'yt-dlp, the YouTube transcript tool'; Id = 'yt-dlp.yt-dlp' },
  @{ Name = 'obsidian'; Label = 'Obsidian'; Id = 'Obsidian.Obsidian' }
)

function Test-Have([string]$Name) {
  $v = Get-ToolVersion $Name
  return ($v -and -not ([string]$v).StartsWith('!'))
}

# Prints one OK or MISSING line per tool. Answers $true only when every tool is here.
function Show-Report {
  $all = $true
  foreach ($t in $Tools) {
    $v = Get-ToolVersion $t.Name
    if ($v -and -not ([string]$v).StartsWith('!')) {
      Say "OK $($t.Name) $v"
    } else {
      $all = $false
      if ($v) { Say "MISSING $($t.Name) ($(([string]$v).Substring(1)))" } else { Say "MISSING $($t.Name)" }
    }
  }
  return $all
}

function StopHere([string]$m) { Say "STOPPED: $m"; exit 1 }

Update-PathFromWindows

if ($Check) {
  if (Show-Report) { Say 'ALL TOOLS READY'; exit 0 }
  Say 'Some tools are missing. Run install-tools.ps1 with no option to add them.'
  exit 1
}

if ($DryRun) { Say 'Dry run: nothing on this PC changes.' }
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { StopHere 'This step is for a Windows PC. On a Mac use install-tools.sh.' }

$HasWinget = [bool](Get-Command winget.exe -ErrorAction SilentlyContinue)
$NeedWinget = $false
foreach ($t in $Tools) { if (-not (Test-Have $t.Name)) { $NeedWinget = $true } }
if ($NeedWinget -and -not $HasWinget) {
  if ($DryRun) {
    Say 'Would open the Microsoft Store page for App Installer (it brings winget)'
  } else {
    try { Start-Process 'ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1' } catch { }
    Say "A Microsoft Store window opened behind the Claude window for App Installer, which brings winget, the tool that installs the rest: click Update (or Get), wait until it's done, then tell your clone to run this step again."
    exit 3
  }
}

$said = $false
foreach ($t in $Tools) {
  if (Test-Have $t.Name) {
    Say "$($t.Label) is already here ($(Get-ToolVersion $t.Name)). Skipping."
    continue
  }
  $cmd = "winget install --id $($t.Id) -e --source winget --silent --accept-package-agreements --accept-source-agreements"
  if ($DryRun) { Say "Would run: $cmd"; continue }
  if (-not $said) {
    Say 'If Windows asks to allow changes, click Yes. That box can hide behind the Claude window.'
    $said = $true
  }
  Say "Installing $($t.Label)..."
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # winget's own progress lines stay out of the chat; the check below decides if it worked.
    & winget.exe install --id $t.Id -e --source winget --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  Update-PathFromWindows
  if (-not (Test-Have $t.Name)) { StopHere "$($t.Label) didn't install (winget answered $code). Check your internet, then run this step again." }
  Say "$($t.Label) is ready ($(Get-ToolVersion $t.Name))."
}

if ($DryRun) { Say 'Dry run done. Nothing was changed.'; exit 0 }
Say ''
if (Show-Report) { Say 'ALL TOOLS READY'; exit 0 }
StopHere "Some tools still aren't here. Run this step again."
