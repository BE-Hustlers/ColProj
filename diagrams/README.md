# Diagrams

Two views of ColProj, both derived from the source in `www/` rather than from the
pitch deck.

| File | What it is | Size |
|---|---|---|
| [data-flow-level-1.md](data-flow-level-1.md) | Level-1 data flow diagram — source | |
| [architecture.md](architecture.md) | Architecture diagram, plus the trust-boundary inset — source | |
| [data-flow-level-1.png](data-flow-level-1.png) | DFD rendered for the report | 5521 × 1539 |
| [architecture.png](architecture.png) | Architecture rendered for the report | 2352 × 3791 |
| [architecture-runtime-boundary.png](architecture-runtime-boundary.png) | The inset from `architecture.md` on its own | 998 × 344 |

The Markdown files are the source of truth: [Mermaid](https://mermaid.js.org/)
text that GitHub renders inline, so a reviewer can read and diff the diagram in
the pull request. The PNGs are snapshots of exactly that source, produced for
pasting into the report without anyone needing a toolchain.

Regenerate the PNGs after any change to the Markdown. The `--size` flag is not
optional: without it mermaid-cli renders into its default 800 px page and the
image comes out squashed.

```bash
npx -y @mermaid-js/mermaid-cli -i diagrams/data-flow-level-1.md -o /tmp/dfd.png --size 5521 -s 1
npx -y @mermaid-js/mermaid-cli -i diagrams/architecture.md   -o /tmp/arch.png --size 3791 -s 1
```

mermaid-cli appends a diagram index when the input is Markdown, so rename the
outputs: `dfd-1.png` → `data-flow-level-1.png`, `arch-1.png` →
`architecture.png`, `arch-2.png` → `architecture-runtime-boundary.png`.

## How to read the data flow diagram

- **External entities** — teacher, HOD / vice-principal / principal, the handset
  camera or photo library, and an authenticator app for the optional TOTP step.
- **Processes 1.0 to 10.0** — the level-0 bubble "ColProj" split into what the
  app actually does. The number corresponds to the screens a reviewer will see:
  sign in, gate, capture, recognition, review, save, enrol, roster, admin, report.
- **Data stores D1 to D9** — the IndexedDB object stores, plus `kv` for settings.
  All of them are device-local; nothing in this diagram crosses a network.

Two deliberate omissions, both noted at the bottom of the diagram file: the live
capture session is in-memory only and disappears once the roll is saved, and
`localStorage` holds device identity and walkthrough progress that must never
sync or be exported.

## How to read the architecture diagram

Layers run top to bottom: entry point, presentation, core services, recognition,
platform adapters, device-local data. Arrows are dependencies (caller to callee),
not data flow — for data, use the level-1 DFD.

The three points a review is likely to probe:

1. **One interface, three engines.** `detect()` and `embed()` are the whole
   contract. ONNX, simulator and fixture are interchangeable, which is what lets
   the same build demo on a laptop with no weights, on a phone with weights, and
   inside the APK.
2. **Every seam for the ERP is a single function.** `Clock.now()` for server
   time, the password check in `ACTIONS.signin` for Google Workspace SSO,
   `exportAll()` for the record push.
3. **The trust boundary is the handset.** The second diagram in
   [architecture.md](architecture.md) shows it: no server, no network call, and
   the only way data leaves is a file a human chooses to export.

## Keeping these current

The diagrams name real functions and modules. If a screen, a process or a store
changes, update the matching table row and re-export the PNGs in the same pull
request — otherwise the diagram quietly becomes the thing the README warns about
for `dist/colproj.html`, a document that disagrees with the source.
