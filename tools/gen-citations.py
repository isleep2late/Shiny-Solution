#!/usr/bin/env python3
"""Emits core/data/citations.json, the decomp citation registry, from docs/FACTS.md.

Every `repo/path:lines` citation in docs/FACTS.md (repo one of the pret decompilations) becomes one entry keyed by the
citation as resolved: the repository, the path inside it, the line list, the FACTS.md section it sits in (the first
one, and every section that cites it under "sections"), the FACTS.md line number and the sentence or table row around
it. Two shorthands FACTS.md uses are resolved too: a bare `file.c:lines` inherits the repository of the previous full
citation in the same paragraph, and `repo/.../file.c:lines` finds the one file of that name in the repository. Each
entry is then read in the checkout of pret (--pret, default ~/AI/pret): the file must exist, every cited line must be
inside it, the first cited line must not be blank or a lone brace (a range that starts there points beside the routine
it names), and the first cited line's text is recorded, so the registry states what the line said when it was
generated. A line past the end of its file or a range starting on a blank line or a brace is a failure (exit 1); a
citation that cannot be resolved is listed under "skipped", which the output also carries so nothing is silently
dropped.

The web wizard tab (webapp/wizard-ui.js) and the desktop wizard panel (app/App/WizardSupport.cs) render the sources of
each procedure step as footnotes over this registry: a footnote whose citation is not in the registry says so.
Deterministic: two runs over the same FACTS.md and pret give byte-identical files.

    python3 tools/gen-citations.py [--facts docs/FACTS.md] [--pret ~/AI/pret] [out.json]   (stdout when no path is given)
"""
import argparse
import json
import os
import re
import sys

REPOS = ["pokered", "pokeyellow", "pokecrystal", "pokegold", "pokeruby", "pokeemerald", "pokefirered", "pokediamond", "pokeplatinum", "pokeheartgold"]
LINES = r"\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*"
FULL = re.compile(r"\b(" + "|".join(REPOS) + r")/((?:\.\.\./)?[A-Za-z0-9_./-]+?\.(?:c|h|asm|inc|s)):(" + LINES + r")\b")
# a range whose first cited line is one of these points beside the routine it names (a blank line, a brace): refused
BESIDE = ("", "{", "}", "};")
BARE = re.compile(r"(?<![A-Za-z0-9_./-])((?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.(?:c|h|asm|inc|s)):(" + LINES + r")\b")


def line_numbers(spec):
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


