# Obsidian Exerciser plugin

## Purpose

- Own the desktop Obsidian authoring and preview experience for projects under the fixed vault-relative root `assets/exercises/` (`content/assets/exercises/` in the repository).

## Contracts

- Keep `manifest.json` ID `exerciser` stable and `isDesktopOnly: true`.
- Implement only the declared `exercise-fence/v1`, `exercise-manifest/v1`, and `exercise-preview-limit/v1` contracts from `obsidian-material-plugins/plugin-contracts`. Reject unsupported manifest versions instead of silently interpreting them as version 1.
- Keep `src/main.ts` focused on lifecycle and command registration; put file, copy, parser, and UI behavior in dedicated modules.
- The **Create new exercise here…** command and editor context-menu item must generate files, `.exercise.yml`, and the fenced `exercise` block without requiring hand-written YAML.
- Never overwrite an existing exercise or accept absolute/traversing paths inside an exercise.
- Exercise names are one directory segment: the first character may be alphanumeric or `_`, the rest may also contain `.`, `_`, or `-`; keep leading dots and all path separators invalid.
- Missing or malformed `exercise-preview-size-limit` in root `index.md` falls back to 50 MB.
- `.exercise.yml` is authoring metadata: never preview it or include it in copied projects.
- `exclude-from-quartz` is also omitted from external copies; `hide-from-preview` is still copied.
- Store the remembered external destination below `Vault.configDir`, add only its exact `.gitignore` rule, and never persist it in normal plugin data.
- External filesystem reads and writes require the user's explicit file/directory selection. Do not add network access or telemetry.
- Root Index Panels is optional and must never be imported or required.
- Keep plugin unit and integration tests in this repository.
- Do not commit `main.js`; release automation builds it from source.

## Verification

- Run `npm run check`.
- For release/manual host verification, install `main.js`, `manifest.json`, and `styles.css` in an Obsidian desktop vault.
