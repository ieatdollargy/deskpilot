const dns = require("dns").promises;
const net = require("net");

const COOLDOWN_MS = 25000;
const UA = "Deskpilot/1.0 (public-web research)";

const AGENTS = [
  {
    id: "gennifer",
    name: "Gennifer",
    role: "The Analyst",
    brain: "You are Gennifer, a careful crypto analyst at Deskpilot. You have your own notes and you do not speak as the other agents. You search public pages for fundamentals: liquidity, holders, growth, and risk. You never invent numbers that are not on the page.",
    seeds: [
      "ethereum liquid staking risk 2026",
      "bitcoin etf flow this week",
      "solana dex volume trend",
      "crypto exchange proof of reserves"
    ]
  },
  {
    id: "twain",
    name: "Twain",
    role: "The Narrator",
    brain: "You are Twain, the narrator at Deskpilot. You have your own notes and you do not speak as the other agents. You search public pages for the story people are telling: launches, claims, and how a narrative is shifting. Stay with what the page actually says.",
    seeds: [
      "crypto market narrative this week",
      "ai agent startup launch story",
      "bitcoin cultural narrative 2026",
      "what founders are saying about onchain apps"
    ]
  },
  {
    id: "cody",
    name: "Cody",
    role: "The Dev",
    brain: "You are Cody, the developer at Deskpilot. You have your own notes and you do not speak as the other agents. You search public pages for how systems are built: protocols, clients, security notes, and architecture. Do not claim you read code you were not shown.",
    seeds: [
      "ethereum protocol upgrade notes",
      "solidity security advisory this month",
      "open source llm serving architecture",
      "web3 wallet security design"
    ]
  },
  {
    id: "art",
    name: "Art",
    role: "The Creative",
    brain: "You are Art, the creative at Deskpilot. You have your own notes and you do not speak as the other agents. You search public pages for visual and design ideas: interfaces, generative art, and brand direction. Describe only what the page describes.",
    seeds: [
      "generative art exhibition 2026",
      "interface design trend dark dashboard",
      "ai image tool artist workflow",
      "brand identity case study technology"
    ]
  }
];

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    const n = ip.toLowerCase();
    return n === "::1" || n.startsWith("fc") || n.startsWith("fd") || n.startsWith("fe80");
  }
  return true;
}

async function isPublicHttp(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  let records = [];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    return false;
  }
  if (!records.length) return false;
  return records.every((record) => !isPrivateIp(record.address));
}

function decodeText(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  const title = decodeText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").slice(0, 140);
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => decodeText(match[1]))
    .filter((line) => line.length > 80);
  const comments = [...html.matchAll(/class="commtext"[^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => decodeText(match[1]))
    .filter((line) => line.length > 40);
  const fallback = decodeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
  );
  const text = readableText(paragraphs.join(" ") || comments.join(" ") || fallback).slice(0, 3500);
  return { title, text };
}

function readableText(text) {
  if (!text) return "";
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]{3,}/.test(word));
  if (words.length < 12) return "";
  const codeMarks = (text.match(/function\s*\(|\bvar\s+|=>|\{|\}|_;/g) || []).length;
  if (codeMarks > 8) return "";
  return text;
}

async function fetchText(url, ms) {
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(ms)
  });
  return response;
}

