# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-XX

### Added
- Initial release of SafePrompt VS Code extension
- Hardcoded secrets detection with support for API keys, passwords, tokens, and credentials
- Missing authorization detection for sensitive functions
- SSRF (Server-Side Request Forgery) vulnerability detection
- Dependency vulnerability scanning for package.json files
- AI-powered prompt enhancement using RAG technology
- Groq API integration for LLM-based prompt enhancement
- Local fallback enhancement when API is unavailable
- Comprehensive QuickFix support for all vulnerability types
- Semgrep integration for advanced pattern matching
- Support for JavaScript, TypeScript, and JSON files
- Real-time security scanning on file save
- Inline error highlighting and diagnostics
- Secure coding knowledge base integration
- Context-aware security guidance

### Security Features
- Detects hardcoded secrets in code and package.json
- Identifies functions lacking authorization checks
- Flags SSRF vulnerabilities in HTTP requests
- Scans for outdated and vulnerable dependencies
- Provides secure coding best practices guidance
- Offers one-click fixes for common security issues

### Technical Features
- TypeScript implementation with full type safety
- Efficient regex-based pattern matching
- Performance-optimized scanning (current file only)
- Comprehensive error handling and logging
- Extensible rule system via YAML configuration
- Integration with VS Code's diagnostic and QuickFix systems

### Documentation
- Comprehensive README with usage examples
- Detailed security rule documentation
- Installation and configuration guides
- Contributing guidelines