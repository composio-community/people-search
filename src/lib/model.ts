import "server-only";

/**
 * The agent runs through OpenRouter, so any model there works: the default is
 * a cheap open-weight model with solid tool calling. Set AGENT_MODEL to switch,
 * e.g. "minimax/minimax-m3.1-flash" or "anthropic/claude-opus-5.5".
 */
export const MODEL = process.env.AGENT_MODEL || "deepseek/deepseek-v4.1-flash";

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

/** "deepseek/deepseek-v4.1-flash" → "DeepSeek V4.1 Flash" */
export function modelLabel(id = MODEL) {
  const name = id.split("/").pop() ?? id;
  return name
    .split(/[-_]/)
    .filter((w) => !/^\d{4}$/.test(w))
    .map((w) => VENDORS[w.toLowerCase()] ?? (/^v?\d/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
