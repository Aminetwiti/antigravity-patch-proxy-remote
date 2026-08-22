# Contributing Guidelines

Thank you for your interest in contributing to **Google Antigravity Custom Model Proxy**! We welcome bug reports, feature requests, documentation improvements, and pull requests.

---

## How to Contribute

### 1. Reporting Bugs
Before opening a new issue, please search existing issues to see if the problem has already been reported.

When creating a bug report, please include:
- Your OS version (Windows, macOS, Linux).
- Antigravity IDE version.
- Exact steps to reproduce the issue.
- Relevant diagnostic logs from `npm run doctor:logs` or `ag-doctor-ui` (ensure API keys are masked).

### 2. Suggesting Enhancements
Feature requests are welcome! Please describe:
- The provider or feature you would like to see added.
- The use case and why it benefits the community.

### 3. Adding a New Translator Module
If you want to add support for a new LLM provider format:
1. Fork the repository and create a feature branch (`git checkout -b feature/my-provider`).
2. Add a translator file under `src/proxy/translators/<provider>.ts`.
3. Implement `mapGeminiTo<Provider>`, `map<Provider>ToGemini`, and `map<Provider>ChunkToGemini`.
4. Register the provider in `PROVIDERS` in `src/constants.ts`.
5. Add unit tests under `src/__tests__/`.
6. Run `npm test` to ensure all tests pass.

---

## Development Setup

```bash
# Clone your fork
git clone https://github.com/<your-username>/antigravity-add-model.git
cd antigravity-add-model

# Install dependencies
npm install

# Build TypeScript source
npm run build

# Run unit test suite
npm test
```

---

## Code Style & Commit Guidelines

- Write clean, type-safe TypeScript code.
- Follow existing code patterns and formatting (`npm run lint` / `prettier`).
- Ensure all existing unit tests pass before opening a Pull Request.
- Keep Pull Requests focused and concise.

---

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project, you agree to abide by its terms.
