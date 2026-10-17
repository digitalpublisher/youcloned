# Sets up your clone's free voice on this Windows PC: the listening engine, the speaking voice, the Claude hookup,
# the talk skill and the two voice keys. The PC twin of setup-voice.sh.
# Run it from PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File setup-voice.ps1
# Safe to run again. It skips anything already done and never touches your YouCloned setup.
# No administrator password is needed: everything installs for your Windows user only.
# This file stays plain ASCII: Windows PowerShell 5.1 misreads anything else in a script saved without a BOM.

$Here = $PSScriptRoot
. (Join-Path $Here 'pc-common.ps1')

# Pinned versions. Each download with a checksum is thrown away if it doesn't match.
$WhisperTag = 'b5454'
$WhisperX64 = @{ File = 'whisper-bin-x64.zip'; Sha = '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb' }
$WhisperArm = @{ File = 'whisper-bin-win-cpu-arm64.zip'; Sha = '28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d' }
$WhisperModelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
$WhisperModelSha = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
$KokoroTag = 'v0.2.4'   # the same Kokoro VoiceMode installs on a Mac (github.com/ai-cora/Kokoro-FastAPI)
$KokoroModelBytes = 327212226

Say 'Checking this PC'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { StopHere 'This setup is for a Windows PC. On a Mac, use setup-voice.sh.' }
if ([Environment]::OSVersion.Version.Build -lt 17763) { StopHere 'This PC needs Windows 10 (October 2018 update or newer) or Windows 11. Run Windows Update, then run this setup again.' }
if (Test-Arm) { Info 'This PC has an ARM chip. The voice still works, it just answers a little slower.' }
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { StopHere 'This PC is missing curl, which comes with Windows 10 and 11. Run Windows Update, then run this setup again.' }
Get-ChildItem -LiteralPath $Here -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
Ok 'This PC is ready'

$apps = @(Get-ClaudeApp)
if ($apps.Count -gt 0) {
  Write-Host ''
  Info 'The Claude app is open. It has to close for a few minutes so this setup can add the voice to its settings.'
  Read-Host '    Finish anything you are typing in Claude, then press Enter here and this setup closes it for you' | Out-Null
  foreach ($p in $apps) { try { [void]$p.CloseMainWindow() } catch { } }
  Start-Sleep -Seconds 5
  Get-ClaudeApp | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if (@(Get-ClaudeApp).Count -gt 0) { StopHere "Claude didn't close. Right-click the Claude icon near the clock at the bottom right, click Quit, then run this setup again." }
}
Ok 'Claude is closed'

Say "Picking your clone's free voice"
$Voice = (Get-VoiceEnv 'VOICEMODE_VOICES').Split(',')[0].Trim()
if ($Voice) {
  Ok "Keeping the voice you picked before ($Voice)"
} else {
  Info "Type 1 for a man's voice or 2 for a woman's voice, then press Enter."
  $pick = Read-Host '    Your pick (1 or 2)'
  if ($pick.Trim() -eq '2') { $Voice = 'af_sky' } else { $Voice = 'am_michael' }
  Ok "Voice picked ($Voice)"
}

Say 'Installing the free tools that install the rest (uv and ffmpeg)'
$HasWinget = [bool](Get-Command winget.exe -ErrorAction SilentlyContinue)
$Uv = Find-Uv
if (-not $Uv) {
  if ($HasWinget) { & winget.exe install --id astral-sh.uv -e --silent --accept-package-agreements --accept-source-agreements }
  Update-PathFromWindows
  $Uv = Find-Uv
}
if (-not $Uv) {
  # Astral's own installer, for a PC without winget. It installs for this Windows user only.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command 'irm https://astral.sh/uv/install.ps1 | iex'
  Update-PathFromWindows
  $Uv = Find-Uv
}
if (-not $Uv) { StopHere "uv didn't install. Check your internet and run this setup again." }
$Ffmpeg = Find-Ffmpeg
if (-not $Ffmpeg) {
  if (-not $HasWinget) { StopHere "This PC is missing winget, the tool that installs ffmpeg. Open the Microsoft Store, search for App Installer, click Update (or Get), then run this setup again." }
  & winget.exe install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements
  Update-PathFromWindows
  $Ffmpeg = Find-Ffmpeg
}
if (-not $Ffmpeg) { StopHere "ffmpeg didn't install. Check your internet and run this setup again." }
$FfmpegDir = Split-Path -Parent $Ffmpeg
Ok 'The tools are ready'

