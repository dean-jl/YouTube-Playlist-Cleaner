# Styles & Conventions

## TypeScript Best Practices
- Strict type checking enabled (`strict: true` in `tsconfig.json`).
- Prefer descriptive interfaces and types for DOM elements and payload objects.
- Write JSDoc docstrings for every function, documenting parameters, return values, and side-effects.
- Use language-appropriate conventions (camelCase for variables/functions, PascalCase for interfaces/types, UPPER_SNAKE_CASE for constants).

## Chrome Extension Guidelines
- Use Manifest V3 standard APIs (`chrome.scripting`, `chrome.tabs`, `chrome.runtime`).
- Protect against double-injection in content scripts using global guards.
- Clean up any injected styles or DOM overlays on completion, error, or cancellation.
