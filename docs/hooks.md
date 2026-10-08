# Git hooks

hk runs these checks from `hk.pkl`. `just setup` installs the hooks; `just check` runs the same
checks by hand.

## Pre-commit

| Step | Runs when staged files match | Command |
| --- | --- | --- |
| editorconfig-checker | any file | `just lint-ec` |
| markdownlint-cli2 | `**/*.md`, `config/.markdownlint-cli2.yaml` | `just lint-md` |
| prettier | `**/*.ts`, `**/*.tsx`, `**/*.json`, `.prettierrc.json` | `just lint-format` |
| validate | `.claude-plugin/*.json`, `hooks/**`, `types/**` | `just validate` |
| typecheck | `hooks/**`, `types/**`, `tests/**`, `tsconfig.json`, `package.json`, `bun.lock` | `just typecheck` |
| test | `hooks/**`, `types/**`, `tests/**` | `just test` |

## Commit message

| Step | Command |
| --- | --- |
| committed | `just lint-commit <message file>` |

## CI

GitHub Actions runs the lints on every push to `main` and every pull request
(`.github/workflows/lint.yml`). It runs `just validate` and `just test` when plugin files change
(`.github/workflows/plugin-checks.yml`). CI does not typecheck, because the plugin types come from
a local Claude Code install.
