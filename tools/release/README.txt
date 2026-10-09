YouCloned release builder

Run from the worktree root.
node tools/release/release.mjs --version X.Y.Z --out dist
Optional installer files are copied under install/.
Optional guards files are copied under guards/.
The ship gate runs before an archive is created.
Use --dry-run to stage, gate, and print the manifest file list.
Tests create temporary fixtures with made-up values only.
Run node --test tools/release/ to verify the builder.
