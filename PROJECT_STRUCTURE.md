# SafePrompt Project Structure

This document outlines the project structure and file organization for the SafePrompt VS Code extension.

## Root Directory

```
safeprompt/
├── .vscode/                    # VS Code workspace configuration
│   ├── extensions.json         # Recommended extensions
│   ├── launch.json            # Debug configuration
│   ├── settings.json          # Workspace settings
│   └── tasks.json             # Build tasks
├── src/                       # Source code
│   ├── extension.ts           # Main extension logic
│   └── test/                  # Test files
│       ├── extension.test.js  # Compiled test file
│       └── extension.test.ts  # TypeScript test file
├── rules/                     # Security rules and knowledge base
│   ├── secure_coding_kb.txt   # Secure coding knowledge base
│   └── hardcoded-secrets.yml  # Semgrep security rules
├── test/                      # Test cases and examples
│   ├── test-security-detection.js      # Security vulnerability test cases
│   ├── test-vulnerable-package.json    # Vulnerable dependencies test
│   ├── test-secure-package.json        # Secure dependencies test
│   └── test-prompt-enhancement.js      # Prompt enhancement test cases
├── out/                       # Compiled JavaScript (generated)
├── node_modules/              # Dependencies (generated)
├── .gitignore                 # Git ignore rules
├── .eslintrc.js              # ESLint configuration
├── CHANGELOG.md              # Version history
├── CONTRIBUTING.md           # Contribution guidelines
├── LICENSE                   # MIT License
├── package.json              # Extension manifest and dependencies
├── PROJECT_STRUCTURE.md      # This file
├── README.md                 # Project documentation
├── tsconfig.json             # TypeScript configuration
└── vsc-extension-quickstart.md # VS Code extension quickstart guide
```

## Key Files Description

### Core Extension Files
- **`src/extension.ts`**: Main extension logic with security detection, RAG integration, and QuickFix support
- **`package.json`**: Extension manifest with commands, dependencies, and configuration
- **`tsconfig.json`**: TypeScript compilation configuration

### Security Rules
- **`rules/secure_coding_kb.txt`**: Comprehensive secure coding knowledge base for RAG
- **`rules/hardcoded-secrets.yml`**: Semgrep rules for vulnerability detection

### Test Files
- **`test/test-security-detection.js`**: Test cases for all security vulnerability types
- **`test/test-vulnerable-package.json`**: Package.json with known vulnerabilities
- **`test/test-secure-package.json`**: Package.json with secure dependencies
- **`test/test-prompt-enhancement.js`**: Test cases for AI prompt enhancement

### Documentation
- **`README.md`**: Main project documentation with features and usage
- **`CONTRIBUTING.md`**: Guidelines for contributors
- **`CHANGELOG.md`**: Version history and changes
- **`PROJECT_STRUCTURE.md`**: This file explaining project organization

### Configuration Files
- **`.vscode/`**: VS Code workspace configuration for development
- **`.gitignore`**: Git ignore rules for generated files
- **`.eslintrc.js`**: ESLint configuration for code quality

## Development Workflow

1. **Source Code**: Edit files in `src/` directory
2. **Compilation**: Run `npm run compile` to generate JavaScript in `out/`
3. **Testing**: Use test files in `test/` directory
4. **Rules**: Update security rules in `rules/` directory
5. **Documentation**: Update documentation files as needed

## File Naming Conventions

- **Source files**: Use camelCase (e.g., `extension.ts`)
- **Test files**: Use kebab-case with `test-` prefix (e.g., `test-security-detection.js`)
- **Configuration files**: Use dot notation (e.g., `.eslintrc.js`)
- **Documentation files**: Use UPPERCASE (e.g., `README.md`)

## Dependencies

### Production Dependencies
- `dotenv`: Environment variable management
- `groq-sdk`: Groq API integration for LLM
- `node-fetch`: HTTP requests for API calls

### Development Dependencies
- `@types/vscode`: VS Code API types
- `@types/node`: Node.js types
- `typescript`: TypeScript compiler
- `eslint`: Code linting
- `vsce`: VS Code extension packaging

## Build Process

1. **TypeScript Compilation**: `tsc` compiles `.ts` files to `.js` in `out/`
2. **Extension Packaging**: `vsce package` creates `.vsix` file
3. **Testing**: Jest runs test suite
4. **Linting**: ESLint checks code quality

## Security Features

The extension provides comprehensive security detection for:
- Hardcoded secrets (API keys, passwords, tokens)
- Missing authorization checks
- SSRF vulnerabilities
- Outdated/vulnerable dependencies
- SQL injection patterns
- XSS vulnerabilities

Each security feature includes:
- Pattern detection via regex and Semgrep
- QuickFix suggestions for automated fixes
- Detailed error messages with remediation guidance
- Integration with VS Code's diagnostic system