function remember(list, url) {
  if (!url || typeof url !== "string") return;
  let clean = url.trim().replace(/&amp;/g, "&");
  if (clean.startsWith("//")) clean = "https:" + clean;
  if (!/^https?:\/\//i.test(clean) || clean.length > 2000) return;
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return;
  }
  if (parsed.pathname === "/" || parsed.pathname === "/home") return;
  if (parsed.hostname === "news.google.com" && !parsed.pathname.includes("/rss/articles/")) return;
  const host = clean.toLowerCase();
  if (host.includes("duckduckgo.com")) return;
  if (/(^https?:\/\/)([^/]*\.)?(twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\//i.test(clean)) return;
  if (list.includes(clean)) return;
  list.push(clean);
}

async function searchDuckDuckGo(query) {
  const response = await fetchText(
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),
    4000
  );
  if (!response.ok) return [];
  const html = await response.text();
  const found = [];
  for (const match of html.matchAll(/uddg=([^&"]+)/g)) {
    let raw = "";
    try {
      raw = decodeURIComponent(match[1]);
    } catch {
      continue;
    }
    if (!raw.startsWith("http")) continue;
    if (found.includes(raw)) continue;
    found.push(raw);
    if (found.length >= 5) break;
  }
  return found;
}

async function searchHackerNews(query) {
  const response = await fetch(
    "https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=5&query=" + encodeURIComponent(query),
    { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
  );
  if (!response.ok) return [];
  const body = await response.json();
  return (body.hits || []).map((hit) => {
    if (hit.url) return hit.url;
    return hit.objectID ? "https://news.ycombinator.com/item?id=" + hit.objectID : "";
  });
}

async function searchGoogleNews(query) {
  const response = await fetch(
    "https://news.google.com/rss/search?q=" + encodeURIComponent(query) + "&hl=en-US&gl=US&ceid=US:en",
    { headers: { "User-Agent": UA, Accept: "application/rss+xml,text/xml" }, signal: AbortSignal.timeout(5000) }
  );
  if (!response.ok) return [];
  const xml = await response.text();
  const links = [];
  for (const match of xml.matchAll(/<link>([^<]+)<\/link>/g)) remember(links, match[1]);
  return links.filter((url) => !url.includes("news.google.com/rss/search"));
}

async function searchWikiBundle(query) {
  const response = await fetch(
    "https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&utf8=1&format=json&srsearch=" + encodeURIComponent(query),
    { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
  );
  if (!response.ok) return [];
  const body = await response.json();
  const hit = ((body.query && body.query.search) || [])[0];
  if (!hit || !hit.title) return [];
  const title = String(hit.title);
  const links = [];
  const extra = await fetch(
    "https://en.wikipedia.org/w/api.php?action=query&prop=extlinks&ellimit=6&format=json&redirects=1&titles=" + encodeURIComponent(title),
    { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
  );
  if (extra.ok) {
    const extraBody = await extra.json();
    const pages = extraBody.query && extraBody.query.pages ? Object.values(extraBody.query.pages) : [];
    for (const link of (pages[0] && pages[0].extlinks) || []) remember(links, link["*"] || link.url || "");
  }
  remember(links, "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")));
  return links;
}

async function searchWeb(query) {
  const found = [];
  try {
    for (const url of await searchDuckDuckGo(query)) remember(found, url);
  } catch (error) {
    // Some hosts refuse this search. The other public sources still run.
  }
  if (found.length < 3) {
    const extra = await Promise.allSettled([
      searchHackerNews(query),
      searchGoogleNews(query),
      searchWikiBundle(query)
    ]);
    for (const result of extra) {
      if (result.status !== "fulfilled") continue;
      for (const url of result.value) remember(found, url);
    }
  }
  const open = found.filter((url) => !url.includes("wikipedia.org"));
  const wiki = found.filter((url) => url.includes("wikipedia.org"));
  return [...open, ...wiki].slice(0, 5);
}

async function readWikipedia(url) {
  const slug = decodeURIComponent((url.split("/wiki/")[1] || "").split("#")[0]);
  if (!slug) return null;
  const response = await fetch(
    "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=1800&format=json&redirects=1&titles=" + encodeURIComponent(slug),
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) }
  );
  if (!response.ok) return null;
  const body = await response.json();
  const pages = body.query && body.query.pages ? Object.values(body.query.pages) : [];
  const page = pages[0];
  if (!page || !page.extract || page.extract.length < 80) return null;
  return {
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(page.title).replace(/ /g, "_")),
    title: page.title,
    text: page.extract.slice(0, 3500),
    links: await wikiLinks(page.title)
  };
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

async function wikiLinks(title) {
  try {
    const response = await fetch(
      "https://en.wikipedia.org/w/api.php?action=query&prop=extlinks&ellimit=6&format=json&redirects=1&titles=" + encodeURIComponent(title),
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(4000) }
    );
    if (!response.ok) return [];
    const body = await response.json();
    const pages = body.query && body.query.pages ? Object.values(body.query.pages) : [];
    return ((pages[0] && pages[0].extlinks) || []).map((link) => {
      const url = link["*"] || link.url || "";
      return { url, text: hostOf(url) || url };
    }).filter((link) => /^https?:\/\//i.test(link.url)).slice(0, 6);
  } catch (error) {
    return [];
  }
}

function extractLinks(html, base) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = decodeText(match[2]).slice(0, 80);
    if (text.length < 3) continue;
    let href = match[1];
    try {
      href = new URL(href, base).href;
    } catch (error) {
      continue;
    }
    if (!/^https?:\/\//i.test(href)) continue;
    if (links.some((link) => link.url === href)) continue;
    links.push({ url: href, text });
    if (links.length >= 8) break;
  }
  return links;
}

async function readPage(startUrl, seen) {
  if (seen.has(startUrl)) return null;
  if (startUrl.includes("wikipedia.org/wiki/")) return readWikipedia(startUrl);
  let current = startUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!(await isPublicHttp(current))) return null;
    if (seen.has(current)) return null;
    const response = await fetchText(current, 4500);
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return null;
      current = new URL(next, current).href;
      continue;
    }
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (type && !type.includes("text/html") && !type.includes("text/plain")) return null;
    const html = await response.text();
    const page = stripHtml(html);
    if (page.text.length < 80) return null;
    return { url: current, title: page.title || current, text: page.text, links: extractLinks(html, current) };
  }
  return null;
}

