# Test fixtures

Files in this folder feed the lib smoke tests under `app/src/lib/__tests__/`.

| File | Owner test | Purpose |
|---|---|---|
| `path-traversal-vectors.ts` | `tauri-fs.test.ts` | Typed array of every input vector from `.tmp/path-traversal-vectors.md`. Each entry says which `tauriFsProvider`/`tauriFsExtras` op to call and whether the lib must reject (with `LibError.code`) or accept. |

Future fixtures (planned, land with their owning tests):
- `valid-backup.v2.json` — minimal `BackupEnvelope` (1 client + 1 signed event + base64 PNG sig). Used by the canonical-flow E2E (#40).
- `corrupt-backup.json` — truncated JSON.
- `wrong-version-backup.json` — `schemaVersion: 999`.
- `malicious-backup.json` — `__proto__`, oversize signature, drive-letter imagePath.
