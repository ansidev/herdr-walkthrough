import { test } from "node:test";
import assert from "node:assert/strict";
import { hash, shortHash, longHash } from "../mods/walkthrough/lib/hash.js";
import { parseDiff, headerPath, unquote, numberLines, indexHunks } from "../mods/walkthrough/lib/hunks.js";
import { isGenerated } from "../mods/walkthrough/lib/generated.js";
import { buildDigest } from "../mods/walkthrough/lib/digest.js";
import { buildPrompt, sizing } from "../mods/walkthrough/lib/prompt.js";
import { normalize, parseJson, overlay, fileTotals, LIMITS, SCHEMA } from "../mods/walkthrough/lib/walkthrough.js";
import { fromLocale, languageOf } from "../mods/walkthrough/lib/languages.js";
import { cacheKey, codeKey, deadline, placeKey } from "../mods/walkthrough/lib/cache.js";
import { worthReading } from "../mods/walkthrough/lib/sources.js";
import { readOutcome, jobScript, isRunCommand } from "../mods/walkthrough/lib/job.js";
import { runnerOf } from "../mods/walkthrough/lib/runner.js";
import { formatComments, addComment, sameSpot } from "../mods/walkthrough/lib/comments.js";

const PATCH = `diff --git a/src/a.js b/src/a.js
index 1..2 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,3 @@ function a
 keep
-old
+new
 keep
@@ -10,2 +10,3 @@
 x
+-- not a header
 y
diff --git a/new file.txt b/new file.txt
new file mode 100644
--- /dev/null
+++ b/new file.txt\t
@@ -0,0 +1 @@
+hello
\\ No newline at end of file
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
diff --git a/old.js b/moved.js
similarity index 100%
rename from old.js
rename to moved.js
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-{}
+{"v":1}
`;

test("normalize reports aliases when every model step is unusable", () => {
  const d = buildDigest(parseDiff(PATCH, "working"));
  assert.throws(
    () => normalize({ parts: [{ steps: [{ hunks: ["not-a-hunk"], text: "Explanation." }] }] }, d.idByAlias, d.digestFiles),
    (error) => {
      assert.deepEqual(error.expectedAliases, Object.keys(d.idByAlias));
      assert.deepEqual(error.returnedAliases, ["not-a-hunk"]);
      return true;
    },
  );
});

test("hash is stable and seeded", () => {
  assert.equal(hash("abc"), hash("abc"));
  assert.notEqual(hash("abc"), hash("abd"));
  assert.notEqual(hash("abc", 1), hash("abc", 2));
  assert.equal(shortHash("x").length, 8);
  assert.equal(longHash("x").length, 28);
});

test("parseDiff finds files, statuses and hunks", () => {
  const files = parseDiff(PATCH, "working");
  assert.deepEqual(files.map((f) => [f.path, f.status, f.hunks.length, f.binary]), [
    ["src/a.js", "modified", 2, false],
    ["new file.txt", "added", 1, false],
    ["img.png", "modified", 0, true],
    ["moved.js", "renamed", 0, false],
    ["package-lock.json", "modified", 1, false],
  ]);
  assert.equal(files[3].oldPath, "old.js");
  const [h1, h2] = files[0].hunks;
  assert.equal(h1.added, 1);
  assert.equal(h1.deleted, 1);
  // A removed or added "-- x" inside a hunk is content, not a header.
  assert.equal(h2.added, 1);
  assert.ok(h1.id.startsWith("working:src/a.js:"));
  assert.ok(files[1].hunks[0].lines.includes("\\ No newline at end of file"));
});

test("hunk ids follow content: an edit renames only its own hunk", () => {
  const a = parseDiff(PATCH, "working")[0].hunks.map((h) => h.id);
  const b = parseDiff(PATCH.replace("+new", "+newer"), "working")[0].hunks.map((h) => h.id);
  assert.notEqual(a[0], b[0]);
  assert.equal(a[1], b[1]);
  // A line added above a hunk moves it without changing it: its id stays.
  const shifted = PATCH.replace("@@ -1,3 +1,3 @@ function a\n keep\n-old\n+new", "@@ -1,3 +1,4 @@ function a\n keep\n-old\n+new\n+added").replace("@@ -10,2 +10,3 @@", "@@ -10,2 +11,3 @@");
  const c = parseDiff(shifted, "working")[0].hunks.map((h) => h.id);
  assert.notEqual(c[0], a[0]);
  assert.equal(c[1], a[1]);
  // The scope keeps staged and unstaged copies of the same lines apart.
  assert.notEqual(parseDiff(PATCH, "staged")[0].hunks[0].id, a[0]);
});