function agentEnv(agent, name) {
  return process.env[agent.id.toUpperCase() + "_AI_" + name] || process.env["AGENT_AI_" + name] || "";
}

function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function think(agent, brain, page) {
  const key = agentEnv(agent, "API_KEY");
  if (!key) return null;
  const base = (agentEnv(agent, "BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = agentEnv(agent, "MODEL") || (base.includes("anthropic.com") ? "claude-sonnet-5-5" : "gpt-4o-mini");
  const notes = (brain.notes || []).slice(-8).join("\n") || "(none yet)";
  const user = `Your private notes:\n${notes}\n\nYou searched: ${brain.query}\nYou opened: ${page.url}\nTitle: ${page.title}\n\n${page.text.slice(0, 2800)}\n\nReply with JSON only: {"searching":"short phrase","learning":"one sentence from this page","note":"one sentence to remember","nextQuery":"a different public search"}`;
  let text = "";
  if (base.includes("anthropic.com")) {
    const response = await fetch(base.replace(/\/v1$/, "") + "/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 220,
        system: agent.brain,
        messages: [{ role: "user", content: user }]
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return null;
    const body = await response.json();
    text = (body.content || []).map((block) => block.text || "").join(" ");
  } else {
    const response = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 220,
        messages: [
          { role: "system", content: agent.brain },
          { role: "user", content: user }
        ]
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return null;
    const body = await response.json();
    text = body.choices && body.choices[0] && body.choices[0].message
      ? body.choices[0].message.content || ""
      : "";
  }
  return parseJson(text);
}

function emptyBrain(agent) {
  return {
    notes: [],
    seen: [],
    step: 0,
    lastAt: 0,
    query: agent.seeds[0],
    searching: agent.seeds[0],
    learning: "Waiting for the first page.",
    url: "",
    nextQuery: ""
  };
}

const localBrains = new Map();
const localFiles = new Map();
let containerPromise = null;

async function blobService() {
  const { BlobServiceClient } = require("@azure/storage-blob");
  const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connection) return BlobServiceClient.fromConnectionString(connection);
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) return null;
  const { DefaultAzureCredential } = require("@azure/identity");
  return new BlobServiceClient("https://" + account + ".blob.core.windows.net", new DefaultAzureCredential());
}

async function blobClient() {
  if (containerPromise) return containerPromise;
  containerPromise = (async () => {
    const service = await blobService();
    if (!service) return null;
    const container = service.getContainerClient("brains");
    await container.createIfNotExists();
    return container;
  })().catch((error) => {
    containerPromise = null;
    throw error;
  });
  return containerPromise;
}

async function loadJson(name) {
  const container = await blobClient();
  if (!container) return localFiles.has(name) ? localFiles.get(name) : null;
  const blob = container.getBlockBlobClient(name);
  if (!(await blob.exists())) return null;
  return JSON.parse((await blob.downloadToBuffer()).toString("utf8"));
}

async function saveJson(name, value) {
  const container = await blobClient();
  if (!container) {
    localFiles.set(name, value);
    return;
  }
  const body = Buffer.from(JSON.stringify(value));
  await container.getBlockBlobClient(name).upload(body, body.length, {
    blobHTTPHeaders: { blobContentType: "application/json" }
  });
}

async function loadBrain(agent) {
  const container = await blobClient();
  if (!container) return localBrains.get(agent.id) || emptyBrain(agent);
  const blob = container.getBlockBlobClient(agent.id + ".json");
  if (!(await blob.exists())) return emptyBrain(agent);
  const text = (await blob.downloadToBuffer()).toString("utf8");
  return { ...emptyBrain(agent), ...JSON.parse(text) };
}

async function saveBrain(agent, brain) {
  const container = await blobClient();
  if (!container) {
    localBrains.set(agent.id, brain);
    return;
  }
  const body = Buffer.from(JSON.stringify(brain));
  await container.getBlockBlobClient(agent.id + ".json").upload(body, body.length, {
    blobHTTPHeaders: { blobContentType: "application/json" }
  });
}

function view(agent, brain) {
  const fresh = Date.now() - (brain.lastAt || 0) < 20000;
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    searching: brain.searching || agent.seeds[0],
    learning: brain.learning || "",
    url: brain.url || "",
    title: brain.title || "",
    host: hostOf(brain.url),
    pages: brain.pages || 0,
    tokens: brain.tokens || 0,
    links: (brain.links || []).slice(0, 6),
    nextUrl: brain.nextUrl || "",
    statusLine: fresh
      ? (brain.statusLine || "done here, heading to the next url in its queue")
      : "resting, waiting for its next turn",
    at: brain.lastAt || 0
  };
}

