// A walkthrough as Markdown, to paste where people read changes: a pull
// request's description, a review comment, a chat. Steps keep their order,
// weights and notes; the code itself stays out, since wherever this is pasted
// the diff is already beside it.

import { fileTotals } from "./walkthrough.js";

const NOTE_LABEL = { choice: "Decision", upkeep: "Upkeep", gap: "Limitation", divergence: "Divergence", untested: "Untested" };

/** Model text on one line, for a heading, a bold title or a list item. */
const line = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** A path in backticks, whatever backticks it holds. */
const code = (s) => {
  const t = String(s);
  const fence = "`".repeat((t.match(/`+/g) ?? []).reduce((n, m) => Math.max(n, m.length), 0) + 1);
  return fence.length > 1 ? `${fence} ${t} ${fence}` : `\`${t}\``;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * @param {ReturnType<typeof import("./walkthrough.js").overlay>} view the walkthrough over the diff as it is now
 * @param {{ title: string, summary: string }} walkthrough the stored walkthrough
 * @param {{ what?: string, model?: string, language?: string, cost?: number | null }} meta
 */
export function toMarkdown(view, walkthrough, { what = "", model = "", language = "", cost = null } = {}) {
  const out = [`## ${line(walkthrough.title) || "Walkthrough"}`, ""];
  if (walkthrough.summary?.trim()) out.push(walkthrough.summary.trim(), "");
  const about = [what && line(what), model, language, typeof cost === "number" ? `$${cost.toFixed(cost < 0.1 ? 3 : 2)}` : ""].filter(Boolean);
  if (about.length) out.push(`<sub>${about.join(" · ")}</sub>`, "");

  for (const part of view.parts) {
    out.push(`### ${line(part.title)}`, "");
    if (part.blurb?.trim()) out.push(part.blurb.trim(), "");
    for (const s of part.steps) {
      const marks = [s.weight === "key" ? "**Key change**" : s.weight === "skim" ? "_Context_" : "", s.outdated ? "_Outdated_" : ""].filter(Boolean);
      out.push(`**${s.position}. ${line(s.title)}**${marks.length ? ` · ${marks.join(" · ")}` : ""}`, "");
      out.push(s.text.trim(), "");
      for (const n of s.notes) out.push(`> **${NOTE_LABEL[n.kind] ?? n.kind}:** ${line(n.text)}`, "");
      if (s.outdated) out.push(`_${s.missing} of the ${plural(s.hunkIds.length, "hunk")} this step described changed or are gone._`, "");
      const files = fileTotals(s.found);
      if (files.length) out.push(files.map((f) => `${code(f.path)} +${f.added} −${f.deleted}`).join(" · "), "");
    }
  }

  if (view.uncovered.length) {
    out.push("### Not covered", "", `Edits in ${plural(view.uncovered.length, "file")} that no step explains:`, "");
    for (const u of view.uncovered) {
      const size = u.hunks.length ? ` (${plural(u.hunks.length, "hunk")})` : "";
      out.push(`- ${code(u.file.path)}${size}${u.note ? ` — ${line(u.note)}` : ""}`);
    }
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

