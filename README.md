# Exerciser for Obsidian

Exerciser is a desktop-only Obsidian plugin for creating, managing, previewing, and copying programming exercises. Exercise projects always live below `content/assets/exercises/` in the repository; because an Obsidian vault opens at `content/`, the plugin uses the fixed vault-relative path `assets/exercises/`.

The plugin works on its own. Root Index Panels can add visual navigation to a Quartz site, but it is not a dependency.

## Create an exercise without writing YAML

Place the editor cursor where the viewer should appear, then run **Exerciser: Create new exercise here…**. The same action is available in the editor context menu.

The five-step workflow collects:

- the exercise name and any number of files;
- pasted file content, manually entered absolute computer paths, or files selected with the operating-system picker;
- per-file line highlights, notes, optional accent colors, and line annotations;
- whether each annotation should be injected as a comment into copied or downloaded source;
- expected-output groups and examples, including terminal, stderr, raw-text, and generated-file output;
- preview-hidden and Quartz-excluded glob patterns;
- the preview size-limit override;
- IDE or compact dropdown layout, initial file, and word wrapping.

Selecting **Create and insert** writes the exercise files and generated `.exercise.yml`, then inserts the fenced `exercise` block at the captured cursor position. Existing exercise folders are never overwritten.

## Other commands

- **Create empty exercise folder…** creates a new folder and default manifest for manual file management.
- **Insert existing exercise viewer…** inserts a viewer for an existing exercise.
- **Add copy destination ignore rule** restores the local destination marker's `.gitignore` rule if it was manually removed.

Rendered viewers support an IDE-style file tree and tabs, an explicit compact dropdown layout, syntax highlighting, line notes, native image/audio/video/PDF previews, expected output, output comparison, and file/exercise downloads.

## Copying an exercise

**Copy exercise** asks for a destination outside the vault and remembers that absolute path in `<vault-config>/exerciser-copy-destination.json`. Its exact ignore rule is added to the vault-root `.gitignore` once. The marker is local state and must not be committed.

Copies:

- include preview-hidden files;
- omit `.exercise.yml`;
- omit files matched by `exclude-from-quartz`;
- inject annotations marked `inject-into-export` as language-appropriate comments;
- offer VS Code for Python-only projects or IntelliJ IDEA for Java-only projects when the launcher is available on `PATH`;
- otherwise offer the operating-system directory action.

The plugin makes no network requests. It reads computer files only when you enter or choose them in the creation workflow, and writes outside the vault only after you choose a copy destination. This is why the plugin is desktop-only.

## Shared authoring contract

The companion Quartz plugin reads the generated contract. A placement block looks like this:

~~~markdown
```exercise
exercise: hello-world
layout: ide
entrypoint: src/Main.java
word-wrap: true
```
~~~

Placement-only settings stay in the fence so one project can appear differently on different notes. Project-owned settings stay in `assets/exercises/<name>/.exercise.yml`; for example:

```yaml
version: 1
files:
  hide-from-preview:
    - instructor-notes/**
  exclude-from-quartz:
    - solutions/**
preview:
  ignore-size-limit: false
outputs:
  - source: src/Main.java
    heading: Expected output
    examples:
      - label: Example 1
        type: normal
        content: |-
          [stdout] Hello
highlights:
  - source: src/Main.java
    ranges:
      - lines: 3-8
        note: Main loop
        accent: "#7c3aed"
annotations:
  - source: src/Main.java
    line: 4
    text: Start here.
    inject-into-export: true
```

Authors normally do not edit either YAML document: the creation workflow generates them.

## Preview size

The root `content/index.md` may define `exercise-preview-size-limit` as a positive byte count or a value such as `25 MB`. Missing, invalid, or malformed values fall back to **50 MB**. A manifest can deliberately bypass the limit for one exercise.

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run check
```

`npm run build` produces the release-only `main.js`. Install `main.js`, `manifest.json`, and `styles.css` in `<vault>/.obsidian/plugins/obsidian-exerciser-plugin/` for manual testing. Tests, including the authoring integration test, remain in this repository.

## License

MIT
