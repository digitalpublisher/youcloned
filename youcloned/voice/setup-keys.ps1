# Adds the two voice keys to this PC: Ctrl+Alt+N (cut your clone off, or say you're done talking) and
# Ctrl+Alt+S (stop the voice). The PC twin of setup-keys.sh, where the keys are Control+Option+N and Control+Option+S.
# Run by setup-voice.ps1. To take the keys out again:
#   powershell -NoProfile -ExecutionPolicy Bypass -File setup-keys.ps1 remove
# The keys belong to the hidden voice helper, which starts when you sign in, so there's nothing to log out for.
# This file stays plain ASCII: Windows PowerShell 5.1 misreads anything else in a script saved without a BOM.

$Here = $PSScriptRoot
. (Join-Path $Here 'pc-common.ps1')

$Tool = Get-VoiceTool
if (-not $Tool -or -not (Test-Path -LiteralPath $Helper)) {
  Info 'Set up the free voice first (setup-voice.ps1), then come back here.'
  exit 1
}

if ($args.Count -gt 0 -and $args[0] -eq 'remove') {
  & $Tool.Py $Helper set keys off
  Start-Sleep -Seconds 4
  Ok 'voice keys removed'
  exit 0
}

& $Tool.Py $Helper set keys on
if (-not (Test-Port $StatusPort '/')) { [void](Start-VoiceHelper) }

# The helper checks its settings every few seconds, so give it a moment to take the keys from Windows.
$st = $null
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  $st = Get-HelperStatus
  if ($st -and $st.keys -and ($st.keys.next -or $st.keys.error)) { break }
}
if (-not $st) { Info "The voice helper isn't running. Run setup-voice.ps1 again."; exit 1 }
if ($st.keys.next) { Ok 'Ctrl+Alt+N cuts your clone off or ends your turn' }
if ($st.keys.stop) { Ok 'Ctrl+Alt+S stops the voice and goes back to text' }
if (-not ($st.keys.next -and $st.keys.stop)) {
  Info ("Windows didn't give this setup every key. " + $st.keys.error + '. Close the program that uses it, then run this setup again.')
  exit 1
}
exit 0
