import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../mods/walkthrough/lib/highlight.js";

const kinds = (text, path) => tokenize(text, path).filter((t) => t.kind !== "plain").map((t) => [t.text, t.kind]);
const joined = (text, path) => tokenize(text, path).map((t) => t.text).join("");

test("tokens always join back into the line", () => {
  const lines = [
    `    const s = new Store({ ttlMs: 10, now: () => t }); // clock`,
    `if (a && "unterminated`,
    `x = 'it\\'s' + \`\${y}\` /* inline */ + 0x1F`,
    "",
    "   ",
    `def f(a, b=None):  # note`,
  ];
  for (const l of lines) for (const p of ["a.js", "a.py", "README.md", "noext"]) assert.equal(joined(l, p), l);
});

test("JavaScript: keywords, calls, types, strings, numbers, constants, comments", () => {
  assert.deepEqual(kinds(`  const hit = this.items.get(id); // old`, "src/store.js"), [
    ["const", "keyword"], ["this", "keyword"], ["get", "function"], ["// old", "comment"]]);
  assert.deepEqual(kinds(`return new Store({ ttl: 10, on: true, name: "a" });`, "x.ts"), [
    ["return", "keyword"], ["new", "keyword"], ["Store", "function"], ["10", "number"], ["true", "constant"], [`"a"`, "string"]]);
  assert.deepEqual(kinds(`let Map2 = /* why */ x1`, "x.js"), [["let", "keyword"], ["Map2", "type"], ["/* why */", "comment"]]);
});

test("the comment style follows the file", () => {
  assert.deepEqual(kinds(`x = 1  # note`, "a.py"), [["1", "number"], ["# note", "comment"]]);
  // In JavaScript a # is a private field, not a comment.
  assert.deepEqual(kinds(`this.#count = 1`, "a.js"), [["this", "keyword"], ["1", "number"]]);
});

test("prose and data files stay plain", () => {
  assert.deepEqual(tokenize(`- **Bold** "quoted" 42 // not code`, "README.md"), [{ text: `- **Bold** "quoted" 42 // not code`, kind: "plain" }]);
  assert.deepEqual(kinds(`{ "version": "0.3.0" }`, "mod.json"), []);
});
