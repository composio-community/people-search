import type { IntroDraft, IntroHook } from "./types";

/**
 * Parses the ```intro block the agent writes in its reply. Works on partial
 * text too, so the card fills in while the block is still streaming:
 *
 *   To: [mutual's name]
 *   About: <id or name>
 *   Subject: ...
 *
 *   <body>
 *
 *   Hooks:
 *   - fact | source | url
 */
export function parseIntro(raw: string): IntroDraft {
  const lines = raw.replace(/\r/g, "").split("\n");
  const header: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      break;
    }
    const m = line.match(/^\s*(to|about|subject|style)\s*:\s*(.*)$/i);
    if (!m) break;
    header[m[1].toLowerCase()] = m[2].trim();
  }

  const rest = lines.slice(i);
  const hooksAt = rest.findIndex((l) => /^\s*hooks\s*:\s*$/i.test(l));
  const bodyLines = hooksAt === -1 ? rest : rest.slice(0, hooksAt);
  const hooks: IntroHook[] =
    hooksAt === -1
      ? []
      : rest
          .slice(hooksAt + 1)
          .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
          .filter(Boolean)
          .map((l) => {
            const [text, source, url] = l.split(/\s+\|\s+/).map((p) => p.trim());
            return {
              text,
              source: source || undefined,
              url: url && /^(https?:\/\/|www\.)/.test(url) ? url : undefined,
            };
          });

  const about = header.about;
  return {
    style: /direct/i.test(header.style ?? "") ? "direct" : "forwardable",
    to: header.to,
    targetRef: about,
    targetName: about && !/^[a-f0-9]{24}$/i.test(about) && !about.includes("@") ? about : undefined,
    subject: header.subject ?? "",
    body: bodyLines.join("\n").trim(),
    hooks,
  };
}
