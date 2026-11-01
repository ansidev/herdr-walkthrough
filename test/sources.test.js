// The git side against real throwaway repositories.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoAt, currentHead, loadSections, defaultBase, baseChoices, recentCommits, sourceKey, describe, MAX_UNTRACKED_BYTES, pullRequests, ghError } from "../mods/walkthrough/lib/sources.js";
import { buildDigest } from "../mods/walkthrough/lib/digest.js";
import { jobScript, readOutcome } from "../mods/walkthrough/lib/job.js";
import { chmodSync, readFileSync, existsSync } from "node:fs";

const exec = (cmd, args, { cwd } = {}) => new Promise((resolve) => execFile(cmd, args, { cwd, maxBuffer: 1 << 26 },
  (e, stdout, stderr) => resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr })));
const sh = async (cwd, ...args) => {
  const r = await exec("git", args, { cwd });
  if (r.code !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

let dir;
before(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-")));
  await sh(dir, "init", "-q", "-b", "main");
  await sh(dir, "config", "user.email", "t@t");
  await sh(dir, "config", "user.name", "t");
  // The user's own diff settings must not change what is parsed.
  await sh(dir, "config", "diff.noprefix", "true");
  await sh(dir, "config", "color.diff", "always");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  writeFileSync(join(dir, "b.txt"), "b\n");
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-qm", "first");
});
after(() => rmSync(dir, { recursive: true, force: true }));

const paths = async (source) => {
  const { sections, unread } = await loadSections(exec, dir, source);
  const d = buildDigest(sections);
  return { files: d.files.map((f) => `${f.scope}:${f.path}:${f.status}`), unread };
};

test("repoAt and recent commits", async () => {
  mkdirSync(join(dir, "sub"), { recursive: true });
  const repo = await repoAt(exec, join(dir, "sub"));
  assert.deepEqual(repo, { top: dir, name: dir.split("/").pop(), branch: "main", born: true, gitDir: `${dir}/.git` });
  assert.equal(await repoAt(exec, tmpdir()), null);
  const commits = await recentCommits(exec, dir);
  assert.equal(commits[0].subject, "first");
  assert.equal(commits[0].hash.length, 40);
});

test("working tree scopes: staged, unstaged and new files apart", async () => {
  writeFileSync(join(dir, "a.txt"), "one\nTWO\n");
  await sh(dir, "add", "a.txt");
  writeFileSync(join(dir, "b.txt"), "B\n");
  writeFileSync(join(dir, "new file.txt"), "hello\n");
  assert.deepEqual((await paths({ kind: "staged" })).files, ["staged:a.txt:modified"]);
  assert.deepEqual((await paths({ kind: "unstaged" })).files, ["working:b.txt:modified", "working:new file.txt:added"]);
  assert.deepEqual((await paths({ kind: "uncommitted" })).files, ["staged:a.txt:modified", "working:b.txt:modified", "working:new file.txt:added"]);
});

test("large new files are listed, not read", async () => {
  writeFileSync(join(dir, "big.log"), "x".repeat(MAX_UNTRACKED_BYTES + 10));
  const { files, unread } = await paths({ kind: "unstaged" });
  assert.ok(!files.some((f) => f.includes("big.log")));
  assert.deepEqual(unread, [{ path: "big.log", why: "Not read: larger than 1 MB." }]);
  rmSync(join(dir, "big.log"));
});

test("an unreadable new file doesn't shift the sizes of the files after it", { skip: process.getuid?.() === 0 }, async () => {
  writeFileSync(join(dir, "a-locked.txt"), "secret\n");
  chmodSync(join(dir, "a-locked.txt"), 0);
  writeFileSync(join(dir, "b-big.log"), "x".repeat(MAX_UNTRACKED_BYTES + 10));
  writeFileSync(join(dir, "c-small.txt"), "small\n");
  const { files, unread } = await paths({ kind: "unstaged" });
  assert.ok(files.includes("working:c-small.txt:added"));
  assert.ok(!files.some((f) => f.includes("b-big.log")));
  assert.deepEqual(unread.map((u) => u.path).sort(), ["a-locked.txt", "b-big.log"]);
  for (const f of ["a-locked.txt", "b-big.log", "c-small.txt"]) rmSync(join(dir, f), { force: true });
});

test("new files keep git's order, a binary one included, and unchanged ones aren't diffed again", async () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-order-")));
  await sh(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  writeFileSync(join(repo, "b.bin"), Buffer.from([0, 1, 2, 0, 255]));
  for (let i = 0; i < 8; i++) writeFileSync(join(repo, `c${i}.txt`), `${i}\n`);
  let diffs = 0;
  const counting = (cmd, args, opts) => { if (args.includes("--no-index")) diffs++; return exec(cmd, args, opts); };
  const order = async () => buildDigest((await loadSections(counting, repo, { kind: "unstaged" })).sections).files.map((f) => f.path);
  const first = await order();
  assert.deepEqual(first, ["a.txt", "b.bin", ...Array.from({ length: 8 }, (_, i) => `c${i}.txt`)]);
  assert.equal(diffs, 10);
  for (let i = 0; i < 5; i++) assert.deepEqual(await order(), first);
  assert.equal(diffs, 10);
  // A changed file is read again, and only it.
  writeFileSync(join(repo, "a.txt"), "a changed\n");
  await order();
  assert.equal(diffs, 11);
  rmSync(repo, { recursive: true, force: true });
});

test("a commit against its parent, and the root commit against nothing", async () => {
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-qm", "second");
  const [second, first] = (await recentCommits(exec, dir)).map((c) => c.hash);
  assert.deepEqual((await paths({ kind: "commit", hash: second })).files, ["commit:a.txt:modified", "commit:b.txt:modified", "commit:new file.txt:added"]);
  assert.deepEqual((await paths({ kind: "commit", hash: first })).files, ["commit:a.txt:added", "commit:b.txt:added"]);
});

test("a branch against its base: committed and uncommitted work, not the base's", async () => {
  await sh(dir, "checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "f.txt"), "feature\n");
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-qm", "feature");
  await sh(dir, "checkout", "-q", "main");
  writeFileSync(join(dir, "m.txt"), "main moved on\n");
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-qm", "main");
  await sh(dir, "checkout", "-q", "feature");
  writeFileSync(join(dir, "a.txt"), "edited on feature\n");
  writeFileSync(join(dir, "g.txt"), "untracked\n");
  assert.equal(await defaultBase(exec, dir, "feature"), "main");
  assert.equal(await defaultBase(exec, dir, "main"), null);
  assert.deepEqual(await baseChoices(exec, dir, "feature"), ["main"]);
  assert.deepEqual((await paths({ kind: "branch", base: "main" })).files, ["branch:a.txt:modified", "branch:f.txt:added", "branch:g.txt:added"]);
});

test("run.sh stops a claude that hangs, and the reason is the error", async () => {
  const job = mkdtempSync(join(tmpdir(), "walkthrough-job-"));
  const bin = join(job, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nsleep 60\n");
  chmodSync(join(bin, "claude"), 0o755);
  for (const f of ["schema.json", "system.txt", "prompt.txt"]) writeFileSync(join(job, f), "{}");
  writeFileSync(join(job, "run.sh"), jobScript());
  const started = Date.now();
  await new Promise((resolve) => execFile("sh", [join(job, "run.sh"), "haiku", "1"], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }, resolve));
  assert.ok(Date.now() - started < 20_000);
  assert.ok(existsSync(join(job, "code")));
  assert.throws(() => readOutcome({ out: readFileSync(join(job, "out.json"), "utf8"), err: readFileSync(join(job, "err.txt"), "utf8"), code: readFileSync(join(job, "code"), "utf8") }), /Stopped after 1 seconds/);
  rmSync(job, { recursive: true, force: true });
});

test("a merge conflict in the working tree shows as conflicted, not as the file before it", async () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "walkthrough-merge-")));
  await sh(repo, "init", "-q", "-b", "main");
  await sh(repo, "config", "user.email", "t@t");
  await sh(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "a\n");
  writeFileSync(join(repo, "b.txt"), "base\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-qm", "base");
  await sh(repo, "checkout", "-q", "-b", "other");
  writeFileSync(join(repo, "b.txt"), "theirs\n");
  await sh(repo, "commit", "-qam", "theirs");
  await sh(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "b.txt"), "ours\n");
  await sh(repo, "commit", "-qam", "ours");
  await exec("git", ["merge", "other"], { cwd: repo }); // conflicts, exits 1
  writeFileSync(join(repo, "a.txt"), "A\n");
  const { sections } = await loadSections(exec, repo, { kind: "unstaged" });
  const files = buildDigest(sections).files.map((f) => `${f.path}:${f.status}:${f.hunks.length}`);
  assert.deepEqual(files.sort(), ["a.txt:modified:1", "b.txt:conflicted:0"]);
  rmSync(repo, { recursive: true, force: true });
});