Say 'Installing VoiceMode, the free voice add-on for Claude'
$Tool = Get-VoiceTool
$have = ''
if ($Tool) { $have = (& $Tool.Py -c 'import voice_mode; print(voice_mode.__version__)' 2>$null | Select-Object -Last 1) }
if ([string]$have -eq $VoiceModeVersion) {
  Ok "VoiceMode $VoiceModeVersion is already here"
} else {
  # simpleaudio is a spare sound player VoiceMode never needs on Windows, and it has no ready-made Windows build
  # for current Python, so it's left out. VoiceMode plays sound with sounddevice instead.
  $excl = Join-Path $env:TEMP 'youcloned-voicemode-excludes.txt'
  [IO.File]::WriteAllText($excl, "simpleaudio`r`n", [Text.Encoding]::ASCII)
  & $Uv tool install --force --python (Get-PythonRequest '3.12') --excludes $excl "voice-mode==$VoiceModeVersion"
  if ($LASTEXITCODE -ne 0) { StopHere "VoiceMode didn't install. Check your internet and run this setup again. If it says --excludes is unknown, paste: winget upgrade astral-sh.uv , then run this setup again." }
  $Tool = Get-VoiceTool
}
if (-not $Tool) { StopHere "VoiceMode isn't where it should be. Run this setup again." }
# The instant-stop fix: the stop key cuts your clone off in under half a second and it listens to you right after.
# A reinstall puts the stock file back, so this runs every time. If it can't apply, the voice still works, just slower to stop.
& $Tool.Py (Join-Path $Here 'patch-voicemode.py')
if ($LASTEXITCODE -ne 0) { Info 'The instant-stop fix was skipped. The voice still works.' }
$HelperChanged = Copy-PhoneFiles $Here
Ok 'VoiceMode is ready'

Say 'Writing your voice settings'
# Keeps the Speechify voice if you switched it on before; otherwise the free voice.
if ((Get-VoiceEnv 'VOICEMODE_TTS_BASE_URLS') -notlike '*8895*') { Set-VoiceEnv 'VOICEMODE_TTS_BASE_URLS' 'http://127.0.0.1:8880/v1' }
Set-VoiceEnv 'VOICEMODE_VOICES' $Voice
Set-VoiceEnv 'VOICEMODE_TTS_VOICE' $Voice
Set-VoiceEnv 'VOICEMODE_PREFER_LOCAL' 'true'
Set-VoiceEnv 'VOICEMODE_STREAMING_ENABLED' 'true'
Set-VoiceEnv 'VOICEMODE_TTS_FORMAT' 'pcm'
# Off in the shared file: VoiceMode's own key line can't run on Windows. pc_voice.py switches on a PC-safe one for itself.
Set-VoiceEnv 'VOICEMODE_CONTROL_CHANNEL_ENABLED' 'false'
Set-VoiceEnv 'VOICEMODE_VAD_AGGRESSIVENESS' '0'
Set-VoiceEnv 'VOICEMODE_SILENCE_THRESHOLD_MS' '2000'
Set-VoiceEnv 'VOICEMODE_DEFAULT_LISTEN_DURATION' '600'
& $Tool.Py $Helper set ffmpeg_dir $FfmpegDir
Ok 'Settings saved in .voicemode\voicemode.env in your user folder'

Say 'Installing the listening engine (Whisper, about 150 MB)'
$WDir = Join-Path $VoiceDir 'services\whisper'
$WBin = Join-Path $WDir 'bin'
$WExe = Join-Path $WBin 'whisper-server.exe'
$WModel = Join-Path $WDir 'models\ggml-base.bin'
if (-not (Test-Path -LiteralPath $WExe)) {
  $pick = $WhisperX64
  if (Test-Arm) { $pick = $WhisperArm }
  $zip = Join-Path $env:TEMP 'youcloned-whisper.zip'
  $url = "https://github.com/ggml-org/whisper.cpp/releases/download/$WhisperTag/" + $pick.File
  if (-not (Get-Download $url $zip $pick.Sha)) { StopHere "The listening engine didn't download. Check your internet and run this setup again." }
  $tmp = Join-Path $env:TEMP 'youcloned-whisper'
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path $WBin | Out-Null
  Copy-Item -Path (Join-Path $tmp 'Release\*') -Destination $WBin -Recurse -Force
  Get-ChildItem -LiteralPath $WBin -File | Unblock-File -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tmp, $zip -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path -LiteralPath $WExe)) { StopHere "The listening engine didn't install. Run this setup again." }
$needModel = $true
if (Test-Path -LiteralPath $WModel) { $needModel = ((Get-Item -LiteralPath $WModel).Length -ne 147951465) }
if ($needModel -and -not (Get-Download $WhisperModelUrl $WModel $WhisperModelSha)) { StopHere "The listening engine's model didn't download. Check your internet and run this setup again." }
& $Tool.Py $Helper set whisper_exe $WExe
& $Tool.Py $Helper set whisper_model $WModel
Ok 'Listening engine installed (it listens on this PC only)'

