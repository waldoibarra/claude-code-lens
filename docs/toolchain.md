# Toolchain

mise installs every tool, pinned to `latest` in `mise.toml`. Bun installs the JavaScript dev
dependencies from `package.json`.

| Tool | Role | Config | Installed via |
| --- | --- | --- | --- |
| [mise](https://mise.jdx.dev) | Tool version manager | `mise.toml` | system |
| [Claude Code](https://code.claude.com) | Runs, tests and validates the plugin; writes its API types | `.claude-plugin/` | system |
| [just](https://just.systems) | Task runner | `justfile` | mise |
| [Bun](https://bun.sh) | Installs and runs the dev dependencies | `package.json`, `bun.lock` | mise |
| [TypeScript](https://www.typescriptlang.org) | Typechecker (`just typecheck`) | `tsconfig.json` | Bun |
| [Prettier](https://prettier.io) | Formatter (`just format`, `just lint`) | `.prettierrc.json`, `.prettierignore` | Bun |
| [hk](https://github.com/jdx/hk) | Git hooks manager | `hk.pkl` | mise |
| [pkl](https://pkl-lang.org) | Config language runtime used by hk | | mise |
| [committed](https://github.com/crate-ci/committed) | Commit message linter | `config/committed.toml` | mise |
| [editorconfig-checker](https://editorconfig-checker.github.io) | Checks files against `.editorconfig` | `.editorconfig`, `.editorconfig-checker.json` | mise |
| [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2) | Markdown linter | `config/.markdownlint-cli2.yaml` | mise |

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code writes on
`just install-types`. editorconfig-checker and Prettier skip that generated folder.

## Commit messages

`config/committed.toml` enforces conventional commits (`feat:`, `fix:`, `docs:`, `chore:`) with a
lowercase subject of at most 50 characters and a body wrapped at 72. The subject says what changed,
the body why, and the footer carries breaking changes and references.

## Markdown

`config/.markdownlint-cli2.yaml` allows lines up to 100 characters (tables and code blocks exempt),
`_underscores_` for italics, `**asterisks**` for bold, `-` for list items, and no repeated blank
lines.

Read [Git hooks](/docs/hooks.md) before changing when a check runs.
