# Checks every piece of your clone's voice on this PC and says what passed. Add the word "speak" to also hear a test line.
# The PC twin of check-voice.sh. Usage, in PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File check-voice.ps1            (or add: speak)
# This file stays plain ASCII: Windows PowerShell 5.1 misreads anything else in a script saved without a BOM.

$Here = $PSScriptRoot
. (Join-Path $Here 'pc-common.ps1')

$Log = Join-Path $PhoneDir 'check.log'
New-Item -ItemType Directory -Force -Path $PhoneDir | Out-Null
[IO.File]::WriteAllText($Log, '', [Text.Encoding]::ASCII)
$script:Fails = 0
$Tmp = Join-Path $env:TEMP ('youcloned-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

function Pass($m) { Write-Host "    PASS: $m" -ForegroundColor Green; Add-Content -LiteralPath $Log -Value "PASS $m" }
function Fail($m) { Write-Host "    FAIL: $m" -ForegroundColor Red; Add-Content -LiteralPath $Log -Value "FAIL $m"; $script:Fails++ }

$Voice = (Get-VoiceEnv 'VOICEMODE_VOICES').Split(',')[0].Trim()
if (-not $Voice) { $Voice = 'am_michael' }

$Tool = Get-VoiceTool
$ver = ''
if ($Tool) { $ver = [string](& $Tool.Py -c 'import voice_mode; print(voice_mode.__version__)' 2>$null | Select-Object -Last 1) }
if ($ver -and (Test-Path -LiteralPath $Helper)) { Pass "VoiceMode is installed ($ver)" } else { Fail 'VoiceMode is missing (run setup-voice.ps1)' }

if (Test-Port $StatusPort '/') { Pass 'The voice helper is running' } else { Fail "The voice helper isn't running (run setup-voice.ps1, or sign out of Windows and back in)" }

# The speaking voice takes a few minutes to wake up the first time, so give it up to 5 minutes.
$up = $false
for ($i = 0; $i -lt 100; $i++) { if (Test-Port 8880 '/v1/models') { $up = $true; break }; Start-Sleep -Seconds 3 }
if ($up) { Pass 'The speaking voice (Kokoro) is running' } else { Fail "The speaking voice (Kokoro) isn't answering" }

$up = $false
for ($i = 0; $i -lt 20; $i++) { if (Test-Port 2022 '/health') { $up = $true; break }; Start-Sleep -Seconds 3 }
if ($up) { Pass 'The listening engine (Whisper) is running' } else { Fail "The listening engine (Whisper) isn't answering" }

$Line = 'Hi, this is your clone. My voice is working, and I can hear you too.'
$Body = Join-Path $Tmp 'speak.json'
$Wav = Join-Path $Tmp 'test.wav'
[IO.File]::WriteAllText($Body, ('{"model":"tts-1","input":"' + $Line + '","voice":"' + $Voice + '","response_format":"wav"}'), [Text.Encoding]::ASCII)
& curl.exe -s -m 60 -X POST 'http://127.0.0.1:8880/v1/audio/speech' -H 'Content-Type: application/json' --data-binary "@$Body" -o $Wav
$Size = 0
if (Test-Path -LiteralPath $Wav) { $Size = (Get-Item -LiteralPath $Wav).Length }
if ($Size -gt 5000) {
  Pass "Your clone spoke a test line ($Voice)"
  if ($args.Count -gt 0 -and $args[0] -eq 'speak') {
    try { (New-Object System.Media.SoundPlayer $Wav).PlaySync() } catch { Add-Content -LiteralPath $Log -Value "could not play: $_" }
  }
} else {
  Fail "Your clone couldn't speak the test line"
}

# Plays the test line into the listening engine and checks it hears the right words.
if ($Size -gt 5000) {
  $In = $Wav
  $Ff = Find-Ffmpeg
  if ($Ff) {
    $Small = Join-Path $Tmp 'test16k.wav'
    & $Ff -loglevel error -y -i $Wav -ar 16000 -ac 1 $Small
    if (Test-Path -LiteralPath $Small) { $In = $Small }
  }
  $Heard = & curl.exe -s -m 60 'http://127.0.0.1:2022/v1/audio/transcriptions' -F "file=@$In" -F 'model=whisper-1' -F 'response_format=json'
  Add-Content -LiteralPath $Log -Value ('heard: ' + ($Heard | Out-String).Trim())
  if (($Heard | Out-String) -match '(?i)voice') { Pass 'The listening engine heard the test line correctly' } else { Fail "The listening engine didn't hear the test line" }
}

# Windows can block every desktop program from the microphone. These are the switches under Settings, Privacy and security, Microphone.
$Mic = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
$all = (Get-ItemProperty -LiteralPath $Mic -Name Value -ErrorAction SilentlyContinue).Value
$desk = (Get-ItemProperty -LiteralPath (Join-Path $Mic 'NonPackaged') -Name Value -ErrorAction SilentlyContinue).Value
if ($all -eq 'Deny' -or $desk -eq 'Deny') {
  Fail 'Windows is blocking desktop apps from the microphone (Settings, Privacy and security, Microphone)'
} else {
  Pass 'Windows lets desktop apps use the microphone'
}

$Connected = $false
if ($Tool) {
  & $Tool.Py -c "import json,os,sys; d=json.load(open(os.path.expanduser('~/.claude.json'), encoding='utf-8')); sys.exit(0 if 'voicemode' in d.get('mcpServers',{}) else 1)" 2>$null
  $Connected = ($LASTEXITCODE -eq 0)
}
if ($Connected) { Pass 'The voice is connected to Claude' } else { Fail "The voice isn't connected to Claude (run setup-voice.ps1)" }
if (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.claude\skills\talk-out-loud\SKILL.md')) { Pass 'The talk skill is in place' } else { Fail 'The talk skill is missing' }

$st = Get-HelperStatus
if ($st -and $st.keys -and $st.keys.next -and $st.keys.stop) { Pass 'The two voice keys are in place' }
elseif ($st -and $st.keys -and $st.keys.error) { Fail ('The voice keys are missing: ' + $st.keys.error) }
else { Fail 'The voice keys are missing (run setup-keys.ps1)' }

if ((Get-VoiceEnv 'VOICEMODE_TTS_BASE_URLS') -like '*8895*') {
  if (Test-Port 8895 '/v1/models') { Pass 'The Speechify voice connector is running' } else { Fail "The Speechify voice connector isn't answering" }
}

Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
if ($script:Fails -eq 0) { Info 'Everything passed.' } else { Info "$($script:Fails) check(s) failed. Details: $Log" }
exit $script:Fails
