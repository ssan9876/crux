// Posts today's Crux question to a Discord channel through a webhook.
// Run daily by .github/workflows/daily-discord.yml; the webhook URL comes from the
// DISCORD_WEBHOOK_URL repository secret.
//
// Try it locally without posting:  node tools/post_discord.mjs --dry-run
// Set TZ to choose whose "today" it is (the workflow uses America/Phoenix).
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SITE = "https://crux.ssander.xyz/";
const LAUNCH = new Date(2026, 10, 20); // keep in sync with game.js
const MAX_GUESSES = 6;

// Load questions exactly as the browser does, and skip invalid ones the same way game.js does.
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL("../questions.js", import.meta.url), "utf8"), sandbox);
const isOneWord = (s) => typeof s === "string" && /^[A-Za-z]+$/.test(s);
const bank = (sandbox.window.QUESTIONS || []).filter(
  (item) => item && item.q && isOneWord(item.a) && (item.accept || []).every(isOneWord)
);

const now = new Date();
const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const day = Math.max(1, Math.round((midnight - LAUNCH) / 86400000) + 1);
const puzzle = bank[(day - 1) % bank.length];

const payload = {
  username: "Crux",
  embeds: [
    {
      title: `Crux No. ${day}`,
      url: SITE,
      description: `## ${puzzle.q}\nThe answer has **${puzzle.a.length} letters**. You get ${MAX_GUESSES} guesses.\n\n**[Play today's Crux](${SITE})**`,
      color: 0x2b45e0,
      footer: { text: "Share your result here when you're done. Keep answers in ||spoiler tags||." },
    },
  ],
  allowed_mentions: { parse: [] },
};

const webhook = process.env.DISCORD_WEBHOOK_URL;
if (process.argv.includes("--dry-run") || !webhook) {
  if (!webhook) {
    // "::warning::" shows up as a yellow note on the run in GitHub's Actions tab.
    console.log("::warning::DISCORD_WEBHOOK_URL secret is not set, so nothing was posted to Discord.");
    console.log("This is what would be sent:\n");
  }
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const res = await fetch(webhook, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
if (!res.ok) {
  console.error(`Discord rejected the post: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`Posted Crux No. ${day} to Discord.`);
