// Deskpilot chat health — GET /api/healthz.
// Booleans and numbers only. Never returns secret values.

function chatOn() {
  return String(process.env.CHAT_ENABLED || "").toLowerCase() === "true";
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Use GET" });
    return;
  }
  const out = {
    ok: true,
    chatEnabled: chatOn(),
    brainsReadable: false,
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    budgetRemainingPct: 100
  };
  if (!chatOn()) {
    res.status(200).json(out);
    return;
  }
  try {
    const sas = process.env.BRAINS_READ_SAS || "";
    if (sas) {
      const { ContainerClient } = require("@azure/storage-blob");
      const container = new ContainerClient(sas);
      out.brainsReadable = await container.getBlockBlobClient("heartbeat.json").exists();
    }
  } catch (error) {
    out.brainsReadable = false;
  }
  try {
    const sas = process.env.CHAT_STORAGE_SAS || "";
    const total = Math.max(1, Number(process.env.CHAT_DAILY_TOKEN_BUDGET || "50000"));
    if (sas) {
      const { ContainerClient } = require("@azure/storage-blob");
      const container = new ContainerClient(sas);
      const name = "budget/" + new Date().toISOString().slice(0, 10) + ".json";
      const blob = container.getBlockBlobClient(name);
      if (await blob.exists()) {
        const b = JSON.parse((await blob.downloadToBuffer()).toString("utf8"));
        const used = (b.input || 0) + (b.output || 0);
        out.budgetRemainingPct = Math.max(0, Math.round((1 - used / total) * 100));
      }
    }
  } catch (error) { /* health must not throw */ }
  res.status(200).json(out);
};
