import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest } from "../mods/walkthrough/lib/digest.js";
import { normalize, overlay } from "../mods/walkthrough/lib/walkthrough.js";
import { toMarkdown } from "../mods/walkthrough/lib/export.js";

const PATCH = `diff --git a/src/a.js b/src/a.js
index 1..2 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,3 @@
 keep
-old
+new
 keep
@@ -10,2 +10,3 @@
 x
+added
 y
diff --git a/b.md b/b.md
new file mode 100644
--- /dev/null
+++ b/b.md
@@ -0,0 +1 @@
+hello
`;

const walk = (steps, skipped = []) => {
  const d = buildDigest([{ scope: "working", patch: PATCH }]);
  const w = normalize({ title: "Rename the  flag", summary: "Why it moved.\n\nTwo lines.", parts: [{ title: "Core", blurb: "The flag.", steps }], skipped }, d.idByAlias, d.digestFiles);
  return { w, files: d.files };
};

test("markdown keeps the order, weights, notes and file totals, and leaves the code out", () => {
  const { w, files } = walk([
    { title: "Swap the value", hunks: ["h1"], weight: "key", text: "Old becomes new.", notes: [{ kind: "choice", text: "Could have\nkept old." }] },
    { title: "Greet", hunks: ["h3"], weight: "skim", text: "A new file.", notes: [] },
  ], [{ path: "src/a.js", note: "A spacer line." }]);
  const md = toMarkdown(overlay(w, files), w, { what: "Uncommitted local changes.", model: "Haiku", language: "English", cost: 0.0021 });
  assert.equal(md, `## Rename the flag

Why it moved.

Two lines.

<sub>Uncommitted local changes. · Haiku · English · $0.002</sub>

### Core

The flag.

**1. Swap the value** · **Key change**

Old becomes new.

> **Decision:** Could have kept old.

\`src/a.js\` +1 −1

**2. Greet** · _Context_

A new file.

\`b.md\` +1 −0

### Not covered

Edits in 1 file that no step explains:

- \`src/a.js\` (1 hunk) — A spacer line.
`);
  assert.doesNotMatch(md, /\+new|-old/);
});

test("an outdated step says so, and nothing left over means no Not covered section", () => {
  const { w, files } = walk([{ title: "All", hunks: ["h1", "h2", "h3"], weight: "normal", text: "Everything.", notes: [] }]);
  // The code moved on: the first hunk's edit is different now.
  const now = buildDigest([{ scope: "working", patch: PATCH.replace("+new", "+newer") }]).files;
  const md = toMarkdown(overlay(w, now), w);
  assert.match(md, /\*\*1\. All\*\* · _Outdated_/);
  assert.match(md, /_1 of the 3 hunks this step described changed or are gone\._/);
  assert.match(md, /### Not covered[\s\S]*`src\/a\.js` \(1 hunk\)/);
  assert.doesNotMatch(md, /<sub>/); // no metadata given, no line for it
  assert.doesNotMatch(toMarkdown(overlay(w, files), w), /Not covered/);
});

test("a path holding backticks stays one code span", () => {
  const patch = PATCH.replaceAll("b.md", "we`ird.md");
  const d = buildDigest([{ scope: "working", patch }]);
  const w = normalize({ title: "T", summary: "", parts: [{ title: "P", blurb: "", steps: [{ title: "S", hunks: ["h1", "h2"], weight: "normal", text: "x", notes: [] }] }], skipped: [] }, d.idByAlias, d.digestFiles);
  assert.match(toMarkdown(overlay(w, d.files), w), /- `` we`ird\.md `` \(1 hunk\)/);
});
