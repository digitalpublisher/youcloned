# Adds the two voice keys to this Mac: Control+Option+N (cut your clone off, or say you're done talking) and Control+Option+S (stop the voice).
# Run by setup-voice.sh. To take the keys out again:  bash setup-keys.sh remove

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOMEDIR="$HOME/.youcloned-phone"
SERVICES="$HOME/Library/Services"
PBS=/System/Library/CoreServices/pbs

if [ "${1:-}" = "remove" ]; then
  rm -rf "$SERVICES/Clone Next.workflow" "$SERVICES/Clone Stop.workflow"
  /usr/bin/defaults export pbs - 2>/dev/null | /usr/bin/python3 -c '
import plistlib, sys
d = plistlib.loads(sys.stdin.buffer.read())
for n in ("Clone Next", "Clone Stop"):
    d.get("NSServicesStatus", {}).pop("(null) - %s - runWorkflowAsService" % n, None)
sys.stdout.buffer.write(plistlib.dumps(d))' | /usr/bin/defaults import pbs - 2>/dev/null
  "$PBS" -flush >/dev/null 2>&1
  echo "    OK: voice keys removed"
  exit 0
fi

mkdir -p "$HOMEDIR" "$SERVICES"
cp "$HERE/clone-keys.sh" "$HOMEDIR/clone-keys.sh"

# Builds one Quick Action (a small macOS service) that runs clone-keys.sh with one word.
make_action() {
  local name="$1" word="$2" dir="$SERVICES/$1.workflow/Contents"
  rm -rf "$SERVICES/$1.workflow"
  mkdir -p "$dir"
  cat > "$dir/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>$name</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
		</dict>
	</array>
</dict>
</plist>
PLIST
  cat > "$dir/document.wflow" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>534</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>/bin/bash "\$HOME/.youcloned-phone/clone-keys.sh" $word</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>$(uuidgen)</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>$(uuidgen)</string>
				<key>UUID</key>
				<string>$(uuidgen)</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict/>
				<key>isViewVisible</key>
				<integer>1</integer>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleIDsByPath</key>
		<dict/>
		<key>applicationPaths</key>
		<array/>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>11</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
PLIST
  /usr/bin/xattr -cr "$SERVICES/$1.workflow" 2>/dev/null
}

# Gives a Quick Action its keyboard shortcut. ^ is Control, ~ is Option.
set_key() {
  /usr/bin/defaults write pbs NSServicesStatus -dict-add "\"(null) - $1 - runWorkflowAsService\"" \
    "{ \"enabled_context_menu\" = 1; \"enabled_services_menu\" = 1; \"key_equivalent\" = \"$2\"; \"presentation_modes\" = { ContextMenu = 1; ServicesMenu = 1; }; }"
}

make_action "Clone Next" next
make_action "Clone Stop" stop
set_key "Clone Next" "^~n"
set_key "Clone Stop" "^~s"
"$PBS" -flush >/dev/null 2>&1
"$PBS" -update >/dev/null 2>&1
echo "    OK: Control+Option+N cuts your clone off or ends your turn"
echo "    OK: Control+Option+S stops the voice and goes back to text"
