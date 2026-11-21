// Checks questions.js: every answer must be one word (letters only), and no answer repeats.
// Usage: node check.mjs
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL("./questions.js", import.meta.url), "utf8"), sandbox);
const questions = sandbox.window.QUESTIONS || [];

const oneWord = (s) => typeof s === "string" && /^[A-Za-z]+$/.test(s);
const problems = [];
const seen = new Map();

questions.forEach((item, i) => {
  const n = i + 1;
  if (!item.q || !item.q.trim()) problems.push(`#${n}: missing question text`);
  if (!oneWord(item.a)) problems.push(`#${n}: answer "${item.a}" is not a single word of letters`);
  for (const alt of item.accept || []) {
    if (!oneWord(alt)) problems.push(`#${n}: accepted answer "${alt}" is not a single word of letters`);
  }
  const key = String(item.a).toLowerCase();
  if (seen.has(key)) problems.push(`#${n}: answer "${item.a}" repeats #${seen.get(key)}`);
  else seen.set(key, n);
});

const noCloseness = questions
  .filter((item) => oneWord(item.a) && !existsSync(new URL(`./closeness/${item.a.toLowerCase()}.json`, import.meta.url)))
  .map((item) => item.a);
if (noCloseness.length) {
  problems.push(`no closeness file for: ${noCloseness.join(", ")} (run: python tools/build_closeness.py)`);
}

const launch = new Date(2026, 10, 20);
const last = new Date(launch);
last.setDate(launch.getDate() + questions.length - 1);

console.log(`${questions.length} questions. Fresh ones last until ${last.toDateString()}, then they repeat.`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log("All answers are one word.");
