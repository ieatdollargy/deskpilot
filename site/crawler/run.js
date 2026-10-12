const { tick } = require("../api/agents");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop() {
  for (;;) {
    const started = Date.now();
    try {
      const state = await tick({ force: true });
      const top = (state.feed || [])[0];
      console.log(new Date().toISOString(), state.crawled || "idle", top ? top.name + " " + top.title : "");
    } catch (error) {
      console.error("tick", error && error.message);
    }
    await sleep(Math.max(0, 10000 - (Date.now() - started)));
  }
}

loop();
