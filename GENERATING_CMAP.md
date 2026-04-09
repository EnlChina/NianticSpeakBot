# Generating `src/cmap_ja.ts`

This document explains how to regenerate `src/cmap_ja.ts` from a Japanese font.

## Prerequisites

- Python 3
- `fonttools` Python package
- A Japanese font file (for example `NotoSansJP-Regular.ttf`)

Install `fonttools`:

```bash
python3 -m pip install fonttools
```

## 1) Put the font file in the repository root

Example:

```bash
cp /path/to/NotoSansJP-Regular.ttf /home/runner/work/NianticSpeakBot/NianticSpeakBot/
```

## 2) Generate `src/cmap_ja.ts`

From the repository root, run:

```bash
python3 - <<'PY'
from fontTools.ttLib import TTFont

font = TTFont('NotoSansJP-Regular.ttf')
cmap_set = set()
for table in font['cmap'].tables:
    for ord_char in table.cmap:
        cmap_set.add(ord_char)

sorted_codepoints = sorted(cmap_set)
body = ','.join(hex(cp) for cp in sorted_codepoints)

with open('src/cmap_ja.ts', 'w', encoding='utf-8') as f:
    f.write(f'export default new Set([{body}]);\n')

print(f'Generated src/cmap_ja.ts with {len(sorted_codepoints)} code points')
PY
```

## 3) Validate changes

After regenerating the file, run project checks from the repository root:

```bash
npx tsc --noEmit
npx wrangler deploy --dry-run
```

## Notes

- `src/cmap_ja.ts` is expected to be a single-line `Set` export in hexadecimal format.
- Sort code points before writing to keep deterministic output.
- If you use a different font file, update the filename in the Python snippet.
