# Optional upgrade: switches your clone to a Speechify voice, with the free voice kept as the backup.
# The PC twin of setup-speechify.sh. To go back to the free voice:
#   powershell -NoProfile -ExecutionPolicy Bypass -File setup-speechify.ps1 off
# Your Speechify key is saved only in Windows Credential Manager on this PC, never in a file.
# This file stays plain ASCII: Windows PowerShell 5.1 misreads anything else in a script saved without a BOM.

$Here = $PSScriptRoot
. (Join-Path $Here 'pc-common.ps1')
$SettingsFile = Join-Path $VoiceDir 'speechify.env'   # the voice name and speed only, never the key

$Tool = Get-VoiceTool
if (-not $Tool -or -not (Test-Path -LiteralPath $Helper)) {
  Info 'Set up the free voice first (setup-voice.ps1), then come back here.'
  exit 1
}

if ($args.Count -gt 0 -and $args[0] -eq 'off') {
  & $Tool.Py $Helper set speechify off
  & $Tool.Py $Helper forget-key | Out-Null
  Set-VoiceEnv 'VOICEMODE_TTS_BASE_URLS' 'http://127.0.0.1:8880/v1'
  Ok 'back to the free voice, and your Speechify key is gone from this PC. Close and reopen the Claude app to hear it.'
  exit 0
}

Write-Host ''
Info 'Paste your Speechify API key and press Enter.'
Info 'You see stars instead of the key while you paste. That is normal.'
$Secure = Read-Host -AsSecureString -Prompt '    Key'
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
try { $Key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr) }
$Key = $Key -replace '\s', ''
if ($Key.Length -lt 20) {
  Remove-Variable Key, Secure
  Info "That doesn't look like a full key. Copy it again from Speechify and run this again."
  exit 1
}
# The key reaches Python on its input, never on a command line, and Python saves it in Credential Manager.
$Saved = $Key | & $Tool.Py $Helper save-key
$SaveCode = $LASTEXITCODE
Remove-Variable Key, Secure
if ($SaveCode -ne 0) { Info "Windows Credential Manager didn't take the key. $Saved"; exit 1 }

$SVoice = Read-Host '    Speechify voice name (press Enter to use leonard)'
$SVoice = ($SVoice -replace '[^A-Za-z0-9_-]', '').ToLower()
if (-not $SVoice) { $SVoice = 'leonard' }

New-Item -ItemType Directory -Force -Path $VoiceDir | Out-Null
[IO.File]::WriteAllText($SettingsFile, "SPEECHIFY_VOICE=$SVoice`r`nSPEECHIFY_SPEED=1.0`r`n", [Text.Encoding]::ASCII)
[void](Copy-PhoneFiles $Here)
& $Tool.Py $Helper set speechify on
if (-not (Test-Port $StatusPort '/')) { [void](Start-VoiceHelper) }

for ($i = 0; $i -lt 20 -and -not (Test-Port 8895 '/v1/models'); $i++) { Start-Sleep -Seconds 1 }
$Log = Join-Path $PhoneDir 'speechify-voice.log'
if (-not (Test-Port 8895 '/v1/models')) {
  & $Tool.Py $Helper set speechify off
  Info "The Speechify connector didn't start. Details: $Log"
  exit 1
}

# One short test line through your Speechify account, so a wrong key or voice name shows up now, not mid-conversation.
$Body = Join-Path $env:TEMP 'youcloned-speechify-test.json'
[IO.File]::WriteAllText($Body, '{"input":"Testing.","response_format":"mp3"}', [Text.Encoding]::ASCII)
$Code = & curl.exe -s -m 30 -o NUL -w '%{http_code}' -X POST 'http://127.0.0.1:8895/v1/audio/speech' -H 'Content-Type: application/json' --data-binary "@$Body"
Remove-Item -LiteralPath $Body -Force -ErrorAction SilentlyContinue
if ([string]$Code -ne '200') {
  & $Tool.Py $Helper set speechify off
  & $Tool.Py $Helper forget-key | Out-Null
  $why = ''
  if (Test-Path -LiteralPath $Log) { $why = ((Get-Content -LiteralPath $Log -Tail 1) -replace '.*error: ', '') }
  Info "Speechify didn't accept that key or voice name (it answered: $why)."
  Info 'Your clone stays on the free voice. Check the key and the voice name on Speechify, then run this again.'
  exit 1
}
Set-VoiceEnv 'VOICEMODE_TTS_BASE_URLS' 'http://127.0.0.1:8895/v1,http://127.0.0.1:8880/v1'
Ok "Speechify voice ($SVoice) is on, with the free voice as the backup."
Info 'Close and reopen the Claude app, then type "let''s talk" to hear it.'
exit 0
