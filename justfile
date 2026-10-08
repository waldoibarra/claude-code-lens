# Print available recipes.
[private]
help:
  @just --list --unsorted

# Install the toolchain, dev dependencies, Claude Code's plugin types and Git hooks.
[group("Setup")]
setup: install-tools install-deps install-types install-hooks

# Install tools with Mise.
[group("Setup")]
[private]
install-tools:
  mise trust
  mise install

# Install JS dev dependencies (TypeScript).
[group("Setup")]
[private]
install-deps:
  bun install --frozen-lockfile

# Have Claude Code write its plugin API types into .claude-plugin/types/ (Git-ignored).
[group("Setup")]
install-types:
  claude --plugin-dir . -p "/lens" > /dev/null

# Install Git hooks.
[group("Setup")]
[private]
install-hooks:
  hk install

# Start Claude Code with this working tree loaded as a plugin (reloads on save).
[group("Development")]
dev:
  claude --plugin-dir .

# Run the plugin's tests against Claude Code's own engine.
[group("Testing")]
test:
  claude plugin test .

# Validate the manifests and hooks module the way Claude Code loads them.
[group("Testing")]
validate:
  claude plugin validate .

# Typecheck the hooks module, contract and tests with tsc.
[group("Testing")]
typecheck:
  @test -d .claude-plugin/types || { echo "Run 'just install-types' first." >&2; exit 1; }
  bunx tsc -p .

# Run every check the Git hooks run.
[group("Testing")]
check: validate typecheck test lint

# Format TypeScript and JSON sources with Prettier.
[group("Linting")]
format:
  bunx prettier --write .

# Lint all.
[group("Linting")]
lint: lint-ec lint-md lint-format

# Use Prettier to check formatting.
[private]
[group("Linting")]
lint-format:
  bunx prettier --check .

# Use editorconfig-checker to lint all files against .editorconfig rules.
[private]
[group("Linting")]
lint-ec:
  ec

# Use markdownlint-cli2 to lint Markdown files.
[private]
[group("Linting")]
lint-md:
  markdownlint-cli2 --config config/.markdownlint-cli2.yaml "**/*.md"

# Use committed to lint a commit message file.
[private]
[group("Linting")]
lint-commit msg_file:
  committed --config config/committed.toml --commit-file {{ msg_file }}
