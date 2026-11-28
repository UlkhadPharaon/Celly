# Celly — publication kit

Everything needed to publish the Celly story on Medium and to commission the explainer video.

| File | Contents |
|---|---|
| `medium-article.md` | Canonical clean markdown (headings, tables, code blocks, blockquote) — the source of truth |
| `medium-article-mcp-v3.md` | MCP-safe variant actually published as the live draft (bold section titles, tables, no code fences) |
| `medium-article-mcp-safe.md` | First MCP attempt (bullet lists) — dropped by the converter, superseded by v3 |
| `explainer-video/SCRIPT.md` | 60–90 s explainer script: VO + shot-by-shot direction |
| `explainer-video/PRODUCTION-BRIEF.md` | Full motion brief for the designer: palette, motion spec, storyboard, deliverables, audio |

---

## Medium drafts — current state

Seven drafts exist on `@ulrichtapsoba2009` (the MCP can create drafts but has no update or delete tool, so cleanup is manual in the Medium editor).

| Status | Draft | Note |
|---|---|---|
| **KEEP — review this one** | <https://medium.com/p/4bb007eb54cf/edit> | Complete article: all paragraphs, every table as readable bullets, bold section titles, 4 images. Best automated result |
| Delete | <https://medium.com/p/a4880ff60048/edit> | First attempt: leaked an internal editor note at the top, structure dropped |
| Delete | <https://medium.com/p/0505cbb9d25b/edit> | Bullet-list variant: the converter dropped every bullet list entirely |
| Delete | <https://medium.com/p/fe73e5c7de14/edit> | Converter probe |
| Delete | <https://medium.com/p/62d2a8694c00/edit> | Converter probe |
| Delete | <https://medium.com/p/fa2cb2a694c4/edit> | Converter probe |
| Delete | <https://medium.com/p/ccf4a81079c5/edit> | Converter probe |

To finish the kept draft: open it, select each bold section title line and apply Medium's **Title 2** style for a proper story outline (the MCP's converter cannot emit semantic headings), verify the 4 images landed in the right places, then publish.

## Why the MCP draft differs from the canonical file

The Medium MCP's markdown converter is lossy. Measured behaviour (four probe drafts, verified by reading each draft back):

| Construct | Survives? |
|---|---|
| Paragraphs, bold, italic, links, inline code | Yes |
| Pipe tables | Converted to bullet lists — readable, kept |
| `##` / `###` headings | Dropped |
| `- ` bullet lists | Dropped entirely |
| Code fences | Dropped |
| Blockquotes | Dropped |
| `---` horizontal rules | **Poison** — eats the content that follows them |
| Local images `![alt](F:/abs/path.png)` | Uploaded to Medium's CDN |

So the MCP-safe variant trades semantic headings for guaranteed-visible bold titles, and tables for the bullet lists the converter emits. The canonical `medium-article.md` keeps the full structure for any path that renders markdown properly.

## Publishing paths

1. **Finish the kept draft** (URL above) — fastest; the content and images are already in your account.
2. **Paste `medium-article.md` into a new Medium story** — Medium's editor converts markdown natively (headings, code blocks, tables); upload the 4 images where the markers sit (image map below).
3. **Re-run the MCP** with `medium-article-mcp-v3.md` minus the title lines if a fresh automated draft is ever needed (the recipe is saved in the `medium-mcp-publishing` skill).

Tags for either path: `Web Development`, `Three.js`, `WebGL`, `Education`, `Computer Vision`.

### Image map (in article order)

| Marker in article | File |
|---|---|
| `04-lab.png` — hero, interactive lab | `F:\TKS\BUILD\Celly\docs\screenshots\04-lab.png` |
| `11-two-hands-scale.png` — two-hand gesture | `F:\TKS\BUILD\Celly\docs\screenshots\11-two-hands-scale.png` |
| `05-lab-selected.png` — organelle selected | `F:\TKS\BUILD\Celly\docs\screenshots\05-lab-selected.png` |
| `06-knowledge.png` — knowledge graph | `F:\TKS\BUILD\Celly\docs\screenshots\06-knowledge.png` |

All screenshots are renders of this software (Playwright, synthetic hands) — repo-internal assets, free to publish.

**Before publishing, comply with Medium's disclosure rules:** Medium requires authors to disclose AI-generated content. This article was drafted with AI assistance from the project's own docs (`README.md`, `DECISIONS.md`, `CHANGELOG.md`, `progress.md`, `CREDITS.md`); every number in it traces to a repo file. If you publish it as-is, mark it as AI-assisted in Medium's publishing settings (Settings → Audience / "Show AI-generated content disclosure"), or rewrite the sections you want in your own words.