test("a merge conflict is listed unread, and the file before it keeps its own name", () => {
  const patch = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-one
+ONE
diff --cc b.txt
index 1,2..0
--- a/b.txt
+++ b/b.txt
@@@ -1,1 -1,1 +1,5 @@@
++<<<<<<< HEAD
 +ours
++=======
+ theirs
++>>>>>>> other
diff --git a/c.txt b/c.txt
--- a/c.txt
+++ b/c.txt
@@ -1 +1 @@
-x
+y
`;
  const files = parseDiff(patch, "working");
  assert.deepEqual(files.map((f) => [f.path, f.status, f.hunks.length]), [["a.txt", "modified", 1], ["b.txt", "conflicted", 0], ["c.txt", "modified", 1]]);
  assert.ok(files[0].hunks[0].id.startsWith("working:a.txt:"));
  const d = buildDigest([{ scope: "working", patch }]);
  const w = normalize({ title: "T", summary: "", skipped: [], parts: [{ title: "P", blurb: "", steps: [{ title: "S", hunks: ["h1", "h2"], weight: "normal", text: "x", notes: [] }] }] }, d.idByAlias, d.digestFiles);
  assert.deepEqual(overlay(w, d.files).uncovered.map((u) => [u.file.path, u.note]), [["b.txt", "Merge conflict: not read. Resolve it, and it is read again."]]);
});

test("identical hunks in one file get distinct ids", () => {
  const patch = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-a
+b
@@ -1 +1 @@
-a
+b
`;
  const [first, second] = parseDiff(patch)[0].hunks;
  assert.equal(second.id, `${first.id}-2`);
});

test("paths: spaces, quotes and octal escapes", () => {
  assert.equal(headerPath("diff --git a/a b/c.txt b/a b/c.txt"), "a b/c.txt");
  assert.equal(headerPath("diff --git a/x.js b/y.js"), "y.js");
  assert.equal(unquote("\"caf\\303\\251 \\\"q\\\".txt\""), "café \"q\".txt");
  assert.equal(headerPath("diff --git \"a/caf\\303\\251\" \"b/caf\\303\\251\""), "café");
});

test("numberLines numbers old and new sides", () => {
  const hunk = parseDiff(PATCH)[0].hunks[0];
  assert.deepEqual(numberLines(hunk).map((l) => [l.kind, l.number]), [[" ", 1], ["-", 2], ["+", 2], [" ", 3]]);
});

test("generated files are recognised by name, conservatively", () => {
  for (const p of ["package-lock.json", "a/yarn.lock", "go.sum", "dist/app.min.js", "x.js.map", "api.pb.go", "src/__snapshots__/a.snap", "gen/types.generated.ts"]) assert.ok(isGenerated(p), p);
  for (const p of ["src/lock.ts", "codegen.py", "src/generator.ts", "README.md", ""]) assert.ok(!isGenerated(p), p);
});

test("buildDigest aliases reviewable hunks and leaves generated ones out", () => {
  const d = buildDigest([{ scope: "working", patch: PATCH }]);
  assert.equal(d.hunkCount, 3);
  assert.deepEqual(Object.keys(d.idByAlias), ["h1", "h2", "h3"]);
  assert.deepEqual(d.generatedPaths, ["package-lock.json"]);
  assert.match(d.text, /=== src\/a\.js \[working\]\n\[h1\] @@ -1,3 \+1,3 @@ function a/);
  assert.match(d.text, /=== moved\.js \(renamed from old\.js\)/);
  assert.ok(!d.text.includes("package-lock"));
  assert.equal(d.files.length, 5);
});

