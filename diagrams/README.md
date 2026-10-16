# Diagrams

Two views of ColProj, both derived from the source in `www/` rather than from the
pitch deck.

| File | Diagram | Answers |
|---|---|---|
| [data-flow-level-1.md](data-flow-level-1.md) | Data flow diagram, level 1 | What data moves, through which process, into which store |
| [architecture.md](architecture.md) | Architecture diagram | How the code is layered, what depends on what, where the seams are |

Both files are Markdown with [Mermaid](https://mermaid.js.org/) diagrams inside.
GitHub renders them directly, so the diagrams stay reviewable in a pull request
rather than going stale as exported images. In VS Code, install a Mermaid
preview extension; to produce pictures for the report:

```bash
npx -y @mermaid-js/mermaid-cli -i diagrams/architecture.md -o diagrams/architecture.svg
```

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
changes, update the matching table row in the same pull request — otherwise the
diagram quietly becomes the thing the README warns about for `dist/colproj.html`,
a document that disagrees with the source.