function hasAi() {
  return AGENTS.some((agent) => Boolean(agentEnv(agent, "API_KEY")));
}

function statsFor(brains, feed) {
  let pages = 0;
  let tokens = 0;
  let awake = 0;
  const domains = new Set();
  for (const agent of AGENTS) {
    const brain = brains.get(agent.id);
    pages += brain.pages || 0;
    tokens += brain.tokens || 0;
    if (Date.now() - (brain.lastAt || 0) < 20000) awake += 1;
    const host = hostOf(brain.url);
    if (host) domains.add(host);
  }
  for (const item of feed || []) {
    const host = hostOf(item.url);
    if (host) domains.add(host);
  }
  return { pages, tokens, domains: domains.size, awake };
}

async function openFirst(urls, seen) {
  for (const url of urls) {
    try {
      const page = await readPage(url, seen);
      if (page) return page;
    } catch (error) {
      // The next public URL is still worth opening.
    }
  }
  return null;
}

async function crawlOne(agent, brain) {
  const seen = new Set(brain.seen || []);
  const queued = (brain.queue || []).find((url) => url && !seen.has(url));
  let page = null;
  let query = brain.query || agent.seeds[brain.step % agent.seeds.length];
  if (queued) {
    brain.phase = "reading";
    brain.statusLine = "reading the next url in its queue";
    page = await openFirst([queued], seen);
    brain.queue = (brain.queue || []).filter((url) => url !== queued);
  }
  if (!page) {
    query = (brain.nextQuery || agent.seeds[brain.step % agent.seeds.length]).slice(0, 180);
    brain.query = query;
    const urls = await searchWeb(query);
    const open = urls.filter((url) => !url.includes("wikipedia.org/wiki/"));
    const wiki = urls.find((url) => url.includes("wikipedia.org/wiki/")) || "";
    page = await openFirst(open.slice(0, 2), seen);
    if (!page) {
      try {
        const bundle = wiki ? [wiki] : await searchWikiBundle(query);
        const article = bundle.find((url) => url.includes("wikipedia.org/wiki/"));
        if (article) page = await readPage(article, seen);
      } catch (error) {
        page = null;
      }
    }
  }
  if (!page) {
    brain.phase = "resting";
    brain.statusLine = "resting, waiting for its next turn";
    brain.lastEvent = null;
    if (!brain.pages) {
      brain.searching = query;
      brain.learning = "No public page opened for that search.";
      brain.url = "";
    }
    brain.step += 1;
    brain.nextQuery = agent.seeds[brain.step % agent.seeds.length];
    brain.lastAt = Date.now();
    return;
  }
  seen.add(page.url);
  brain.seen = [...seen].slice(-20);
  const thought = await think(agent, brain, page);
  const excerpt = page.text.slice(0, 180).trim();
  const freshLinks = (page.links || []).filter((link) => link.url && link.url !== page.url && !seen.has(link.url));
  brain.links = freshLinks.slice(0, 6);
  brain.queue = [...new Set(freshLinks.map((link) => link.url))].slice(0, 8);
  brain.nextUrl = brain.queue[0] || "";
  brain.title = page.title || page.url;
  const tokens = Math.max(1, Math.round(page.text.length / 4));
  brain.pages = (brain.pages || 0) + 1;
  brain.tokens = (brain.tokens || 0) + tokens;
  brain.phase = "next";
  brain.statusLine = brain.nextUrl
    ? "done here, heading to the next url in its queue"
    : "done here, looking for the next public page";
  brain.searching = (thought && thought.searching) || query;
  brain.learning = (thought && thought.learning) || excerpt;
  brain.url = page.url;
  const note = (thought && thought.note) || (page.title + " — " + excerpt);
  brain.notes = [...(brain.notes || []), note].slice(-12);
  brain.nextQuery = (thought && thought.nextQuery) || agent.seeds[(brain.step + 1) % agent.seeds.length];
  brain.step += 1;
  brain.lastAt = Date.now();
  brain.lastEvent = {
    ts: brain.lastAt,
    title: brain.title,
    url: page.url,
    tokens,
    host: hostOf(page.url)
  };
}

