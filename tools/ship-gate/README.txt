Ship Gate checks a directory for secrets and buyer-unsafe references.
Run node tools/ship-gate/ship-gate.mjs <dir> from the plugin root.
Add --json for machine-readable findings and a count.
The command exits 1 when findings exist and 0 when the directory is clean.
It skips .git, node_modules, and common binary asset formats.
The gate excludes its own tools/ship-gate directory when scanning a parent.
Findings show a file, line, rule, and masked text only.
Use --denylist path/to/file to add another literal denylist for one run.
Each non-empty, non-comment denylist line is a case-insensitive literal.
Repository literals live in tools/ship-gate/denylist.txt.
Put customer names or emails in ~/.config/youcloned/ship-denylist.txt.
Private denylist matches are reported without revealing their literal.
A comment line # [kind: owner email] in the private list names the kind of every line under it;
a hit then reads denylist:private:owner-email [private]. Private lines match whole words in any case.
The skills pack gate (pack_gate.py and build.sh in the author's staging folder) reads the same private list.
Add exact permitted addresses to tools/ship-gate/allow-emails.txt.
example.com and example.org addresses are always permitted.
A fixes.json (top level or youcloned/) blocks the gate while a yes or adapt row has no buyer_file,
or no check for a computer it isn't n/a on. check is {"mac": "...", "pc": "..."}.
Run node --test tools/ship-gate/ after changes.
