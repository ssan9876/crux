(() => {
  // Day 1 of the game, in the player's local time. Everyone gets a new question at their midnight.
  const LAUNCH = new Date(2026, 10, 20);
  const MAX_GUESSES = 6;
  const HINT_AFTER = 3;
  const KEY_STATE = "crux:state";
  const KEY_STATS = "crux:stats";

  // The game used to be called One Word; carry over anything saved under the old name.
  try {
    for (const k of ["state", "stats"]) {
      const old = localStorage.getItem(`oneword:${k}`);
      if (old && !localStorage.getItem(`crux:${k}`)) localStorage.setItem(`crux:${k}`, old);
      localStorage.removeItem(`oneword:${k}`);
    }
  } catch {}

  const $ = (id) => document.getElementById(id);

  // ---------- Answers ----------
  const isOneWord = (s) => typeof s === "string" && /^[A-Za-z]+$/.test(s);
  const norm = (s) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

  const bank = (window.QUESTIONS || []).filter((item, i) => {
    const ok = item && item.q && isOneWord(item.a) && (item.accept || []).every(isOneWord);
    if (!ok) console.error(`Question ${i + 1} skipped: every answer must be one word, letters only.`, item);
    return ok;
  });

  // Optimal string alignment distance (counts a swap of two neighbours as one typo).
  function typoDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  // ---------- Which day is it ----------
  function dayNumber(date = new Date()) {
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((midnight - LAUNCH) / 86400000) + 1;
  }

  // ?day=12 previews a specific day without touching saved stats.
  const params = new URLSearchParams(location.search);
  const preview = params.has("day") ? Math.max(1, parseInt(params.get("day"), 10) || 1) : null;
  const today = preview ?? Math.max(1, dayNumber());

  if (!bank.length) {
    $("question").textContent = "No questions yet. Add some to questions.js.";
    $("form").hidden = true;
    return;
  }

  const puzzle = bank[(today - 1) % bank.length];
  const answer = norm(puzzle.a);
  const accepted = [answer, ...(puzzle.accept || []).map(norm)];

  function isCorrect(guess) {
    const g = norm(guess);
    if (accepted.includes(g)) return true;
    // Forgive a single typo on longer words ("arachnophbia", "girafe").
    return accepted.some((a) => a.length >= 6 && g.length >= 5 && typoDistance(g, a) <= 1);
  }

  // Closeness in meaning: closeness/<answer>.json lists the nearest words, closest first
  // (built by tools/build_closeness.py). Rank 1 is the answer itself.
  let ranks = null;
  fetch(`closeness/${answer}.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((list) => {
      if (!Array.isArray(list)) return;
      ranks = new Map(list.map((w, i) => [w, i + 1]));
      renderGuesses();
    })
    .catch(() => {});

  // A number, or null when the word is too far away (or unknown) to rank.
  const rankOf = (guess) => (isCorrect(guess) ? 1 : ranks?.get(norm(guess)) ?? null);

  function tier(rank) {
    if (rank === 1) return "correct";
    if (rank && rank <= 10) return "hot";
    if (rank && rank <= 100) return "warm";
    if (rank && rank <= 1000) return "cool";
    return "cold";
  }

  // Letters are revealed first letter first, then in a shuffled order that's the same for everyone that day.
  function seeded(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = seeded(today * 7919);
  const rest = [...Array(answer.length).keys()].slice(1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const revealOrder = [0, ...rest];

  // ---------- Saved progress ----------
  const store = {
    get(key, fallback) {
      if (preview) return fallback;
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      if (preview) return;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    },
  };

  const validState = (s) =>
    s && s.day === today && Array.isArray(s.guesses) && s.guesses.every((g) => typeof g === "string") &&
    ["playing", "won", "lost"].includes(s.status);
  let state = store.get(KEY_STATE, null);
  if (!validState(state)) state = { day: today, guesses: [], status: "playing" };

  // Can this browser actually save? (Not in some private modes, or with site data blocked.)
  const canSave = (() => {
    try {
      localStorage.setItem("crux:test", "1");
      localStorage.removeItem("crux:test");
      return true;
    } catch {
      return false;
    }
  })();

  // Ask the browser not to clear Crux's data when it's low on space or tidying up.
  function keepStorage() {
    if (preview || !navigator.storage?.persist) return;
    navigator.storage.persisted().then((yes) => yes || navigator.storage.persist()).catch(() => {});
  }

  // Never trust saved data blindly: a damaged or hand-edited value shouldn't break the game.
  function cleanStats(s) {
    const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    if (!s || typeof s !== "object") s = {};
    return {
      played: n(s.played),
      wins: n(s.wins),
      streak: n(s.streak),
      maxStreak: n(s.maxStreak),
      lastWinDay: Number.isFinite(s.lastWinDay) ? s.lastWinDay : null,
      dist: Array.from({ length: MAX_GUESSES }, (_, i) => n(s.dist?.[i])),
    };
  }
  let stats = cleanStats(store.get(KEY_STATS, null));

  function recordResult(won) {
    stats.played++;
    if (won) {
      stats.wins++;
      stats.dist[state.guesses.length - 1]++;
      stats.streak = stats.lastWinDay === today - 1 ? stats.streak + 1 : 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      stats.lastWinDay = today;
    } else {
      stats.streak = 0;
    }
    store.set(KEY_STATS, stats);
  }

  const currentStreak = () => (stats.lastWinDay !== null && stats.lastWinDay >= today - 1 ? stats.streak : 0);

  // ---------- Rendering ----------
  const wrongCount = () => state.guesses.filter((g) => !isCorrect(g)).length;
  let lastRevealed = -1;

  function render() {
    const over = state.status !== "playing";
    const wrong = wrongCount();
    const revealed = over ? answer.length : Math.min(wrong, answer.length - 1);
    const shown = new Set(revealOrder.slice(0, revealed));

    $("no").textContent = preview ? `No. ${today} (preview)` : `No. ${today}`;
    $("question").textContent = puzzle.q;

    // Tiles
    const tiles = $("tiles");
    tiles.style.setProperty("--n", answer.length);
    tiles.setAttribute("aria-label", `The answer has ${answer.length} letters`);
    tiles.replaceChildren(
      ...[...answer].map((ch, i) => {
        const t = document.createElement("span");
        t.className = "tile";
        t.style.setProperty("--i", i);
        if (state.status === "won") {
          t.classList.add("solved");
          t.textContent = ch;
        } else if (state.status === "lost") {
          // Letters you'd already earned stay yellow; the ones you never got show in red.
          const earned = Math.min(MAX_GUESSES - 1, answer.length - 1);
          t.classList.add(revealOrder.indexOf(i) < earned ? "shown" : "missed");
          t.textContent = ch;
        } else if (shown.has(i)) {
          t.classList.add("shown");
          if (lastRevealed >= 0 && revealOrder.indexOf(i) >= lastRevealed) t.classList.add("fresh");
          t.textContent = ch;
        }
        return t;
      })
    );
    lastRevealed = revealed;

    // Hint
    const hint = $("hint");
    if (puzzle.hint && (wrong >= HINT_AFTER || over)) {
      hint.hidden = false;
      hint.innerHTML = "<strong>Hint:</strong> ";
      hint.append(puzzle.hint);
    } else {
      hint.hidden = true;
    }

    // Entry
    $("form").hidden = over;
    const left = MAX_GUESSES - state.guesses.length;
    $("left").hidden = over;
    $("say").hidden = over;
    $("left").textContent =
      state.guesses.length === 0
        ? `${MAX_GUESSES} guesses. Each miss reveals a letter.`
        : `${left} ${left === 1 ? "guess" : "guesses"} left.`;

    renderGuesses();

    // Result
    $("result").hidden = !over;
    if (over) {
      const n = state.guesses.length;
      const word = puzzle.a.toUpperCase();
      $("verdict").textContent =
        state.status === "won"
          ? n === 1
            ? `First try. It's ${word}.`
            : `Got it in ${n}. It's ${word}.`
          : `The answer was ${word}.`;
      $("next").hidden = !!preview;
      startCountdown();
    }
  }

  // Guesses, closest in meaning first. Words too far to rank keep the order you guessed them.
  const LOG_KEEP = Math.log(3000);
  function renderGuesses() {
    $("history").hidden = state.guesses.length === 0;
    const latest = state.guesses[state.guesses.length - 1];
    const rows = state.guesses
      .map((g, i) => ({ g, i, rank: rankOf(g) }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.i - b.i);

    $("guesses").replaceChildren(
      ...rows.map(({ g, rank }) => {
        const li = document.createElement("li");
        li.className = `guess ${tier(rank)}`;
        if (g === latest && state.status === "playing") li.classList.add("latest");

        const word = document.createElement("span");
        word.className = "word";
        word.textContent = g;

        const meter = document.createElement("span");
        meter.className = "meter";
        const fill = document.createElement("span");
        // Log scale so the difference between #2 and #20 is visible, not just #20 vs #2000.
        const closeness = rank ? 1 - Math.log(rank) / LOG_KEEP : 0;
        fill.style.width = `${Math.max(4, closeness * 100)}%`;
        meter.append(fill);

        const label = document.createElement("span");
        label.className = "rank";
        label.textContent = rank === 1 ? "Correct" : rank ? `#${rank}` : ranks ? "Far" : "";

        li.append(word, meter, label);
        return li;
      })
    );
  }

  // ---------- Input ----------
  let sayTimer;
  function say(msg) {
    $("say").textContent = msg;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => ($("say").textContent = ""), 2600);
  }

  function shake() {
    const f = $("form");
    f.classList.remove("shake");
    void f.offsetWidth;
    f.classList.add("shake");
  }

  $("guess").addEventListener("keydown", (e) => {
    if (e.key === " ") {
      e.preventDefault();
      say("Answers are always one word.");
    }
  });

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.status !== "playing") return;
    const input = $("guess");
    const raw = input.value.trim();
    if (!raw) return;
    if (/\s/.test(raw)) return say("Answers are always one word.");
    if (!norm(raw)) return say("Use letters only.");
    if (state.guesses.some((g) => norm(g) === norm(raw))) return say("You already guessed that.");

    state.guesses.push(raw);
    input.value = "";

    if (isCorrect(raw)) {
      state.status = "won";
      recordResult(true);
    } else if (state.guesses.length >= MAX_GUESSES) {
      state.status = "lost";
      recordResult(false);
    } else {
      shake();
      const r = rankOf(raw);
      const where = r ? `${raw} is #${r} closest.` : ranks ? `${raw} is far off.` : "Not quite.";
      say(wrongCount() >= answer.length ? where : `${where} Here's a letter.`);
    }
    store.set(KEY_STATE, state);
    render();
    if (state.status === "playing") input.focus();
    else {
      keepStorage();
      setTimeout(openStats, 1200);
    }
  });

  // ---------- Share ----------
  function shareText() {
    const square = { correct: "🟩", hot: "🟧", warm: "🟨", cool: "⬜", cold: "⬛" };
    const marks = state.guesses.map((g) => square[tier(rankOf(g))]).join("");
    const score = state.status === "won" ? `${state.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
    const link = /^https?:/.test(location.protocol) ? `\n${location.origin}${location.pathname}` : "";
    return `Crux No. ${today}  ${score}\n${marks}${link}`;
  }

  $("share").addEventListener("click", async () => {
    const text = shareText();
    try {
      await navigator.clipboard.writeText(text);
      $("share").textContent = "Copied";
      setTimeout(() => ($("share").textContent = "Copy result"), 2000);
    } catch {
      window.prompt("Copy your result:", text);
    }
  });

  // ---------- Countdown to tomorrow ----------
  let countdownTimer;
  function startCountdown() {
    if (preview || countdownTimer) return;
    const tick = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const ms = next - now;
      if (ms <= 0 || dayNumber(now) !== today) return location.reload();
      const s = Math.floor(ms / 1000);
      const pad = (x) => String(x).padStart(2, "0");
      $("countdown").textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  // ---------- Stats ----------
  function openStats() {
    const winPct = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    $("s-played").textContent = stats.played;
    $("s-win").textContent = `${winPct}%`;
    $("s-streak").textContent = currentStreak();
    $("s-max").textContent = stats.maxStreak;
    const top = Math.max(1, ...stats.dist);
    $("s-dist").replaceChildren(
      ...stats.dist.map((count, i) => {
        const li = document.createElement("li");
        const k = document.createElement("span");
        k.className = "k";
        k.textContent = i + 1;
        const bar = document.createElement("span");
        bar.className = "bar";
        if (state.status === "won" && state.guesses.length === i + 1) bar.classList.add("today");
        bar.style.width = `${Math.max(8, (count / top) * 100)}%`;
        bar.textContent = count;
        li.append(k, bar);
        return li;
      })
    );
    $("no-save").hidden = canSave || !!preview;
    $("backup-say").textContent = "";
    if (!$("stats").open) $("stats").showModal();
  }
  $("open-stats").addEventListener("click", openStats);

  // ---------- Backup code: move stats to another browser or device ----------
  const toCode = (obj) => "CRUX1." + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))));
  const fromCode = (code) => {
    const body = code.trim().replace(/^CRUX1\./, "");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))));
  };

  $("copy-backup").addEventListener("click", async () => {
    const code = toCode({ stats, state });
    try {
      await navigator.clipboard.writeText(code);
      $("backup-say").textContent = "Backup code copied. Paste it into Crux on your other device.";
    } catch {
      $("restore-code").value = code;
      $("restore-code").select();
      $("backup-say").textContent = "Copy the code in the box above.";
    }
  });

  $("restore").addEventListener("click", () => {
    let data;
    try {
      data = fromCode($("restore-code").value);
    } catch {
      $("backup-say").textContent = "That code isn't valid. Copy it again from your other device, all of it.";
      return;
    }
    stats = cleanStats(data.stats);
    store.set(KEY_STATS, stats);
    // Bring today's game over too, unless you've already started it here.
    if (validState(data.state) && state.guesses.length === 0) {
      state = data.state;
      store.set(KEY_STATE, state);
      render();
    }
    keepStorage();
    $("restore-code").value = "";
    openStats();
    $("backup-say").textContent = `Stats restored: ${stats.played} played, best streak ${stats.maxStreak}.`;
  });

  render();
  if (state.status === "playing") $("guess").focus({ preventScroll: true });
})();