test("a linked worktree reports its own git folder, and the head follows checkouts", async () => {
  const wt = join(tmpdir(), `walkthrough-wt-${process.pid}`);
  await sh(dir, "worktree", "add", "-q", "-b", "wt-branch", wt);
  const repo = await repoAt(exec, wt);
  assert.match(repo.gitDir, /\.git\/worktrees\//);
  assert.equal(await currentHead(exec, wt), "wt-branch");
  await sh(wt, "checkout", "-q", "--detach");
  assert.match(await currentHead(exec, wt), /^HEAD@[0-9a-f]+$/);
  await sh(dir, "worktree", "remove", "--force", wt);
});

test("source keys and descriptions", () => {
  assert.equal(sourceKey({ kind: "staged" }), "staged");
  // Each branch read against a base is its own walkthrough.
  assert.equal(sourceKey({ kind: "branch", base: "main", head: "feature-a" }), "branch:main...feature-a");
  assert.notEqual(sourceKey({ kind: "branch", base: "main", head: "feature-a" }), sourceKey({ kind: "branch", base: "main", head: "feature-b" }));
  assert.equal(sourceKey({ kind: "commit", hash: "abc" }), "commit:abc");
  assert.match(describe({ kind: "branch", base: "main" }, { branch: "feature" }), /branch "feature" adds to "main"/);
  assert.match(describe({ kind: "commit", hash: "0123456789abcdef", subject: "Fix" }, null), /Commit 0123456789ab \("Fix"\)/);
  // A pull request is one walkthrough whatever its head: when it moves on, the last one shows as outdated.
  assert.equal(sourceKey({ kind: "pr", number: 12, title: "T" }), "pr:12");
  assert.match(describe({ kind: "pr", number: 12, title: "Fix it", head: "fix", base: "main" }, null), /Pull request #12 \("Fix it"\), "fix" into "main"/);
});

// gh, faked: what it is asked, and what it answers.
const fakeGh = (answers) => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd !== "gh") throw new Error(`unexpected ${cmd}`);
    const a = answers[args.slice(0, 2).join(" ")];
    if (a === undefined) throw new Error("spawn gh ENOENT");
    return typeof a === "string" ? { code: 0, stdout: a, stderr: "" } : a;
  };
  return { exec, calls };
};

