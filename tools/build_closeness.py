"""Builds closeness/<answer>.json for every answer in questions.js.

Each file lists the words closest in meaning to that answer, closest first
(the answer itself is #1). The game uses it to rank guesses.

Usage:  python tools/build_closeness.py
Run it again whenever you add questions. The first run downloads GloVe word
vectors (about 128 MB) into tools/.cache/; later runs reuse them.
"""
import gzip
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
OUT = ROOT / "closeness"
URL = "https://github.com/RaRe-Technologies/gensim-data/releases/download/glove-wiki-gigaword-100/glove-wiki-gigaword-100.gz"
GZ = CACHE / "glove-wiki-gigaword-100.gz"
WORDS_FILE = CACHE / "words.txt"
VECS_FILE = CACHE / "vectors.npy"

RANKABLE = 50_000  # the most common words that can appear in a ranking
KEEP = 3_000       # how many ranked words each answer file stores


def read_answers():
    """Ask node to evaluate questions.js so we read it exactly as the browser does."""
    js = (
        "const vm=require('vm'),fs=require('fs');const s={window:{}};"
        "vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),s);"
        "console.log(JSON.stringify(s.window.QUESTIONS.map(q=>[q.a,q.like||''])))"
    )
    out = subprocess.run(
        ["node", "-e", js, str(ROOT / "questions.js")],
        capture_output=True, text=True, check=True,
    ).stdout
    return [(a.lower(), like.lower()) for a, like in json.loads(out)]


def load_vectors():
    if WORDS_FILE.exists() and VECS_FILE.exists():
        words = WORDS_FILE.read_text(encoding="utf-8").split("\n")
        return words, np.load(VECS_FILE).astype(np.float32)

    CACHE.mkdir(parents=True, exist_ok=True)
    if not GZ.exists():
        print("Downloading GloVe word vectors (about 128 MB)...")
        tmp = GZ.with_suffix(".part")
        urllib.request.urlretrieve(URL, tmp)
        tmp.rename(GZ)

    print("Reading vectors (one time only)...")
    words, rows = [], []
    with gzip.open(GZ, "rt", encoding="utf-8") as f:
        f.readline()  # header: "<count> <dims>"
        for line in f:
            parts = line.rstrip("\n").split(" ")
            words.append(parts[0])
            rows.append(np.asarray(parts[1:], dtype=np.float32))
    vecs = np.vstack(rows)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    WORDS_FILE.write_text("\n".join(words), encoding="utf-8")
    np.save(VECS_FILE, vecs.astype(np.float16))
    return words, vecs


def main():
    answers = read_answers()
    words, vecs = load_vectors()
    index = {w: i for i, w in enumerate(words)}

    # Only plain, common words are rankable (GloVe lists words most-common first).
    cand = [i for i in range(min(RANKABLE, len(words))) if words[i].isascii() and words[i].isalpha()]
    cand_words = [words[i] for i in cand]
    cand_vecs = vecs[cand]

    OUT.mkdir(exist_ok=True)
    missing = []
    for ans, like in answers:
        # "like" lends a common word's meaning to answers that are missing from the data or too
        # rare for it to know well (often the long ones).
        base = like if like in index else ans if ans in index else None
        if base is None:
            missing.append(f"{ans} (no data for \"{like}\" either)" if like else ans)
            continue
        sims = cand_vecs @ vecs[index[base]]
        order = np.argsort(-sims)
        ranked = [ans] + [cand_words[i] for i in order if cand_words[i] != ans][: KEEP - 1]
        (OUT / f"{ans}.json").write_text(json.dumps(ranked, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {len(answers) - len(missing)} files to closeness/.")
    if missing:
        print("No meaning data for: " + ", ".join(missing))
        print("Guesses for those days will still work, just without closeness ranks.")
        print('Fix: give the question a common word with a similar meaning, like: "superstition".')
        sys.exit(1)


if __name__ == "__main__":
    main()
