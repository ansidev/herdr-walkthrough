# ◆ Walkthrough

[![CI](https://github.com/dmazlum/herdr-walkthrough/actions/workflows/ci.yml/badge.svg)](https://github.com/dmazlum/herdr-walkthrough/actions/workflows/ci.yml)

Read a change in the order it makes sense, not in the order of its file names. In
[Herdr](https://herdr.dev), Claude groups a diff's edits into steps, puts them in an order
where each one builds on the last, and explains what each step changes. The code each step
talks about is shown under its explanation.

It explains, it doesn't judge. There are no findings, scores or verdicts. Built for reading
what an agent (or a colleague) just wrote before you accept it.

![Walkthrough](preview.png)

Requires the **Herdr desktop app 0.1.9+**, **git**, and **Claude Code** (`claude`, logged in).
Codex as a model runner is planned (see [Roadmap](#roadmap)); comments can already be sent to
a Codex agent, or any other.

## Features

- **Steps, in reading order.** Related hunks across files form one step; types and entry
  points come before the code that uses them; tests sit with the code they prove. Steps are
  grouped into a few parts, listed on the left.
- **Where to look first.** *Key change* marks the step or two the rest depends on;
  *Context* marks supporting edits that are safe to skim.
- **Notes, rarely.** A few steps carry a note about something you accept by taking the
  change: a *Decision* that could have gone another way, *Upkeep* the project now carries, a
  *Limitation* users still hit, a *Divergence* between two paths, or a promise left
  *Untested*. Notes state facts; they never call code wrong.
- **Nothing hidden.** Every hunk no step covers is listed under **Not covered**, file by
  file, with a one-line note on what changed there. Lockfiles, bundles and other generated
  files are not sent to the model, but are listed too.
- **Honest about staleness.** Each step is tied to the exact content of its hunks. Edit the
  code and the steps whose code moved are marked **Outdated**, live, and the new edits show
  under Not covered. **Regenerate** hands the old walkthrough to the model so what is still
  true survives.
- **Any scope.** Uncommitted (staged, unstaged and new files), Staged, Unstaged, a Branch
  against its base (committed and uncommitted, without what the base gained since), or one
  Commit.
- **Model and language per walkthrough.** Haiku (default), Sonnet or Opus; explanations in
  fourteen languages, starting from your system's. Identifiers and paths stay as they are.
- **Paid once.** Walkthroughs are cached by the exact content of the diff, model and
  language. Put the code back the way it was and the earlier walkthrough is back, free.
- **Runs in the background.** Close the dialog, or Herdr; the walkthrough is waiting when
  you come back.
- **Comments to your agent.** Click any line to comment on it, then **Send** pastes all
  comments, with the line and its code, into an agent in the same space.

## Install

In Herdr, ask your agent to add `github.com/dmazlum/herdr-walkthrough` (it's listed at
[herdr.dev/mods](https://herdr.dev/mods)): it reads [`RECIPE.md`](RECIPE.md) and every file,
copies `mods/walkthrough`, merges [`keys.json`](keys.json) and checks the mod. Or by hand:

```sh
git clone https://github.com/dmazlum/herdr-walkthrough
cp -R herdr-walkthrough/mods/walkthrough ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/walkthrough
```

Then merge [`keys.json`](keys.json) into `~/.config/herdr-app/keys.json`:

| Key / command | What it does |
| --- | --- |
| `cmd-shift-k` → `mod.open:walkthrough` | Open the walkthrough of the focused terminal's repository |
| `←` `→` (or `j` `k`) | Previous / next step |
| Esc | Close a picker, a comment, then the dialog |
| `walkthrough.generate`, `.cancel`, `.next`, `.prev` | The same, for your own keys |

To keep it beside an agent instead of over it, open it as a pane:

```sh
herdr-app do pane.split --direction right --mod walkthrough --props '{"scope":"branch"}'
```

While developing, link the folder instead of copying it, and Herdr reloads the mod on
every save:

```sh
ln -s "$PWD/herdr-walkthrough/mods/walkthrough" ~/.config/herdr-app/mods/walkthrough
```

## Updates

Herdr updates its own mods, not ones you added: yours is a copy, and nothing tells you
when this repo changes. To hear about a new version, watch the repo for releases (on
GitHub: **Watch → Custom → Releases**). Each
[release](https://github.com/dmazlum/herdr-walkthrough/releases) says what changed and whether
`keys.json` did; merge it again when it did.

The version you have is `"version"` in `~/.config/herdr-app/mods/walkthrough/mod.json`. To
update, ask your agent to replace that folder with the latest `mods/walkthrough` from
`github.com/dmazlum/herdr-walkthrough`. Adding it again isn't enough: an agent never
overwrites a mod, it would add a second copy under a new name. If the mod was renamed when
it was added (a name clash), the renamed folder is the one to replace, renamed the same way.
Or by hand:

```sh
git -C herdr-walkthrough pull          # or clone it again
rm -rf ~/.config/herdr-app/mods/walkthrough
cp -R herdr-walkthrough/mods/walkthrough ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/walkthrough
```

## What it runs

Nothing is generated until you press **Generate**. Opening the walkthrough only reads git.

A generation is one `claude -p` call, in the background, with no tools, no MCP servers, no
settings, hooks or skills: the model reads the diff and answers in JSON. Without those
flags a full Claude Code setup rides along on every call; with them a small change costs
about $0.002 with Haiku. The cost of each walkthrough is shown under its contents.

Everything is kept in `~/.herdr/walkthrough/`:

| Path | What |
| --- | --- |
| `entries/<key>.json` | Finished walkthroughs, the newest 200 |
| `pointers/<place>.json` | The one shown last per repository and scope |
| `jobs/<place>/` | A generation in progress: its prompt, `run.sh`, and the answer |
| `preferences.md` | Optional: your own wishes for tone and emphasis, added to every prompt |

A diff too large for the model (about 175k tokens) is refused rather than cut: a
walkthrough of half a diff reads exactly as confidently as one of the whole.

![An outdated step](docs/outdated.png)

## Limits

- Local only: a space on another machine shows a notice.
- Claude Code is the only model runner for now (Codex is planned). It must be logged in;
  `claude --version` must work from the PATH Herdr starts programs with.
- New files over 1 MB, and new files past the first 300, are listed but not read.
- A page draws at most 2,500 lines of code; the rest is counted.
- Comments are kept while the walkthrough is open, and sent with Enter.

## Roadmap

- **Codex as a model runner.** Generate a walkthrough with `codex exec` and its JSON schema
  output, as a choice beside Haiku, Sonnet and Opus.

## Development

```sh
npm test    # parsing, hunk ids, digest, prompt, normalizing, staleness, and git against real repos
```

The UI is checked in Herdr: `herdr-app check`, then `herdr-app shot` while it is open.

## License

MIT