def find_by_name(pret, repo, name):
    hits = []
    for base, dirs, files in os.walk(os.path.join(pret, repo)):
        dirs[:] = [d for d in dirs if d not in (".git", "build", "tools")]
        if name in files:
            hits.append(os.path.relpath(os.path.join(base, name), os.path.join(pret, repo)))
    return sorted(hits)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--facts", default=os.path.join(os.path.dirname(__file__), "..", "docs", "FACTS.md"))
    ap.add_argument("--pret", default=os.path.expanduser("~/AI/pret"))
    ap.add_argument("out", nargs="?")
    args = ap.parse_args()
    if not os.path.isdir(args.pret):
        print("gen-citations.py: no pret checkout at " + args.pret, file=sys.stderr)
        return 1
    text = open(args.facts, encoding="utf-8").read().split("\n")
    entries = {}
    skipped = []
    headings = {}
    paragraph_repo = None
    for number, raw in enumerate(text, 1):
        line = raw.rstrip()
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            title = m.group(2).replace("`", "").strip()
            headings[level] = re.sub(r"\s*\(.*?\)\s*$", "", title).strip() if level > 1 else title
            for deeper in list(headings):
                if deeper > level:
                    del headings[deeper]
            paragraph_repo = None
            continue
        if not line.strip():
            paragraph_repo = None
            continue
        section = " / ".join(headings[k] for k in sorted(headings))
        found = []
        for m in FULL.finditer(line):
            repo, path, lines = m.group(1), m.group(2), m.group(3)
            paragraph_repo = repo
            found.append((m.start(), repo, path, lines, m.group(0)))
        spans = [(f[0], f[0] + len(f[4])) for f in found]
        for m in BARE.finditer(line):
            if any(s <= m.start() < e for s, e in spans):
                continue
            path, lines = m.group(1), m.group(2)
            if paragraph_repo is None:
                skipped.append({"facts_line": number, "as_written": m.group(0), "why": "bare path with no repository named earlier in the paragraph"})
                continue
            found.append((m.start(), paragraph_repo, path, lines, m.group(0)))
        for _, repo, path, lines, written in found:
            if path.startswith(".../") or "/" not in path:
                hits = find_by_name(args.pret, repo, path.split("/")[-1])
                if len(hits) != 1:
                    skipped.append({"facts_line": number, "as_written": written, "why": ("no file" if not hits else str(len(hits)) + " files") + " named " + path.split("/")[-1] + " in " + repo})
                    continue
                path = hits[0]
            elif not os.path.isfile(os.path.join(args.pret, repo, path)):
                hits = [h for h in find_by_name(args.pret, repo, path.split("/")[-1]) if h.endswith("/" + path)]
                if len(hits) != 1:
                    skipped.append({"facts_line": number, "as_written": written, "why": "no file " + path + " in " + repo})
                    continue
                path = hits[0]
            cite = repo + "/" + path + ":" + lines
            if cite in entries:
                entries[cite]["count"] += 1
                if section not in entries[cite]["sections"]:
                    entries[cite]["sections"].append(section)
                continue
            full = os.path.join(args.pret, repo, path)
            src = open(full, encoding="utf-8", errors="replace").read().split("\n")
            numbers = line_numbers(lines)
            if max(numbers) > len(src):
                skipped.append({"facts_line": number, "as_written": written, "why": "line " + str(max(numbers)) + " is past the end of " + repo + "/" + path + " (" + str(len(src)) + " lines)"})
                continue
            first_line = src[numbers[0] - 1].strip()
            if first_line in BESIDE:
                skipped.append({"facts_line": number, "as_written": written, "why": "line " + str(numbers[0]) + " of " + repo + "/" + path + " is " + ("blank" if not first_line else "a lone brace") + ": the range starts beside the routine it names"})
                continue
            entries[cite] = {
                "cite": cite, "repo": repo, "path": path, "lines": lines, "as_written": written, "section": section, "sections": [section],
                "facts_line": number, "context": re.sub(r"\s+", " ", line.strip())[:240], "first_line": first_line[:160], "count": 1,
            }
    if any(s["why"].startswith("line ") for s in skipped):
        for s in skipped:
            print("gen-citations.py: " + json.dumps(s), file=sys.stderr)
        return 1
    heads = {}
    for repo in REPOS:
        head = os.path.join(args.pret, repo, ".git", "HEAD")
        if os.path.isfile(head):
            ref = open(head).read().strip()
            if ref.startswith("ref: "):
                refp = os.path.join(args.pret, repo, ".git", ref[5:])
                packed = os.path.join(args.pret, repo, ".git", "packed-refs")
                if os.path.isfile(refp):
                    ref = open(refp).read().strip()
                elif os.path.isfile(packed):
                    for pl in open(packed):
                        if pl.strip().endswith(" " + ref[5:]):
                            ref = pl.split()[0]
            heads[repo] = ref
    out = {
        "source": "docs/FACTS.md", "generator": "tools/gen-citations.py", "pret": heads,
        "entries": [entries[k] for k in sorted(entries)], "skipped": skipped,
    }
    data = json.dumps(out, indent=1, ensure_ascii=False) + "\n"
    if args.out:
        open(args.out, "w", encoding="utf-8").write(data)
    else:
        sys.stdout.write(data)
    print("citations: " + str(len(entries)) + " entries from " + str(sum(e["count"] for e in entries.values())) + " citations, " + str(len(skipped)) + " skipped", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
