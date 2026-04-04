# Contributing to Claude Telemetry

## How to Contribute

### 1. Fork & Branch
- Fork this repository
- Create a branch from `main`: `git checkout -b feat/your-feature`
- Naming: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`

### 2. Develop
- Follow existing code style and design system
- Ensure TypeScript 0 errors: `cd dashboard && npm run build`
- Ensure Python tests pass: `cd agent && pytest`
- No secrets or API keys in code

### 3. Pull Request
- Push to your fork and open PR against `main`
- Fill in the PR template
- Wait for review — PRs require 1 approval before merge

### Accepted
- Bug fixes, new charts/pages, agent improvements, docs, performance

### Not Accepted
- Changes exposing secrets in frontend
- Dependencies with restrictive licenses
- Breaking changes without migration

## Questions?
Open a Discussion or email ryan@ryanbarbosa.com
