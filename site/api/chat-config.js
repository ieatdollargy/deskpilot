// Deskpilot chat public config — GET /api/chat-config.
// Returns only public, non-secret values: the flag, the Turnstile site key,
// and per-agent display info (name, role, scope line, accent). No secrets.

const AGENT_IDS = ["gennifer", "twain", "cody", "art"];

function chatOn() {
  return String(process.env.CHAT_ENABLED || "").toLowerCase() === "true";
}

module.exports = async function handler(req, res) {
  const origin = req.headers && req.headers.origin;
  if (origin && (/^https:\/\/([a-z0-9-]+\.)*deskpilot\.world$/.test(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Use GET" });
    return;
  }
  if (!chatOn()) {
    res.status(200).json({ ok: true, enabled: false });
    return;
  }
  const agents = AGENT_IDS.map((id) => {
    try {
      const c = require("../chat/agents/" + id + ".json");
      return { id: c.id, name: c.name, role: c.role, greetingScope: c.greetingScope, accent: c.accent };
    } catch (error) {
      return null;
    }
  }).filter(Boolean);
  res.status(200).json({
    ok: true,
    enabled: true,
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "",
    agents
  });
};
