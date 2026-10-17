# YouCloned night-one setup, step "Jon's starter skills", on a PC: the twin of install-skills.sh.
# Downloads the starter skills pack, checks it against its published checksum, and puts each skill where
# Claude finds it (%USERPROFILE%\.claude\skills). Only the pack's own skills are replaced; the owner's own
# skills are never touched. The old "youcloned-setup" skill clashes with this setup, so it is moved to
# %USERPROFILE%\.youcloned\retired-skills instead of deleted.
#   install-skills.ps1           install or refresh the pack
#   install-skills.ps1 -Check    exit 0 only when every skill in skills-pack.txt is installed and the old
#                                "youcloned-setup" skill has been retired
# YOUCLONED_SKILLS_ZIP=<file> uses a local zip (tests), checked against YOUCLONED_SKILLS_SHA256 when set.
# This file stays plain ASCII: Windows PowerShell 5.1 misreads anything else in a script saved without a BOM.
param([switch]$Check)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$List = Join-Path $PSScriptRoot '..\skills-pack.txt'
$Skills = Join-Path $env:USERPROFILE '.claude\skills'
$Url = 'https://youcloned.bnsn.ai/install/skills/youcloned-starter-skills.zip'

function Get-Names {
  Get-Content -LiteralPath $List | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }
}

function Test-Pack {
  $missing = 0
  foreach ($n in Get-Names) {
    if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $Skills $n) 'SKILL.md'))) { Write-Host "MISSING $n"; $missing++ }
  }
  if (Test-Path -LiteralPath (Join-Path (Join-Path $Skills 'youcloned-setup') 'SKILL.md')) {
    Write-Host 'OLD youcloned-setup skill is still installed (it clashes with this setup; running this without -Check moves it aside)'
    $missing++
  }
  return ($missing -eq 0)
}

# .NET hashing: Get-FileHash can be missing when Windows PowerShell starts inside PowerShell 7.
function Get-Sha256([string]$Path) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $fs = [IO.File]::OpenRead($Path)
  try { return (($sha.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $fs.Dispose(); $sha.Dispose() }
}

if ($Check) {
  if (Test-Pack) { Write-Host 'ALL SKILLS READY'; exit 0 }
  exit 1
}

$Work = Join-Path ([IO.Path]::GetTempPath()) ('youcloned-skills-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Work | Out-Null
try {
  $Zip = Join-Path $Work 'pack.zip'
  if ($env:YOUCLONED_SKILLS_ZIP) {
    Copy-Item -LiteralPath $env:YOUCLONED_SKILLS_ZIP -Destination $Zip
    $Want = $env:YOUCLONED_SKILLS_SHA256
  } else {
    Write-Host "Downloading Jon's starter skills pack..."
    try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Zip } catch { Write-Host 'Could not download the skills pack. Check the internet connection and run this again.'; exit 1 }
    try { $Want = ((Invoke-WebRequest -UseBasicParsing -Uri ($Url + '.sha256')).Content -split '\s+')[0] } catch { $Want = '' }
    if (-not $Want) { Write-Host "Could not download the pack's checksum, so the pack was not installed. Run this again in a minute."; exit 1 }
  }
  if ($Want -and ((Get-Sha256 $Zip) -ne $Want.ToLower())) {
    Write-Host 'The skills pack did not match its checksum, so nothing was installed. Run this again; if it happens twice, tell YouCloned support.'
    exit 1
  }

  $Stage = Join-Path $Work 'stage'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Stage)
  $From = Join-Path $Stage 'skills'
  if (-not (Test-Path -LiteralPath $From)) { Write-Host 'The skills pack is not in the expected shape, so nothing was installed.'; exit 1 }
  New-Item -ItemType Directory -Force -Path $Skills | Out-Null

  $Old = Join-Path $Skills 'youcloned-setup'
  if (Test-Path -LiteralPath (Join-Path $Old 'SKILL.md')) {
    $Retired = Join-Path $env:USERPROFILE '.youcloned\retired-skills'
    New-Item -ItemType Directory -Force -Path $Retired | Out-Null
    $Dest = Join-Path $Retired 'youcloned-setup'
    if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force }
    Move-Item -LiteralPath $Old -Destination $Dest
    Write-Host 'Moved the old YouCloned setup skill aside (it clashes with this setup).'
  }

  $New = 0; $Updated = 0; $Kept = 0; $KeptNames = @()
  foreach ($d in Get-ChildItem -LiteralPath $From -Directory) {
    if ($d.Name.StartsWith('.') -or $d.Name -eq 'youcloned-setup') { continue }
    $Target = Join-Path $Skills $d.Name
    if (Test-Path -LiteralPath $Target) {
      $Updated++
      # A pack skill the owner changed is kept: the old copy goes to .youcloned\skills-backup before the refresh.
      $old = @(Get-ChildItem -LiteralPath $Target -Recurse -File | ForEach-Object { $_.FullName.Substring($Target.Length) + ':' + $_.Length + ':' + (Get-Sha256 $_.FullName) }) | Sort-Object
      $neu = @(Get-ChildItem -LiteralPath $d.FullName -Recurse -File | ForEach-Object { $_.FullName.Substring($d.FullName.Length) + ':' + $_.Length + ':' + (Get-Sha256 $_.FullName) }) | Sort-Object
      if (($old -join '|') -ne ($neu -join '|')) {
        $Keep = Join-Path $env:USERPROFILE ('.youcloned\skills-backup\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Force -Path $Keep | Out-Null
        Copy-Item -LiteralPath $Target -Destination (Join-Path $Keep $d.Name) -Recurse
        $Kept++; $KeptNames += $d.Name
      }
    } else { $New++ }
    $Tmp = $Target + '.youcloned-new'
    if (Test-Path -LiteralPath $Tmp) { Remove-Item -LiteralPath $Tmp -Recurse -Force }
    Copy-Item -LiteralPath $d.FullName -Destination $Tmp -Recurse
    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
    Move-Item -LiteralPath $Tmp -Destination $Target
  }
  Write-Host "Installed $New new skills and refreshed $Updated. Your own skills were left as they were."
  if ($Kept -gt 0) { Write-Host "You had changed $Kept of the pack's skills ($($KeptNames -join ', ')), so a copy of each is saved in .youcloned\skills-backup in your user folder before the refresh." }
  if (Test-Pack) { Write-Host 'ALL SKILLS READY'; exit 0 }
  Write-Host 'Some skills from the list are still missing (above). Run this again.'
  exit 1
} finally {
  Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}
