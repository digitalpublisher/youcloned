YouCloned guards pack
This folder adds local safety checks to a Claude Code clone.
It uses plain Node and has no package dependencies.
secret-write-guard.mjs checks Write, Edit, and MultiEdit requests.
command-guard.mjs checks Bash requests.
banned-words-guard.mjs uses the member's optional bans file.
Put bans in ~/.youcloned/bans.json.
The bans file has words, phrases, and message fields.
settings-merge.mjs installs or removes Claude Code hook entries.
Run node settings-merge.mjs --install to add the entries.
Run node settings-merge.mjs --uninstall to remove only those entries.
install-git-hooks.mjs installs or removes the Git hooks.
Run node install-git-hooks.mjs --install to add them.
Run node install-git-hooks.mjs --uninstall to remove them.
Run node install-git-hooks.mjs --verify [repo] to prove a planted test key is refused.
The Git hooks scan staged content and outgoing commit content.
Use a git-ignored env file or a host secret store for real keys.
The guards never print matched key values.
All files work on macOS, Linux, and Windows with Node.
Run node --test guards to check the pack.
Run the ship gate before distributing a copy.
