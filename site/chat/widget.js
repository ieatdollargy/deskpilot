// Deskpilot agent chat widget — lazy-loaded only when CHAT_ENABLED.
// No secrets here: config (flag, site key, agent display info) comes from /api/chat-config.
(function () {
  "use strict";

  var CONFIG = null;
  var AGENTS = {};
  var PANEL = null;
  var CURRENT = null; // { agentId, sessionId, videoSrc, messagesEl, input, sendBtn, state }
  var TURNSTILE_READY = false;
  var TURNSTILE_WIDGET_ID = null;
  var PENDING_TOKEN = null;

  var MSG_MAX = 500;
  var STORE_CAP = 20;

  function storeKey(agentId) {
    return "dp_chat_" + agentId;
  }

  function sessionKey(agentId) {
    return "dp_chat_sid_" + agentId;
  }

  function getSessionId(agentId) {
    try {
      var k = sessionKey(agentId);
      var v = window.localStorage.getItem(k);
      if (v && /^[A-Za-z0-9\-_]{8,64}$/.test(v)) return v;
      var fresh = "";
      if (window.crypto && window.crypto.randomUUID) fresh = window.crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      else fresh = "s" + String(Date.now()) + Math.floor(Math.random() * 1e9).toString(36);
      window.localStorage.setItem(k, fresh);
      return fresh;
    } catch (e) {
      return "anon" + String(Date.now());
    }
  }

  function loadMirror(agentId) {
    try {
      var raw = window.localStorage.getItem(storeKey(agentId));
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(-STORE_CAP) : [];
    } catch (e) {
      return [];
    }
  }

  function saveMirror(agentId, messages) {
    try {
      window.localStorage.setItem(storeKey(agentId), JSON.stringify(messages.slice(-STORE_CAP)));
    } catch (e) { /* storage full or blocked */ }
  }

  function buildGreeting(cfg) {
    return "I'm " + cfg.name + ", " + cfg.role + " of Deskpilot. " +
      cfg.greetingScope + " " +
      "I answer from what I've actually read in a small set of recent notes, so I'll tell you plainly when I haven't read something. " +
      "What's your name, and how can I help?";
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function ensureCss() {
    if (document.getElementById("dp-chat-css")) return;
    var l = document.createElement("link");
    l.id = "dp-chat-css";
    l.rel = "stylesheet";
    l.href = "chat/widget.css";
    document.head.appendChild(l);
  }

  function loadTurnstile(siteKey, done) {
    if (TURNSTILE_READY) {
      done(true);
      return;
    }
    if (document.getElementById("dp-turnstile-js")) {
      var tries = 0;
      var iv = setInterval(function () {
        tries += 1;
        if (window.turnstile) {
          clearInterval(iv);
          TURNSTILE_READY = true;
          done(true);
        } else if (tries > 50) {
          clearInterval(iv);
          done(false);
        }
      }, 100);
      return;
    }
    var s = document.createElement("script");
    s.id = "dp-turnstile-js";
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = function () {
      TURNSTILE_READY = !!window.turnstile;
      done(TURNSTILE_READY);
    };
    s.onerror = function () {
      done(false);
    };
    document.head.appendChild(s);
  }

  function ensureTurnstileWidget() {
    if (!CONFIG || !CONFIG.turnstileSiteKey || !window.turnstile) return false;
    var holder = document.getElementById("dp-turnstile-holder");
    if (!holder) return false;
    if (TURNSTILE_WIDGET_ID === null) {
      try {
        TURNSTILE_WIDGET_ID = window.turnstile.render(holder, {
          sitekey: CONFIG.turnstileSiteKey,
          size: "invisible",
          callback: function (token) {
            PENDING_TOKEN = token;
            if (CURRENT && CURRENT.waitingToken) {
              CURRENT.waitingToken = false;
              sendMessage();
            }
          },
          "error-callback": function () {
            if (CURRENT) notice("Human check failed to load — tap retry to try again.", true);
          }
        });
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  function buildPanel() {
    if (PANEL) return PANEL;
    ensureCss();
    var p = el("div", "dp-chat");
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Agent chat");
    p.innerHTML =
      '<div class="dp-chat-head">' +
        '<span class="dp-chat-avatar" aria-hidden="true"></span>' +
        '<span class="dp-chat-titles"><b></b><i></i></span>' +
        '<span class="dp-chat-ailabel">AI agent</span>' +
        '<button class="dp-chat-close" type="button" aria-label="Close chat">✕</button>' +
      "</div>" +
      '<div class="dp-chat-msgs" aria-live="polite" aria-label="Conversation"></div>' +
      '<div class="dp-chat-typing" hidden><span></span><span></span><span></span></div>' +
      '<div class="dp-chat-notice" hidden></div>' +
      '<div class="dp-chat-redirect" hidden></div>' +
      '<div class="dp-chat-inputrow">' +
        '<textarea rows="1" maxlength="500" aria-label="Message the agent" placeholder="Message…"></textarea>' +
        '<button class="dp-chat-send" type="button" aria-label="Send message">↑</button>' +
      "</div>" +
      '<div class="dp-chat-meta"><span class="dp-chat-count">0/500</span></div>' +
      '<div class="dp-chat-foot">AI agent. Not financial advice. Chats are stored for 30 days. Never share keys or seed phrases.</div>' +
      '<div id="dp-turnstile-holder"></div>';
    document.body.appendChild(p);
    var closeBtn = p.querySelector(".dp-chat-close");
    closeBtn.addEventListener("click", close);
    var input = p.querySelector("textarea");
    var sendBtn = p.querySelector(".dp-chat-send");
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener("input", function () {
      p.querySelector(".dp-chat-count").textContent = String(input.value.length) + "/500";
      input.style.height = "auto";
      input.style.height = Math.min(96, input.scrollHeight) + "px";
    });
    sendBtn.addEventListener("click", sendMessage);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && PANEL && PANEL.classList.contains("open")) close();
    });
    PANEL = p;
    return p;
  }

  function notice(text, isErr) {
    var n = PANEL.querySelector(".dp-chat-notice");
    n.hidden = false;
    n.textContent = text;
    n.classList.toggle("err", !!isErr);
  }

  function clearNotice() {
    var n = PANEL.querySelector(".dp-chat-notice");
    n.hidden = true;
    n.textContent = "";
  }

  function bubble(role, text) {
    var msgs = PANEL.querySelector(".dp-chat-msgs");
    var b = el("div", "dp-msg " + (role === "user" ? "me" : "them"), text);
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  function setTyping(on) {
    PANEL.querySelector(".dp-chat-typing").hidden = !on;
    if (on) {
      var msgs = PANEL.querySelector(".dp-chat-msgs");
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  function showRedirect(agentId) {
    var cfg = AGENTS[agentId];
    if (!cfg) return;
    var box = PANEL.querySelector(".dp-chat-redirect");
    box.hidden = false;
    box.textContent = "";
    var btn = el("button", "dp-chat-open-other", "Open chat with " + cfg.name);
    btn.type = "button";
    btn.addEventListener("click", function () {
      open(agentId);
    });
    box.appendChild(btn);
  }

  function hideRedirect() {
    var box = PANEL.querySelector(".dp-chat-redirect");
    box.hidden = true;
    box.textContent = "";
  }

  function paintHead(cfg, videoSrc) {
    PANEL.querySelector(".dp-chat-titles b").textContent = cfg.name;
    PANEL.querySelector(".dp-chat-titles i").textContent = cfg.role;
    PANEL.style.setProperty("--accent", cfg.accent || "#e23b2f");
    var av = PANEL.querySelector(".dp-chat-avatar");
    av.textContent = "";
    if (videoSrc) {
      var v = document.createElement("video");
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = videoSrc;
      v.setAttribute("aria-hidden", "true");
      v.addEventListener("error", function () {
        av.textContent = cfg.name.slice(0, 1);
      });
      av.appendChild(v);
      var play = v.play ? v.play() : null;
      if (play && play.catch) play.catch(function () { /* still frame is fine */ });
      if (!v.currentSrc && !v.src) av.textContent = cfg.name.slice(0, 1);
    } else {
      av.textContent = cfg.name.slice(0, 1);
    }
  }

  function open(agentId, videoSrc) {
    var cfg = AGENTS[agentId];
    if (!cfg) return;
    buildPanel();
    var first = !CURRENT || CURRENT.agentId !== agentId;
    CURRENT = {
      agentId: agentId,
      sessionId: getSessionId(agentId),
      videoSrc: videoSrc || "",
      mirror: loadMirror(agentId),
      waitingToken: false,
      busy: false
    };
    hideRedirect();
    clearNotice();
    paintHead(cfg, CURRENT.videoSrc);
    var msgs = PANEL.querySelector(".dp-chat-msgs");
    msgs.textContent = "";
    CURRENT.mirror.forEach(function (m) {
      bubble(m.role, m.content);
    });
    if (!CURRENT.mirror.length) {
      var g = buildGreeting(cfg);
      bubble("assistant", g);
      CURRENT.mirror.push({ role: "assistant", content: g });
      saveMirror(agentId, CURRENT.mirror);
    }
    PANEL.classList.add("open");
    loadTurnstile(CONFIG.turnstileSiteKey, function (ok) {
      if (ok) ensureTurnstileWidget();
    });
    var input = PANEL.querySelector("textarea");
    input.value = "";
    PANEL.querySelector(".dp-chat-count").textContent = "0/500";
    setTimeout(function () {
      input.focus();
    }, 50);
  }

  function close() {
    if (PANEL) PANEL.classList.remove("open");
    setTyping(false);
    if (CURRENT) CURRENT.busy = false;
  }

  function needToken() {
    return !PENDING_TOKEN;
  }

  function sendMessage() {
    if (!CURRENT || CURRENT.busy) return;
    var input = PANEL.querySelector("textarea");
    var text = input.value.trim();
    if (!text) return;
    if (text.length > MSG_MAX) {
      notice("Keep it under 500 characters.", true);
      return;
    }
    if (needToken()) {
      if (!TURNSTILE_READY || !ensureTurnstileWidget()) {
        notice("Loading the human check — try again in a second.", true);
        loadTurnstile(CONFIG.turnstileSiteKey, function (ok) {
          if (ok && ensureTurnstileWidget() && window.turnstile && TURNSTILE_WIDGET_ID !== null) {
            try {
              window.turnstile.execute(TURNSTILE_WIDGET_ID);
              CURRENT.waitingToken = true;
            } catch (e) {
              notice("Human check failed to start — tap retry.", true);
            }
          }
        });
        return;
      }
      try {
        window.turnstile.execute(TURNSTILE_WIDGET_ID);
        CURRENT.waitingToken = true;
        notice("Checking you're human…", false);
      } catch (e) {
        notice("Human check failed to start — tap retry.", true);
      }
      return;
    }
    doSend(text, PENDING_TOKEN);
    PENDING_TOKEN = null;
    try {
      if (window.turnstile && TURNSTILE_WIDGET_ID !== null) window.turnstile.reset(TURNSTILE_WIDGET_ID);
    } catch (e) { /* single-use token already consumed */ }
  }

  function doSend(text, token) {
    CURRENT.busy = true;
    clearNotice();
    hideRedirect();
    bubble("user", text);
    CURRENT.mirror.push({ role: "user", content: text });
    saveMirror(CURRENT.agentId, CURRENT.mirror);
    PANEL.querySelector("textarea").value = "";
    PANEL.querySelector(".dp-chat-count").textContent = "0/500";
    setTyping(true);

    var agentId = CURRENT.agentId;
    var sessionId = CURRENT.sessionId;

    fetch("api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, session_id: sessionId, message: text, turnstile_token: token })
    }).then(function (resp) {
      if (resp.status === 404) {
        setTyping(false);
        CURRENT.busy = false;
        notice("Chat is off right now.", true);
        return null;
      }
      if (resp.status === 429) {
        setTyping(false);
        CURRENT.busy = false;
        return resp.json().then(function (j) {
          notice((j && j.error) || "Slow down — try again in a bit.", true);
        });
      }
      if (resp.status === 403) {
        setTyping(false);
        CURRENT.busy = false;
        PENDING_TOKEN = null;
        try {
          if (window.turnstile && TURNSTILE_WIDGET_ID !== null) window.turnstile.reset(TURNSTILE_WIDGET_ID);
        } catch (e) { /* noop */ }
        return resp.json().then(function (j) {
          notice((j && j.error) || "Please complete the human check.", true);
        });
      }
      if (!resp.ok || !resp.body) throw new Error("bad response");
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      var agg = bubble("assistant", "");
      var finished = false;

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            setTyping(false);
            CURRENT.busy = false;
            CURRENT.mirror.push({ role: "assistant", content: agg.textContent });
            saveMirror(CURRENT.agentId, CURRENT.mirror);
            return;
          }
          buf += decoder.decode(r.value, { stream: true });
          var parts = buf.split("\n\n");
          buf = parts.pop() || "";
          parts.forEach(function (part) {
            var ev = "";
            var data = [];
            part.split("\n").forEach(function (line) {
              if (line.indexOf("event:") === 0) ev = line.slice(6).trim();
              else if (line.indexOf("data:") === 0) data.push(line.slice(5).trim());
            });
            if (!data.length) return;
            var payload = {};
            try {
              payload = JSON.parse(data.join("\n"));
            } catch (e) {
              return;
            }
            if (ev === "delta" && payload.t) {
              if (!finished) {
                setTyping(false);
                finished = true;
              }
              agg.textContent += payload.t;
              var msgs = PANEL.querySelector(".dp-chat-msgs");
              msgs.scrollTop = msgs.scrollHeight;
            } else if (ev === "done") {
              if (payload.bestAgent) showRedirect(payload.bestAgent);
            } else if (ev === "resting") {
              setTyping(false);
              agg.textContent = payload.text || "Chat is resting — try again later.";
              var wrap = el("div", "dp-chat-resting", "chat is resting");
              PANEL.querySelector(".dp-chat-msgs").appendChild(wrap);
            } else if (ev === "error") {
              setTyping(false);
              if (!agg.textContent) agg.remove();
              addRetry(payload.error || "That didn't go through.");
            }
          });
          return pump();
        });
      }
      return pump().catch(function () {
        setTyping(false);
        CURRENT.busy = false;
        try {
          var last = PANEL.querySelector(".dp-chat-msgs").lastElementChild;
          if (last && last.classList.contains("them") && !last.textContent) last.remove();
        } catch (e) { /* noop */ }
        addRetry("Connection dropped mid-reply.");
      });
    }).catch(function () {
      setTyping(false);
      CURRENT.busy = false;
      addRetry("Hmm, that didn't go through.");
    });
  }

  function addRetry(text) {
    var box = PANEL.querySelector(".dp-chat-redirect");
    box.hidden = false;
    box.textContent = "";
    var s = el("span", "dp-chat-err", text + " ");
    var btn = el("button", "dp-chat-retry", "Retry");
    btn.type = "button";
    btn.addEventListener("click", function () {
      box.hidden = true;
      box.textContent = "";
      CURRENT.busy = false;
      var input = PANEL.querySelector("textarea");
      if (!input.value) {
        var last = null;
        for (var i = CURRENT.mirror.length - 1; i >= 0; i -= 1) {
          if (CURRENT.mirror[i].role === "user") {
            last = CURRENT.mirror[i].content;
            break;
          }
        }
        if (last) input.value = last;
      }
      sendMessage();
    });
    box.appendChild(s);
    box.appendChild(btn);
  }

  if (typeof window !== "undefined") {
    window.DeskpilotChat = {
    init: function (config) {
      CONFIG = config;
      (config.agents || []).forEach(function (a) {
        AGENTS[a.id] = a;
      });
    },
    open: open,
    close: close
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildGreeting: buildGreeting, storeKey: storeKey, sessionKey: sessionKey, MSG_MAX: MSG_MAX };
  }
})();
