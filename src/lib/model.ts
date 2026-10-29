import "server-only";

/**
 * The agent runs through OpenRouter, so any model there works: the default is
 * Gemini 4 Argon. Set AGENT_MODEL to switch, e.g. "deepseek/deepseek-v4.1-flash"
 * (much cheaper) or "anthropic/claude-opus-5.5".
 */
export const MODEL = process.env.AGENT_MODEL || "google/gemini-4-argon";

const VENDORS: Record<string, string> = {
  deepseek: "DeepSeek",
  glm: "GLM",
  qwen: "Qwen",
  qwen3: "Qwen3",
  minimax: "MiniMax",
  kimi: "Kimi",
  mimo: "MiMo",
  claude: "Claude",
};

/** "google/gemini-4-argon" → "Gemini 4 Argon", "deepseek/deepseek-v4.1-flash" → "DeepSeek V4.1 Flash" */
export function modelLabel(id = MODEL) {
  const name = id.split("/").pop() ?? id;
  return name
    .split(/[-_]/)
    .filter((w) => !/^\d{4}$/.test(w))
    .map((w) => VENDORS[w.toLowerCase()] ?? (/^v?\d/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