Say 'Installing the speaking voice (Kokoro, about 2 GB, the longest part)'
$KDir = Join-Path $VoiceDir 'services\kokoro'
$KPy = Join-Path $KDir '.venv\Scripts\python.exe'
$KMark = Join-Path $KDir '.youcloned-version'
$KModel = Join-Path $KDir 'api\src\models\v1_0\kokoro-v1_0.pth'
$ready = (Test-Path -LiteralPath $KPy) -and (Test-Path -LiteralPath $KMark)
if ($ready) { $ready = ((Get-Content -LiteralPath $KMark -Raw).Trim() -eq $KokoroTag) }
if (-not $ready) {
  if (Test-Port $StatusPort '/') { & $Tool.Py $Helper stop-services | Out-Null }   # frees Kokoro's files before replacing them
  $zip = Join-Path $env:TEMP 'youcloned-kokoro.zip'
  if (-not (Get-Download "https://github.com/ai-cora/Kokoro-FastAPI/archive/refs/tags/$KokoroTag.zip" $zip '')) { StopHere "The speaking voice didn't download. Check your internet and run this setup again." }
  $tmp = Join-Path $env:TEMP 'youcloned-kokoro'
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $inner = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
  if (-not $inner) { StopHere "The speaking voice download was empty. Run this setup again." }
  Remove-Item -LiteralPath $KDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $KDir) | Out-Null
  Move-Item -LiteralPath $inner.FullName -Destination $KDir
  Remove-Item -LiteralPath $tmp, $zip -Recurse -Force -ErrorAction SilentlyContinue
  Push-Location -LiteralPath $KDir
  & $Uv venv --python (Get-PythonRequest '3.10') .venv
  if ($LASTEXITCODE -eq 0) { & $Uv pip install --python $KPy -e '.[cpu]' }
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0 -or -not (Test-Path -LiteralPath $KPy)) { StopHere "The speaking voice didn't install. Check your internet and run this setup again." }
}
$needModel = $true
if (Test-Path -LiteralPath $KModel) { $needModel = ((Get-Item -LiteralPath $KModel).Length -ne $KokoroModelBytes) }
if ($needModel) {
  Push-Location -LiteralPath $KDir
  & $KPy 'docker\scripts\download_model.py' --output 'api\src\models\v1_0'
  Pop-Location
  if (-not (Test-Path -LiteralPath $KModel)) { StopHere "The speaking voice's model didn't download. Check your internet and run this setup again." }
}
[IO.File]::WriteAllText($KMark, $KokoroTag, [Text.Encoding]::ASCII)
& $Tool.Py $Helper set kokoro_dir $KDir
& $Tool.Py $Helper set kokoro_python $KPy
Ok 'Speaking voice installed (the first start takes a few minutes)'

Say 'Starting the voice and setting it to start when you sign in'
if (-not (Start-VoiceHelper -Restart:$HelperChanged)) { StopHere "The voice helper didn't start. Run this setup again. Your clone can also read the log: .youcloned-phone\services.log in your user folder" }
Ok 'The voice starts by itself every time you sign in to Windows'

Say 'Connecting the voice to your clone in the Claude app'
& $Tool.Py (Join-Path $Here 'connect-voice-to-claude.py') --pc $Tool.Py $Helper $FfmpegDir
if ($LASTEXITCODE -ne 0) { StopHere "Couldn't connect the voice to Claude. Run this setup again." }
$skill = Join-Path $env:USERPROFILE '.claude\skills\talk-out-loud'
New-Item -ItemType Directory -Force -Path $skill | Out-Null
Copy-Item -LiteralPath (Join-Path $Here 'talk-out-loud\SKILL.md') -Destination (Join-Path $skill 'SKILL.md') -Force
Ok 'Talk skill added'

Say 'Adding the two voice keys'
& (Join-Path $Here 'setup-keys.ps1')
# A key another program already holds doesn't stop the setup: the voice works without it, and the check below says so.
if ($LASTEXITCODE -ne 0) { Info 'The voice still works without the keys. The check below shows which key is missing.' }

Say 'Testing the voice'
& (Join-Path $Here 'check-voice.ps1') speak
$Result = $LASTEXITCODE
# YouCloned's setup counts the voice step done only after this test passes (marker read by the add-on).
$VoiceOk = Join-Path $env:USERPROFILE '.voicemode\youcloned-voice-ok'
if ($Result -eq 0) { New-Item -ItemType Directory -Force -Path (Split-Path $VoiceOk) | Out-Null; Set-Content -LiteralPath $VoiceOk -Value (Get-Date -Format o) -Encoding ASCII } else { Remove-Item -LiteralPath $VoiceOk -ErrorAction SilentlyContinue }
if ($Result -eq 0) {
  Write-Host ''
  Write-Host 'All set. Open the Claude app again and go back to the guide.' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host "The voice test didn't pass. Wait one minute, then run this setup again. Your clone can also read the log: .youcloned-phone\check.log in your user folder" -ForegroundColor Red
}
exit $Result
