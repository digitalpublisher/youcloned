# YouCloned Command install for a Windows PC (Windows 10 or 11, PowerShell).
# Installs, or skips when already there:
#   - Git
#   - Python 3
#   - Node.js
#   - Obsidian
#   - ffmpeg (the video tools your skills use)
#   - GitHub CLI (backs up your clone's brain to GitHub)
#   - uv (runs Python tools such as NotebookLM)
# Everything comes from winget, the app installer built into Windows.
# Makes your YouCloned folder in your home folder if it is not there yet.
#
# This installer never asks for a key or a password and never writes one anywhere.
# Signing in (Claude, GitHub, NotebookLM) happens later, in each tool's own sign-in window.
#
# Usage, in PowerShell, from the folder you saved this file in:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-command.ps1
#
# Idempotent. Safe to run again: it only adds what is missing.

$ErrorActionPreference = "Stop"

function Say($msg)     { Write-Host "YouCloned: $msg" -ForegroundColor Yellow }
function OK($msg)      { Write-Host "OK   $msg" -ForegroundColor Green }
function WarnMsg($msg) { Write-Host "WARN $msg" -ForegroundColor Red }

Say "Starting the YouCloned Command install for Windows"
Say ""

# ----- Pre-check: winget -----
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    WarnMsg "winget is not on this PC. Install App Installer from the Microsoft Store, then run this installer again."
    WarnMsg "App Installer: https://apps.microsoft.com/detail/9NBLGGH4NNS1"
    exit 1
}

# A program winget just installed is on the PATH of new windows only; this brings it into this window too.
function Refresh-Path {
    $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

# Runs a program and answers what it printed, or $null when it failed. Windows PowerShell stops on any
# line a program writes to its error output, so the stop is turned off here.
function Get-Answer([string]$exe, [string[]]$argList) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = & $exe @argList 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) { return $out.Trim() }
    } catch {
    } finally {
        $ErrorActionPreference = $old
    }
    return $null
}

# Windows ships python.exe and python3.exe stand-ins that only open the Microsoft Store, so Python counts
# only when it answers with a Python 3 version.
function Test-Python {
    foreach ($probe in @(@("py", "-3", "--version"), @("python", "--version"), @("python3", "--version"))) {
        if (-not (Get-Command $probe[0] -ErrorAction SilentlyContinue)) { continue }
        $answer = Get-Answer $probe[0] ($probe | Select-Object -Skip 1)
        if ($answer -match "Python 3\.") { return $true }
    }
    return $false
}

$links = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
$tools = @(
    @{ Name = "Git"; Id = "Git.Git"; Commands = @("git"); Url = "https://git-scm.com/download/win";
       Paths = @("$env:ProgramFiles\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe") },
    @{ Name = "Python 3"; Id = "Python.Python.3.12"; Python = $true; Url = "https://www.python.org/downloads/windows/" },
    @{ Name = "Node.js"; Id = "OpenJS.NodeJS.LTS"; Commands = @("node"); Url = "https://nodejs.org";
       Paths = @("$env:ProgramFiles\nodejs\node.exe") },
    @{ Name = "Obsidian"; Id = "Obsidian.Obsidian"; Commands = @(); Url = "https://obsidian.md/download";
       Paths = @("$env:LOCALAPPDATA\Obsidian\Obsidian.exe", "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe", "$env:ProgramFiles\Obsidian\Obsidian.exe") },
    @{ Name = "ffmpeg (video tools)"; Id = "Gyan.FFmpeg"; Commands = @("ffmpeg"); Url = "https://ffmpeg.org/download.html";
       Paths = @("$links\ffmpeg.exe", "$env:ProgramFiles\WinGet\Links\ffmpeg.exe") },
    @{ Name = "GitHub CLI"; Id = "GitHub.cli"; Commands = @("gh"); Url = "https://cli.github.com";
       Paths = @("$env:ProgramFiles\GitHub CLI\gh.exe") },
    @{ Name = "uv (Python tools)"; Id = "astral-sh.uv"; Commands = @("uv"); Url = "https://docs.astral.sh/uv/";
       Paths = @("$links\uv.exe", "$HOME\.local\bin\uv.exe") }
)

# A tool is there when its program answers, sits in its usual folder, or winget lists it as installed.
function Test-Tool($tool) {
    if ($tool.Python) { return (Test-Python) }
    foreach ($c in $tool.Commands) { if (Get-Command $c -ErrorAction SilentlyContinue) { return $true } }
    foreach ($p in $tool.Paths) { if ($p -and (Test-Path -LiteralPath $p)) { return $true } }
    $listed = Get-Answer "winget" @("list", "--id", $tool.Id, "-e", "--accept-source-agreements")
    return [bool]($listed -and $listed -match [regex]::Escape($tool.Id))
}

function Install-Tool($tool) {
    Say "Installing $($tool.Name)... (if Windows asks to allow changes, click Yes)"
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        winget install -e --id $tool.Id --silent --accept-source-agreements --accept-package-agreements
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
    Refresh-Path
    if (Test-Tool $tool) {
        OK "$($tool.Name) installed."
        return $true
    }
    WarnMsg "$($tool.Name) did not install (winget exit code $code). Run this installer again, or install it from $($tool.Url)"
    return $false
}

# ----- Steps 1 to 7: the tools -----
$missing = @()
$step = 0
foreach ($tool in $tools) {
    $step++
    Say "Step $step of $($tools.Count): $($tool.Name)"
    if (Test-Tool $tool) {
        OK "$($tool.Name) already installed. Skipping."
    } elseif (-not (Install-Tool $tool)) {
        $missing += $tool.Name
    }
}

# ----- Step 8: your YouCloned folder -----
Say ""
$folder = Join-Path $HOME "YouCloned"
if (Test-Path -LiteralPath $folder) {
    OK "Your YouCloned folder is already at $folder. Leaving it alone."
} else {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    OK "Made your YouCloned folder at $folder"
}

# ----- Step 9: the Claude app -----
$claudeApp = (Test-Path -LiteralPath "$env:LOCALAPPDATA\AnthropicClaude\claude.exe") -or (Test-Path -LiteralPath "$env:LOCALAPPDATA\Programs\Claude\Claude.exe")
if (-not $claudeApp) {
    try { $claudeApp = [bool](Get-AppxPackage -Name "*Claude*" -ErrorAction SilentlyContinue) } catch { $claudeApp = $false }
}
if ($claudeApp) {
    OK "The Claude app is installed."
} else {
    Say "The Claude app was not found. Download it from https://claude.ai/download and sign in on a paid plan."
}

# ----- Done. Next steps. -----
Say ""
if ($missing.Count -gt 0) {
    WarnMsg ("Still missing: " + ($missing -join ", ") + ". Run this installer again once you are online.")
} else {
    Say "All set. Every tool is installed."
}
Write-Host ""
Write-Host "  1. Quit the Claude app (right-click its icon in the taskbar, then Quit) and open it again,"
Write-Host "     so it sees the tools you just installed."
Write-Host ""
Write-Host "  2. In the Claude app open Customize, then Plugins, then + Add, then Manage marketplaces."
Write-Host "     Add digitalpublisher/youcloned, install YouCloned, and switch Sync automatically on."
Write-Host ""
Write-Host "  3. Open your YouCloned folder in the Claude app's Code tab:"
Write-Host "     $folder"
Write-Host ""
Write-Host "  Talk instead of type: press the Windows key and H together to dictate in any box."
Write-Host ""
Say "Done."
if ($missing.Count -gt 0) { exit 1 }
