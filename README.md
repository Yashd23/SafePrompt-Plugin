# SafePrompt - VS Code Security Extension

A comprehensive VS Code extension that provides real-time security vulnerability detection and secure coding assistance using RAG (Retrieval-Augmented Generation) technology.

## Features

### 🔒 Security Vulnerability Detection
- **Hardcoded Secrets**: Detects API keys, passwords, tokens, and credentials
- **Missing Authorization**: Identifies functions lacking proper authorization checks
- **SSRF Vulnerabilities**: Detects Server-Side Request Forgery patterns
- **Outdated Dependencies**: Scans package.json for vulnerable libraries
- **SQL Injection**: Identifies vulnerable database queries
- **XSS Vulnerabilities**: Detects Cross-Site Scripting patterns

### 🤖 AI-Powered Prompt Enhancement
- **RAG Integration**: Uses secure coding knowledge base for context
- **LLM Enhancement**: Generates secure coding prompts via Groq API
- **Local Fallback**: Works offline with intelligent local enhancement
- **Context-Aware**: Analyzes code patterns for relevant security guidance

### ⚡ QuickFix Support
- **Auto-Fix**: One-click fixes for common security issues
- **Environment Variables**: Replace hardcoded secrets with env vars
- **Authorization Templates**: Add security checks to functions
- **URL Validation**: Insert SSRF protection code

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile the extension:
   ```bash
   npm run compile
   ```
4. Press F5 to run the extension in a new Extension Development Host window

## Configuration

### Environment Variables
Create a `.env` file in the project root:
```env
GROQ_API_KEY=your_groq_api_key_here
```

### Secure Coding Knowledge Base
The extension uses two knowledge files:
- `rules/secure_coding_kb.txt` - Comprehensive secure coding guidelines
- `rules/hardcoded-secrets.yml` - Semgrep rules for vulnerability detection

## Usage

### Security Scanning
The extension automatically scans files on save and provides:
- Real-time vulnerability detection
- Inline error highlighting
- QuickFix suggestions
- Detailed security guidance

### Prompt Enhancement
Add comments to your code to get AI-enhanced security prompts:
```javascript
// PROMPT: Write a login function
// ENHANCED_PROMPT: [AI-generated secure implementation guidance]
```

### Supported File Types
- JavaScript (.js)
- TypeScript (.ts)
- JSON (package.json)
- JSX/TSX files

## Security Rules

### Hardcoded Secrets
Detects patterns like:
```javascript
const apiKey = "sk-1234567890abcdef";
const password = 'hardcoded_password';
const config = {
    secret: "api_secret_here"
};
```

### Missing Authorization
Identifies functions without proper auth checks:
```javascript
function getUser(userId) {
    // Missing authorization - will be flagged
    return database.getUser(userId);
}
```

### SSRF Vulnerabilities
Detects user-controlled URLs in HTTP requests:
```javascript
fetch(req.query.url); // Will be flagged
axios.get(req.params.apiUrl); // Will be flagged
```

### Vulnerable Dependencies
Scans package.json for known vulnerabilities:
```json
{
  "dependencies": {
    "lodash": "4.17.5", // CVE-2021-23337
    "axios": "0.21.0"   // CVE-2021-3749
  }
}
```

## Development

### Project Structure
```
src/
├── extension.ts          # Main extension logic
├── test/
│   ├── extension.test.js
│   └── extension.test.ts
rules/
├── secure_coding_kb.txt  # Knowledge base
└── hardcoded-secrets.yml # Semgrep rules
```

### Building
```bash
npm run compile
```

### Testing
```bash
npm test
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Security

This extension is designed to help improve code security. However, it should be used as part of a comprehensive security strategy, not as the only security measure.

## Support

For issues and feature requests, please use the GitHub Issues page.

## Changelog

### v1.0.0
- Initial release
- Hardcoded secrets detection
- Missing authorization detection
- SSRF vulnerability detection
- Dependency vulnerability scanning
- AI-powered prompt enhancement
- QuickFix support