test("a pull request is read as GitHub shows it", async () => {
  const patch = "diff --git a/x.js b/x.js\nindex 1..2 100644\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n";
  const { exec, calls } = fakeGh({ "pr diff": patch });
  const { sections, unread } = await loadSections(exec, "/repo", { kind: "pr", number: 7 });
  assert.deepEqual(calls, ["gh pr diff 7 --color=never"]);
  assert.deepEqual(sections, [{ scope: "pr", patch }]);
  assert.deepEqual(unread, []);
  assert.equal(buildDigest(sections).files[0].hunks.length, 1);
});

test("gh's failures say what to do", async () => {
  await assert.rejects(loadSections(fakeGh({}).exec, "/repo", { kind: "pr", number: 7 }), /isn't installed/);
  const failing = (stderr) => fakeGh({ "pr diff": { code: 1, stdout: "", stderr } }).exec;
  await assert.rejects(loadSections(failing("HTTP 406: Sorry, the diff exceeded the maximum number of files (300)."), "/repo", { kind: "pr", number: 7 }), /Read it as a Branch/);
  assert.match(ghError("To get started with GitHub CLI, please run:  gh auth login"), /isn't logged in/);
  assert.match(ghError("no git remotes found"), /no GitHub remote/);
  assert.match(ghError("GraphQL: Could not resolve to a PullRequest with the number of 99999. (repository.pullRequest)"), /wasn't found/);
  assert.equal(ghError("first\nsomething else\n"), "something else");
});

test("open pull requests, newest update first, the current branch's marked", async () => {
  const list = [
    { number: 1, title: "Old", headRefName: "a", baseRefName: "main", author: { login: "x" }, isDraft: false, updatedAt: "2026-10-01T00:00:00Z" },
    { number: 2, title: "Mine", headRefName: "feature", baseRefName: "main", author: { login: "y" }, isDraft: true, updatedAt: "2026-10-30T00:00:00Z" },
  ];
  const { exec, calls } = fakeGh({ "pr list": JSON.stringify(list) });
  const prs = await pullRequests(exec, "/repo", "feature");
  assert.match(calls[0], /^gh pr list --state open --limit 50 --json number,title,headRefName,baseRefName,author,isDraft,updatedAt$/);
  assert.deepEqual(prs.map((p) => [p.number, p.author, p.draft, p.current]), [[2, "y", true, true], [1, "x", false, false]]);
  await assert.rejects(pullRequests(fakeGh({ "pr list": "not json" }).exec, "/repo"), /something other than a list/);
});
