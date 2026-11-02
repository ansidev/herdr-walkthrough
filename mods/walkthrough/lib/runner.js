// Model runners define how Walkthrough checks for and invokes an installed CLI.
// Adding a runner belongs here; callers validate the selected key once, then use
// the resolved definition for probing and job construction.

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

const claudeFlags = [
  "-p", "--output-format", "json", "--tools", "", "--no-session-persistence",
  "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands",
];

const claudeCommand = (model) => `claude ${claudeFlags.map(shellQuote).join(" ")} --model ${model} --json-schema "$(cat schema.json)" --system-prompt "$(cat system.txt)"`;

const claude = {
  key: "claude",
  name: "Claude Code",
  executable: "claude",
  versionArgs: ["--version"],
  processMarkers: ["--json-schema", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"],
  command(model) {
    return claudeCommand(shellQuote(model));
  },
  scriptCommand() {
    return claudeCommand('"$1"');
  },
};

export const RUNNERS = [claude];

/** Resolve an explicitly configured runner, refusing missing and unknown values. */
export function runnerOf(key) {
  if (!key) throw new Error("Runner is required.");
  const runner = RUNNERS.find((candidate) => candidate.key === key);
  if (!runner) throw new Error(`Unsupported runner: ${key}.`);
  return runner;
}

/** Whether the selected runner can be started, returning its version or null. */
export async function runnerVersion(exec, key) {
  const runner = runnerOf(key);
  try {
    const result = await exec(runner.executable, runner.versionArgs);
    return result.code === 0 ? result.stdout.trim() : null;
  } catch { return null; }
}
