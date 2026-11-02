import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runnerVersions } from "../lib/runner.js";

const responses = {
  claude: { code: 0, stdout: "Claude Code 1.2.3\n" },
  pi: { code: 127, stdout: "" },
};

const versions = await runnerVersions(async (executable) => responses[executable]);

assert.deepEqual(versions, {
  claude: "Claude Code 1.2.3",
  pi: null,
});

const view = await readFile(new URL("../view.js", import.meta.url), "utf8");
const toolbar = view.slice(view.indexOf("  toolbar(t) {"), view.indexOf("  canGenerate() {"));
assert.doesNotMatch(toolbar, /pick-agent/);
assert.match(toolbar, /pick-runner[\s\S]*pick-model/);
