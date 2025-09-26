# Contributing to SafePrompt

Thank you for your interest in contributing to SafePrompt! This document provides guidelines and information for contributors.

## Code of Conduct

This project follows a code of conduct that we expect all contributors to adhere to. Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- VS Code
- Git

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/safeprompt.git
   cd safeprompt
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Compile the extension:
   ```bash
   npm run compile
   ```

5. Open the project in VS Code and press F5 to run the extension in a new Extension Development Host window

## Making Changes

### Branch Naming
Use descriptive branch names:
- `feature/description` for new features
- `fix/description` for bug fixes
- `docs/description` for documentation changes
- `refactor/description` for code refactoring

### Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add comments for complex logic
- Maintain consistent indentation (2 spaces)
- Follow the existing code structure

### Testing

Before submitting a pull request:
1. Run the test suite: `npm test`
2. Test the extension manually in VS Code
3. Verify that new features work as expected
4. Ensure no regressions in existing functionality

## Adding New Security Rules

### YAML Rules (Semgrep)
Add new patterns to `rules/hardcoded-secrets.yml`:

```yaml
- id: new-vulnerability
  patterns:
    - pattern: |
        $PATTERN_HERE
  message: "Description of the vulnerability"
  languages: [javascript, typescript]
  severity: WARNING
```

### TypeScript Detection
Add corresponding regex patterns in `src/extension.ts`:

```typescript
const newPatterns = [
    /pattern1/i,
    /pattern2/i
];
```

### QuickFix Support
Add QuickFix handling in the `SecurityCodeActionProvider`:

```typescript
else if (diag.code === 'SafePrompt.new_vulnerability') {
    const fix = new vscode.CodeAction('Fix description', vscode.CodeActionKind.QuickFix);
    // Implementation
}
```

## Adding New Vulnerability Types

1. **Define the vulnerability** in the YAML rules file
2. **Implement detection logic** in TypeScript
3. **Add QuickFix support** for automated fixes
4. **Update documentation** with examples
5. **Add test cases** to verify detection

## Documentation

When adding new features:
- Update the README.md with usage examples
- Add entries to CHANGELOG.md
- Include inline code comments
- Update any relevant documentation files

## Submitting Changes

### Pull Request Process

1. Create a new branch from `main`
2. Make your changes
3. Add tests if applicable
4. Update documentation
5. Commit with a clear message
6. Push to your fork
7. Create a pull request

### Commit Messages

Use clear, descriptive commit messages:
- `feat: add SSRF vulnerability detection`
- `fix: resolve false positive in hardcoded secrets`
- `docs: update README with new features`
- `refactor: improve regex pattern matching`

### Pull Request Template

When creating a pull request, include:
- Description of changes
- Motivation for the change
- Testing performed
- Screenshots (if applicable)
- Breaking changes (if any)

## Reporting Issues

### Bug Reports
When reporting bugs, include:
- VS Code version
- Extension version
- Steps to reproduce
- Expected vs actual behavior
- Error messages or logs

### Feature Requests
For new features, provide:
- Use case description
- Proposed solution
- Alternative solutions considered
- Additional context

## Security

- Do not include sensitive information in issues or PRs
- Report security vulnerabilities privately to maintainers
- Follow responsible disclosure practices

## Questions?

Feel free to ask questions by:
- Opening an issue
- Starting a discussion
- Contacting maintainers

Thank you for contributing to SafePrompt!