test("buildPrompt sizes the ask and adds the language only when not English", () => {
  const en = buildPrompt({ digest: "D", fileCount: 1, hunkCount: 10, what: "W" });
  assert.match(en.prompt, /Aim for about 4 step\(s\)/);
  assert.ok(en.prompt.endsWith("D"));
  assert.ok(!en.system.includes("Write all prose in"));
  const tr = buildPrompt({ digest: "D", fileCount: 1, hunkCount: 10, what: "W", language: "tr", preferences: "Be brief." });
  assert.match(tr.system, /Write all prose in Turkish/);
  assert.match(tr.system, /<preferences>\nBe brief\.\n<\/preferences>/);
  const again = buildPrompt({ digest: "D", fileCount: 1, hunkCount: 2, what: "W", previous: { title: "Old", parts: [{ title: "P", blurb: "", steps: [{ title: "S", text: "T" }] }] } });
  assert.match(again.prompt, /Earlier walkthrough, "Old":\n- P\n {2}- S: T/);
  assert.deepEqual(sizing(2), { steps: 1, parts: 1, key: 1, notes: 1 });
  assert.equal(sizing(1000).steps, LIMITS.steps);
});

test("the schema requires every field it describes", () => {
  const walk = (s) => {
    if (s.type === "object") {
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      assert.equal(s.additionalProperties, false);
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === "array") walk(s.items);
  };
  walk(SCHEMA);
});

const digest = () => buildDigest([{ scope: "working", patch: PATCH }]);

test("normalize keeps real anchors and drops the rest", () => {
  const d = digest();
  const w = normalize({
    title: " T ", summary: "S",
    parts: [
      { title: "A part with a very long title indeed", blurb: "b", steps: [
        { title: "One", hunks: ["h1", "[h2]", "h99", "h1"], weight: "key", text: "Explains.", notes: [{ kind: "choice", text: "N" }, { kind: "verdict", text: "X" }, { kind: "gap", text: "" }] },
        { title: "Empty", hunks: ["h404"], weight: "normal", text: "Nothing real." },
        { title: "Two", hunks: ["h1", "h3"], weight: "loud", text: "More." },
      ] },
      { title: "Nothing", blurb: "", steps: [] },
    ],
    skipped: [{ path: "src/a.js", note: "covered, so dropped" }, { path: "zzz", note: "unknown" }],
  }, d.idByAlias, d.digestFiles);
  assert.equal(w.title, "T");
  assert.equal(w.parts.length, 1);
  assert.equal(w.parts[0].title.length, LIMITS.partTitle);
  assert.deepEqual(w.parts[0].steps.map((s) => [s.id, s.title, s.hunkIds.length, s.weight]), [["s1", "One", 2, "key"], ["s2", "Two", 1, "normal"]]);
  assert.deepEqual(w.parts[0].steps[0].notes, [{ kind: "choice", text: "N" }]);
  assert.equal(w.dropped, 2);
  assert.deepEqual(w.skipped, []);
});

test("normalize keeps a skipped note for a file a step left out", () => {
  const d = digest();
  const w = normalize({ title: "T", summary: "", parts: [{ title: "P", blurb: "", steps: [{ title: "S", hunks: ["h1"], weight: "normal", text: "x", notes: [] }] }],
    skipped: [{ path: "src/a.js", note: "The second hunk is a comment." }, { path: "src/a.js", note: "dup" }, { path: "new file.txt", note: "Greeting." }] }, d.idByAlias, d.digestFiles);
  assert.deepEqual(w.skipped, [{ path: "src/a.js", note: "The second hunk is a comment." }, { path: "new file.txt", note: "Greeting." }]);
});

test("a dropped step leaves its hunks free", () => {
  const d = digest();
  const w = normalize({ title: "T", summary: "", skipped: [{ path: "new file.txt", note: "Greeting." }], parts: [{ title: "P", blurb: "", steps: [
    { title: "Empty", hunks: ["h1", "h3"], weight: "normal", text: " ", notes: [] },
    { title: "Real", hunks: ["h1"], weight: "normal", text: "x", notes: [] },
  ] }] }, d.idByAlias, d.digestFiles);
  assert.deepEqual(w.parts[0].steps.map((s) => s.title), ["Real"]);
  assert.equal(w.parts[0].steps[0].hunkIds.length, 1);
  // h3 was never claimed, so its file's note survives.
  assert.deepEqual(w.skipped, [{ path: "new file.txt", note: "Greeting." }]);
});

test("normalize refuses an answer with no usable step", () => {
  const d = digest();
  assert.throws(() => normalize({ parts: [{ steps: [{ hunks: ["h9"], text: "x" }] }] }, d.idByAlias, d.digestFiles), /no usable steps/);
  assert.throws(() => normalize(null, {}, []), /no walkthrough/);
});

