# Self-check for youcloned/setup/install-tools.ps1 (#42). No Pester needed.
# Runs the script with -Check and -DryRun in the same PowerShell that runs this file (5.1 or 7) and checks
# the lines against youcloned/setup/tools.json. -Check and -DryRun change nothing on the PC.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup\test_install_tools.ps1
#   add -Install on a throwaway PC (the GitHub runner) to also install what is missing and check again.
# This file stays plain ASCII: Windows PowerShell 5.1 misreads anything else in a script saved without a BOM.

param([switch]$Install)

$ErrorActionPreference = 'Continue'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Script = Join-Path $Repo 'youcloned\setup\install-tools.ps1'
$Contract = Join-Path $Repo 'youcloned\setup\tools.json'
$script:Pass = 0
$script:Fail = 0

function Expect([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { $script:Pass++; Write-Host "ok   $Name" }
  else { $script:Fail++; Write-Host "FAIL $Name"; if ($Detail) { $Detail -split "`n" | ForEach-Object { Write-Host "     | $_" } } }
}

if ($PSVersionTable.PSEdition -eq 'Core') { $Shell = Join-Path $PSHOME 'pwsh.exe' } else { $Shell = Join-Path $PSHOME 'powershell.exe' }
Write-Host "PowerShell $($PSVersionTable.PSVersion) ($Shell)"

function Invoke-Tools([string[]]$More) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $Shell -NoProfile -ExecutionPolicy Bypass -File $Script @More 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  return [pscustomobject]@{ Out = $out.Trim(); Code = $code; Lines = @($out.Trim() -split "\r?\n") }
}

Write-Host '== static checks'
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$null, [ref]$errs)
Expect 'install-tools.ps1 parses' (@($errs).Count -eq 0) (($errs | ForEach-Object { $_.ToString() }) -join "`n")
$bytes = [IO.File]::ReadAllBytes($Script)
Expect 'install-tools.ps1 is plain ASCII' (@($bytes | Where-Object { $_ -gt 127 }).Count -eq 0)
$tools = @((Get-Content -LiteralPath $Contract -Raw | ConvertFrom-Json).tools | Where-Object { $_.pc })
$names = @($tools | ForEach-Object { $_.name })
Expect 'tools.json lists seven PC tools' ($names.Count -eq 7) ($names -join ' ')

Write-Host '== -Check'
$c = Invoke-Tools @('-Check')
$seen = @($c.Lines | Where-Object { $_ -match '^(OK|MISSING) ' } | ForEach-Object { ($_ -split ' ')[1] })
Expect '-Check prints one line per tool, in the order of tools.json' (($seen -join ' ') -eq ($names -join ' ')) $c.Out
$missing = @($c.Lines | Where-Object { $_ -match '^MISSING ' } | ForEach-Object { ($_ -split ' ')[1] })
if ($missing.Count -eq 0) {
  Expect '-Check with everything here exits 0 and ends with ALL TOOLS READY' (($c.Code -eq 0) -and ($c.Lines[-1] -eq 'ALL TOOLS READY')) $c.Out
} else {
  Expect '-Check with tools missing exits 1 and never says ALL TOOLS READY' (($c.Code -eq 1) -and ($c.Out -notmatch 'ALL TOOLS READY')) $c.Out
}
Write-Host "missing here: $($missing -join ' ')"

Write-Host '== -DryRun'
$d = Invoke-Tools @('-DryRun')
Expect '-DryRun exits 0' ($d.Code -eq 0) $d.Out
Expect '-DryRun installs nothing' ($d.Out -notmatch '(?m)^Installing ') $d.Out
foreach ($t in $tools) {
  $ids = @{ 'git' = 'Git.Git'; 'node' = 'OpenJS.NodeJS.LTS'; 'python' = 'Python.Python.3.12'; 'ffmpeg' = 'Gyan.FFmpeg'; 'gh' = 'GitHub.cli'; 'yt-dlp' = 'yt-dlp.yt-dlp'; 'obsidian' = 'Obsidian.Obsidian' }
  $would = $d.Out.Contains("Would run: winget install --id $($ids[$t.name]) -e --source winget --silent --accept-package-agreements --accept-source-agreements")
  if ($missing -contains $t.name) { Expect "-DryRun would install $($t.name)" $would $d.Out }
  else { Expect "-DryRun skips $($t.name)" ((-not $would) -and $d.Out.Contains('is already here')) $d.Out }
}
$c2 = Invoke-Tools @('-Check')
Expect '-DryRun changed nothing (-Check answers the same)' ($c2.Out -eq $c.Out) $c2.Out

if ($Install) {
  Write-Host '== install, then install again'
  $i = Invoke-Tools @()
  Expect 'first run ends with ALL TOOLS READY' (($i.Code -eq 0) -and ($i.Lines[-1] -eq 'ALL TOOLS READY')) $i.Out
  $j = Invoke-Tools @()
  $skips = @($j.Lines | Where-Object { $_ -match 'is already here' }).Count
  Expect 'second run skips all seven tools' (($j.Code -eq 0) -and ($skips -eq 7)) $j.Out
  $k = Invoke-Tools @('-Check')
  Expect '-Check after install exits 0' (($k.Code -eq 0) -and ($k.Lines[-1] -eq 'ALL TOOLS READY')) $k.Out
}

Write-Host ''
Write-Host "$($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail -gt 0) { exit 1 }
exit 0
