# Shared pieces for the PC voice scripts (setup-voice.ps1, setup-speechify.ps1, setup-keys.ps1, check-voice.ps1).
# Each of those loads this file first. Nothing here runs on its own, and no key or password is ever written anywhere.
# This file stays plain ASCII: Windows PowerShell 5.1 misreads anything else in a script saved without a BOM.

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$PhoneDir  = Join-Path $env:USERPROFILE '.youcloned-phone'
$VoiceDir  = Join-Path $env:USERPROFILE '.voicemode'
$EnvFile   = Join-Path $VoiceDir 'voicemode.env'
$Helper    = Join-Path $PhoneDir 'pc_voice.py'
$TaskName  = 'YouCloned Voice'
$RunKey    = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$StatusPort = 8897
$VoiceModeVersion = '8.12.0'

function Say($m)      { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)       { Write-Host "    OK: $m" -ForegroundColor Green }
function Info($m)     { Write-Host "    $m" }
function StopHere($m) { Write-Host ''; Write-Host "STOPPED: $m" -ForegroundColor Red; exit 1 }

# Picks up programs that winget just installed, without opening a new window.
function Update-PathFromWindows {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$m;$u"
}

function Test-Arm {
  try { return ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -eq 'Arm64') }
  catch { return ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') }
}

# On a PC with an ARM chip, VoiceMode and Kokoro run on the regular (x64) Python, which Windows runs for them.
# Two pieces they need come ready-made only for x64, so this avoids building them from source.
function Get-PythonRequest([string]$Version) {
  if (Test-Arm) { return "cpython-$Version-windows-x86_64-none" }
  return $Version
}

function Find-Uv {
  $c = Get-Command uv.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @((Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\uv.exe'), (Join-Path $env:USERPROFILE '.local\bin\uv.exe'))) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

function Find-Ffmpeg {
  $c = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $link = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
  if (Test-Path -LiteralPath $link) { return $link }
  $pk = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path -LiteralPath $pk) {
    $f = Get-ChildItem -LiteralPath $pk -Directory -Filter 'Gyan.FFmpeg*' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue } |
      Select-Object -First 1
    if ($f) { return $f.FullName }
  }
  return $null
}

# VoiceMode's own Python (it comes with VoiceMode) runs every helper, so the buyer never installs Python separately.
function Get-VoiceTool {
  $uv = Find-Uv
  if (-not $uv) { return $null }
  $dir = (& $uv tool dir 2>$null | Select-Object -Last 1)
  if (-not $dir) { return $null }
  $py = Join-Path ([string]$dir).Trim() 'voice-mode\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $py)) { return $null }
  $pyw = Join-Path (Split-Path -Parent $py) 'pythonw.exe'
  if (-not (Test-Path -LiteralPath $pyw)) {
    $base = (& $py -c 'import sys; print(sys.base_prefix)' 2>$null | Select-Object -Last 1)
    if ($base) { $pyw = Join-Path ([string]$base).Trim() 'pythonw.exe' }
  }
  return [pscustomobject]@{ Uv = $uv; Py = $py; PyW = $pyw }
}

# Reads or writes one line of ~/.voicemode/voicemode.env (the same settings file VoiceMode uses on a Mac).
function Get-VoiceEnv([string]$Name) {
  if (-not (Test-Path -LiteralPath $EnvFile)) { return '' }
  foreach ($l in [IO.File]::ReadAllLines($EnvFile)) {
    if ($l.StartsWith("$Name=")) { return $l.Substring($Name.Length + 1).Trim() }
  }
  return ''
}

function Set-VoiceEnv([string]$Name, [string]$Value) {
  New-Item -ItemType Directory -Force -Path $VoiceDir | Out-Null
  $out = New-Object System.Collections.Generic.List[string]
  $found = $false
  if (Test-Path -LiteralPath $EnvFile) {
    foreach ($l in [IO.File]::ReadAllLines($EnvFile)) {
      if ($l.StartsWith("$Name=")) { if (-not $found) { $out.Add("$Name=$Value") }; $found = $true }
      else { $out.Add($l) }
    }
  }
  if (-not $found) { $out.Add("$Name=$Value") }
  [IO.File]::WriteAllLines($EnvFile, $out.ToArray(), (New-Object Text.UTF8Encoding $false))
}

# True when something on this PC answers that address with 200. curl.exe comes with Windows 10 and 11.
function Test-Port([int]$Port, [string]$Path = '/') {
  $code = & curl.exe -s -m 3 -o NUL -w '%{http_code}' "http://127.0.0.1:$Port$Path" 2>$null
  return ([string]$code -eq '200')
}

# Downloads one file. With a checksum, a file that doesn't match is thrown away.
function Get-Download([string]$Url, [string]$Out, [string]$Sha256) {
  $part = "$Out.part"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
  & curl.exe -L --fail --retry 3 --progress-bar -o $part $Url
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $part)) { return $false }
  if ($Sha256) {
    $h = (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash.ToLower()
    if ($h -ne $Sha256) { Remove-Item -LiteralPath $part -Force; return $false }
  }
  Move-Item -LiteralPath $part -Destination $Out -Force
  return $true
}