async function tick(options) {
  const force = Boolean(options && options.force);
  if (force) await saveJson("heartbeat.json", { at: Date.now() });
  if (!force) {
    const beat = await loadJson("heartbeat.json");
    if (beat && Date.now() - (beat.at || 0) < 90000) {
      const live = await loadJson("live.json");
      if (live && live.agents) {
        live.ok = true;
        live.ai = hasAi();
        live.source = "vm";
        return live;
      }
    }
  }
  const previous = await loadJson("live.json");
  let feed = Array.isArray(previous && previous.feed) ? previous.feed : [];
  const brains = new Map();
  for (const agent of AGENTS) brains.set(agent.id, await loadBrain(agent));
  const oldest = [...AGENTS].sort((a, b) => (brains.get(a.id).lastAt || 0) - (brains.get(b.id).lastAt || 0))[0];
  const brain = brains.get(oldest.id);
  let crawled = null;
  if (Date.now() - (brain.lastAt || 0) >= COOLDOWN_MS) {
    try {
      await crawlOne(oldest, brain);
      crawled = oldest.id;
    } catch (error) {
      console.error("crawl", oldest.id, error && error.message);
      brain.phase = "resting";
      brain.statusLine = "resting, waiting for its next turn";
      brain.lastEvent = null;
      brain.searching = brain.query || oldest.seeds[0];
      if (!brain.url) brain.learning = "The last crawl did not finish. Another public page is next.";
      brain.step += 1;
      brain.nextQuery = oldest.seeds[brain.step % oldest.seeds.length];
      brain.lastAt = Date.now();
    }
    const event = brain.lastEvent;
    delete brain.lastEvent;
    await saveBrain(oldest, brain);
    if (event) {
      feed.unshift({ ...event, id: oldest.id, name: oldest.name });
      feed = feed.slice(0, 40);
    }
  }
  if (!feed.length) {
    feed = AGENTS.map((agent) => {
      const item = brains.get(agent.id);
      if (!item.url) return null;
      return {
        ts: item.lastAt || Date.now(),
        id: agent.id,
        name: agent.name,
        title: item.title || item.searching,
        url: item.url,
        tokens: item.tokens || Math.max(1, Math.round(String(item.learning || "").length / 4)),
        host: hostOf(item.url)
      };
    }).filter(Boolean).sort((a, b) => b.ts - a.ts);
  }
  const state = {
    ok: true,
    ai: hasAi(),
    crawled,
    source: force ? "vm" : "web",
    stats: statsFor(brains, feed),
    feed,
    agents: AGENTS.map((agent) => view(agent, brains.get(agent.id)))
  };
  await saveJson("live.json", state);
  if (force) await saveJson("heartbeat.json", { at: Date.now() });
  return state;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Use GET" });
    return;
  }
  try {
    const state = await tick();
    res.status(200).json(state);
  } catch (error) {
    res.status(500).json({ ok: false, error: "The agent crawl failed." });
  }
};

module.exports.tick = tick;
module.exports._test = { isPrivateIp, isPublicHttp, stripHtml, searchWeb, readPage };