test("parseJson takes fenced and wrapped answers", () => {
  assert.deepEqual(parseJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(parseJson("Here: {\"a\":{\"b\":2}} done."), { a: { b: 2 } });
  assert.deepEqual(parseJson({ a: 1 }), { a: 1 });
  assert.throws(() => parseJson("no json"), /not JSON/);
  assert.throws(() => parseJson(""), /empty/);
});

test("overlay marks outdated steps and lists what no step covers", () => {
  const d = digest();
  const w = normalize({ title: "T", summary: "", skipped: [{ path: "new file.txt", note: "Greeting." }],
    parts: [{ title: "P", blurb: "", steps: [{ title: "S", hunks: ["h1", "h2"], weight: "normal", text: "x", notes: [] }] }] }, d.idByAlias, d.digestFiles);
  const fresh = overlay(w, d.files);
  assert.equal(fresh.outdated, 0);
  assert.deepEqual(fresh.uncovered.map((u) => [u.file.path, u.hunks.length, u.note]), [
    ["new file.txt", 1, "Greeting."],
    ["img.png", 0, "Binary file."],
    ["moved.js", 0, ""],
    ["package-lock.json", 1, "Generated file, not sent to the model."],
  ]);
  const later = buildDigest([{ scope: "working", patch: PATCH.replace("+new", "+newer") }]);
  const stale = overlay(w, later.files);
  assert.equal(stale.outdated, 1);
  assert.equal(stale.steps[0].found.length, 1);
  assert.equal(stale.steps[0].missing, 1);
  // The edited hunk is new code nobody has explained: it shows at the end.
  assert.ok(stale.uncovered.some((u) => u.file.path === "src/a.js" && u.hunks.length === 1));
  assert.deepEqual(fileTotals(fresh.steps[0].found), [{ path: "src/a.js", added: 2, deleted: 1 }]);
  assert.equal(indexHunks(d.files).size, 4);
});

test("languages come from a locale, defaulting to English", () => {
  assert.equal(fromLocale("tr-TR"), "tr");
  assert.equal(fromLocale("pt_BR.UTF-8"), "pt");
  assert.equal(fromLocale("xx"), "en");
  assert.equal(fromLocale(undefined), "en");
  assert.equal(languageOf("de").english, "German");
});

test("cache keys change with the code, model and language", () => {
  const d = digest();
  const base = { top: "/r", source: "uncommitted", model: "haiku", language: "en", files: d.files };
  const k = cacheKey(base);
  assert.equal(k, cacheKey({ ...base }));
  assert.notEqual(k, cacheKey({ ...base, model: "opus" }));
  assert.notEqual(k, cacheKey({ ...base, language: "tr" }));
  assert.notEqual(k, cacheKey({ ...base, files: buildDigest([{ scope: "working", patch: PATCH.replace("+new", "+x") }]).files }));
  assert.notEqual(k, cacheKey({ ...base, preferences: "Be brief." }));
  // A generated file isn't sent, so it doesn't change the key.
  const lock = buildDigest([{ scope: "working", patch: PATCH.replace('+{"v":1}', '+{"v":2}') }]);
  assert.equal(k, cacheKey({ ...base, files: lock.files }));
  // The code alone: what tells "your preferences changed" from "the code changed".
  assert.equal(codeKey(d.files), codeKey(lock.files));
  assert.notEqual(codeKey(d.files), codeKey(buildDigest([{ scope: "working", patch: PATCH.replace("+new", "+x") }]).files));
  assert.equal(k, cacheKey({ ...base, preferences: "  " }));
  assert.notEqual(placeKey("/r", "staged"), placeKey("/r", "unstaged"));
  assert.equal(deadline(10), 130_000);
  assert.equal(deadline(10_000), 900_000);
});

test("readOutcome reads structured output, text answers and failures", () => {
  assert.deepEqual(readOutcome({ out: JSON.stringify({ subtype: "success", structured_output: { a: 1 }, total_cost_usd: 0.01 }) }), { raw: { a: 1 }, cost: 0.01 });
  assert.deepEqual(readOutcome({ out: JSON.stringify({ subtype: "success", result: "```json\n{\"a\":2}\n```" }) }).raw, { a: 2 });
  assert.throws(() => readOutcome({ out: JSON.stringify({ is_error: true, result: "Not logged in · Please run /login" }) }), (e) => e.code === "login");
  assert.throws(() => readOutcome({ out: "", err: "boom\nlast line", code: "1\n" }), /boom last line/);
  assert.throws(() => readOutcome({ out: null, err: "", code: "127" }), /exited with 127/);
});

test("runner configuration validates selection and preserves the Claude command", () => {
  assert.throws(() => runnerOf(), /Runner is required/);
  assert.throws(() => jobScript(), /Runner is required/);
  assert.throws(() => runnerOf("codex"), /Unsupported runner: codex/);
  const claude = runnerOf("claude");
  assert.equal(claude.key, "claude");
  assert.equal(claude.executable, "claude");
  assert.match(claude.command("haiku"), /^claude '-p' '--output-format' 'json'/);
  assert.match(claude.command("haiku"), /--model 'haiku'/);
});

test("only a walkthrough run's command line is taken for one", () => {
  assert.ok(isRunCommand("claude -p --model haiku --tools  --no-session-persistence --strict-mcp-config --setting-sources  --disable-slash-commands --json-schema {}"));
  assert.ok(isRunCommand("node /x/cli.js -p --no-session-persistence --strict-mcp-config --disable-slash-commands --json-schema {}"));
  assert.ok(!isRunCommand("/Applications/Zed.app/Contents/MacOS/zed"));
  assert.ok(!isRunCommand("claude --resume"));
  assert.ok(!isRunCommand(""));
});

test("the job script passes no tools and quotes empty flags", () => {
  const s = jobScript("claude");
  assert.match(s, /'--tools' '' /);
  assert.match(s, /'--setting-sources' '' /);
  assert.match(s, /--model "\$1"/);
  assert.match(s, /mv code\.tmp code/);
});

test("worthReading drops node_modules and git internals, but not the index", () => {
  assert.deepEqual(worthReading("/r", ["/r/src/a.js", "/r/node_modules/x/y.js", "/r/web/node_modules/z", "/r/.git/objects/ab/cd", "/r/.git/logs/HEAD"]), ["src/a.js"]);
  assert.equal(worthReading("/r", ["/r/.git/index"]), true);
  assert.equal(worthReading("/r", ["/r/.git/refs/heads/main"]), true);
  assert.equal(worthReading("/r", ["/elsewhere/x"]), true);
  assert.deepEqual(worthReading("/r", []), []);
  // A linked worktree's git folder is elsewhere.
  const gd = "/main/.git/worktrees/wt";
  assert.equal(worthReading("/r", [`${gd}/index`], gd), true);
  assert.equal(worthReading("/r", [`${gd}/logs/HEAD`], gd), true);
  assert.deepEqual(worthReading("/r", [`${gd}/ORIG_HEAD.lock`], gd), []);
});

test("comments on staged and unstaged copies of a line stay apart", () => {
  const spot = { sk: "uncommitted", scope: "staged", path: "a.js", line: 10, kind: "+" };
  let list = addComment([], { ...spot, code: "x", text: "staged one" });
  list = addComment(list, { ...spot, scope: "working", code: "x", text: "unstaged one" });
  list = addComment(list, { ...spot, sk: "commit:abc", code: "x", text: "in a commit" });
  assert.equal(list.length, 3);
  assert.ok(sameSpot(list[0], spot));
  assert.ok(!sameSpot(list[1], spot));
  assert.equal(formatComments(list.slice(0, 2), "uncommitted changes", { mixed: true }),
    "Comments from reading the walkthrough of uncommitted changes\n- a.js:10 (staged version) `x`: staged one\n- a.js:10 (unstaged version) `x`: unstaged one");
});

test("comments: one per line, formatted with their code", () => {
  let list = addComment([], { path: "a.js", line: 3, kind: "+", code: "  x = 1;", text: "why 1?" });
  list = addComment(list, { path: "a.js", line: 3, kind: "+", code: "  x = 1;", text: "why one?" });
  list = addComment(list, { path: "a.js", line: 3, kind: "-", code: "x = 0;", text: "was fine" });
  assert.equal(list.length, 2);
  assert.equal(formatComments(list, "uncommitted changes"),
    "Comments from reading the walkthrough of uncommitted changes\n- a.js:3 `x = 1;`: why one?\n- a.js:3 (removed line) `x = 0;`: was fine");
});
