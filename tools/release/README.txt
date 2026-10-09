YouCloned release builder

Run from the worktree root.
node tools/release/release.mjs --version X.Y.Z --out dist
The old Cursor one-click installer is retired and never goes in the zip.
Optional guards files are copied under guards/.
It also writes youcloned-plugin-X.Y.Z.zip with the plugin at the top level: the file buyers pick in the Claude app (Customize, Plugins, Add, Upload plugin).
The ship gate runs before an archive is created.
Use --dry-run to stage, gate, and print the manifest file list.
Tests create temporary fixtures with made-up values only.
Run node --test tools/release/ to verify the builder.