# Puts the helper files where the login task runs them from. Returns $true when pc_voice.py changed.
function Copy-PhoneFiles([string]$From) {
  New-Item -ItemType Directory -Force -Path $PhoneDir | Out-Null
  $changed = $true
  $src = Join-Path $From 'pc_voice.py'
  if (Test-Path -LiteralPath $Helper) {
    $changed = ((Get-FileHash -LiteralPath $src).Hash -ne (Get-FileHash -LiteralPath $Helper).Hash)
  }
  foreach ($f in @('pc_voice.py', 'speechify-voice.py')) {
    Copy-Item -LiteralPath (Join-Path $From $f) -Destination (Join-Path $PhoneDir $f) -Force
  }
  return $changed
}

# Starts the hidden helper that keeps the voice running, and makes it start every time you sign in to Windows.
# A Task Scheduler task first; if Windows won't take it, the per-user Run list (no administrator needed for either).
function Start-VoiceHelper([switch]$Restart) {
  $tool = Get-VoiceTool
  if (-not $tool) { return $false }
  if ($Restart -and (Test-Port $StatusPort '/')) { & $tool.Py $Helper stop-services | Out-Null }
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $cmdArgs = '"' + $Helper + '" services'
  $registered = $false
  try {
    $action = New-ScheduledTaskAction -Execute $tool.PyW -Argument $cmdArgs -WorkingDirectory $PhoneDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
      -Description 'Keeps your clone''s voice running (YouCloned Command).' -Force -ErrorAction Stop | Out-Null
    $registered = $true
    Remove-ItemProperty -Path $RunKey -Name $TaskName -ErrorAction SilentlyContinue
  } catch {
    # Set-ItemProperty only adds one value; the Run list's other startup programs are never touched.
    Set-ItemProperty -Path $RunKey -Name $TaskName -Value ('"' + $tool.PyW + '" ' + $cmdArgs)
  }
  if (-not (Test-Port $StatusPort '/')) {
    if ($registered) { Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 10 -and -not (Test-Port $StatusPort '/'); $i++) { Start-Sleep -Seconds 1 }
  }
  if (-not (Test-Port $StatusPort '/')) {
    Start-Process -FilePath $tool.PyW -ArgumentList $cmdArgs -WorkingDirectory $PhoneDir -WindowStyle Hidden
    for ($i = 0; $i -lt 10 -and -not (Test-Port $StatusPort '/'); $i++) { Start-Sleep -Seconds 1 }
  }
  return (Test-Port $StatusPort '/')
}

function Get-HelperStatus {
  $raw = & curl.exe -s -m 3 "http://127.0.0.1:$StatusPort/" 2>$null
  if (-not $raw) { return $null }
  try { return ($raw | Out-String | ConvertFrom-Json) } catch { return $null }
}

# The Claude desktop app and the Claude Code copies it runs. A claude.exe you installed yourself for Terminal use is left alone.
function Get-ClaudeApp {
  @(Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object {
      $p = $null
      try { $p = $_.Path } catch { }
      -not ($p -and ($p -like '*\.local\bin\*' -or $p -like '*\WinGet\*' -or $p -like '*\npm\*'))
    })
}
