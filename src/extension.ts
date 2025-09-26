import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';


// Load environment variables from .env at workspace root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
    vscode.window.showErrorMessage('SafePrompt: GROQ_API_KEY is missing in .env. Please add it.');
    console.error('SafePrompt: GROQ_API_KEY is missing in .env');
}

// Remove Groq SDK — we will call the REST API directly
// const groq = new Groq({ apiKey: GROQ_API_KEY || '' }); // ❌ remove this

let diagnosticCollection: vscode.DiagnosticCollection | undefined;

// Load RAG KB
let secureCodingKB = '';
let hardcodedSecretsYml = '';
try {
    const kbPath = path.join(__dirname, '..', 'rules', 'secure_coding_kb.txt');
    secureCodingKB = fs.readFileSync(kbPath, 'utf8');
    console.log('SafePrompt: loaded secure_coding_kb.txt, length:', secureCodingKB.length);
} catch (err) {
    console.warn('SafePrompt: secure_coding_kb.txt not found in rules/, continuing without KB');
}

try {
    const ymlPath = path.join(__dirname, '..', 'rules', 'hardcoded-secrets.yml');
    hardcodedSecretsYml = fs.readFileSync(ymlPath, 'utf8');
    console.log('SafePrompt: loaded hardcoded-secrets.yml, length:', hardcodedSecretsYml.length);
} catch (err) {
    console.warn('SafePrompt: hardcoded-secrets.yml not found in rules/, continuing without YAML');
}


/* ------------------- Activate / Deactivate ------------------- */
export function activate(context: vscode.ExtensionContext) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('SafePrompt');
    context.subscriptions.push(diagnosticCollection);

    // Auto scan on document save (works with autosave)
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            try {
                if (isJavascriptDoc(doc) || doc.fileName.endsWith('package.json')) {
                    runSecurityScan(doc);
                }
            } catch (e) {
                console.error('Scan on save error', e);
            }
        })
    );

    // Enhance prompts on document change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            try {
                detectAndEnhancePrompts(event.document);
            } catch (e) {
                console.error('Prompt enhancement error', e);
            }
        })
    );

    // Manual scan command
    context.subscriptions.push(
        vscode.commands.registerCommand('safePrompt.runScan', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) runSecurityScan(editor.document);
            else vscode.window.showInformationMessage('Open a JS/TS file to scan.');
        })
    );

    // QuickFix provider
    const provider = new SecurityCodeActionProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'json'],
            provider,
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        )
    );

    // Initial scan for active file
    const active = vscode.window.activeTextEditor;
    if (active && (isJavascriptDoc(active.document) || active.document.fileName.endsWith('package.json'))) {
        runSecurityScan(active.document);
    }

    console.log('SafePrompt extension activated');
}

export function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.clear();
        diagnosticCollection.dispose();
    }
}
/* --------------------------- Prompt detection/enhancement --------------------------- */
export async function detectAndEnhancePrompts(document: vscode.TextDocument) {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const edit = new vscode.WorkspaceEdit();
    let madeEdit = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^\s*\/\/\s*PROMPT\s*:\s*(.+)$/i);
        if (m) {
            const userPrompt = m[1].trim();
            const nextLine = lines[i + 1] || '';

            // Skip if ENHANCED_PROMPT already exists
            if (!nextLine.match(/^\s*\/\/\s*ENHANCED_PROMPT\s*:/i)) {
                try {
                    // Call the LLM-enhanced prompt via Groq REST
                    const enhanced = await generateEnhancedPrompt(userPrompt);

                    // Insert the enhanced prompt in the next line
                    const insertion = `// ENHANCED_PROMPT: ${enhanced}`;
                    edit.insert(document.uri, new vscode.Position(i + 1, 0), insertion + '\n');
                    madeEdit = true;
                } catch (err) {
                    console.error('SafePrompt: Failed to generate enhanced prompt', err);
                }
            }
        }
    }

if (madeEdit) {
    vscode.workspace.applyEdit(edit).then(
        (applied) => {
            if (applied) {
                vscode.window.showInformationMessage('SafePrompt: Enhanced prompt(s) inserted via LLM.');
            } else {
                console.error('SafePrompt: Edit was not applied.');
            }
        },
        (err) => {
            console.error('SafePrompt: Failed to apply edits', err);
        }
    );
}

}

/*--------------------------------------------------------------------------*/ 

/* --------------------------- LLM Enhanced Prompt (with RAG) --------------------------- */
async function generateEnhancedPrompt(userPrompt: string): Promise<string> {
    if (!GROQ_API_KEY) return userPrompt + ' (API key missing)';

    // Build a small RAG context from local rule files
    const ragContext = buildRagContext(userPrompt);
    
    // System Instruction to guide the model's behavior
    const systemInstruction = `
        You are a secure coding assistant acting as a rules-grounded prompt enhancer.
        Use ONLY the provided Security Reference Excerpts to inject concrete, actionable
        security requirements into the developer's prompt, so that any downstream LLM
        will generate code that follows these rules.

        Required outcomes for the enhanced prompt:
        - Enforce input validation and output encoding where relevant.
        - Prohibit hardcoded credentials; require use of environment variables or secret managers.
        - Require parameterized queries and safe crypto primitives where applicable.
        - Require explicit authentication and authorization checks for sensitive operations.
        - Prefer maintained, non-deprecated libraries and safe defaults.
        - Avoid logging secrets or sensitive PII.

        Output requirements:
        - Return ONE concise natural-language instruction paragraph suitable as a system/user prompt
          for another LLM. No code blocks, no lists, no extra commentary.
        - Do not invent rules beyond the provided excerpts; ground your guidance in them.
    `;

    // Combine user prompt and RAG context (if available)
    const fullUserContent = `Developer Prompt: "${userPrompt}"\n\nSecurity Reference Excerpts:\n${ragContext}`;


    try {
        const res = await fetch('https://api.groq.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant', // Use a known working Groq model
                messages: [
                    { role: "system", content: systemInstruction.trim() },
                    { role: "user", content: fullUserContent.trim() }
                ],
                max_tokens: 300,
                temperature: 0.2
            })
        });

        const data = await res.json();
        console.log('Groq API raw response:', data); // IMPORTANT: Check this in the console

        // --- CORRECTED RESPONSE EXTRACTION ---
        if (res.status !== 200) {
            console.error('Groq API returned an error status:', res.status, data);
            // Fallback to local enhancement if API fails
            return generateLocalEnhancedPrompt(userPrompt);
        }
        
        // Standard Groq/OpenAI chat completion extraction
        if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
            const content = data.choices[0].message.content.trim();
            console.log('SafePrompt: Successfully extracted enhanced prompt.');
            return content.replace(/^(["'`\s]*)/, '').replace(/(["'`\s]*)$/, '').trim(); // Clean up potential quotes
        } 
        // --- END CORRECTED EXTRACTION ---

        // Fallback if structure is unexpected
        console.warn('SafePrompt: Unexpected API response structure, falling back to local enhancement');
        return generateLocalEnhancedPrompt(userPrompt);

    } catch (err) {
        console.error('SafePrompt: Groq API call failed', err);
        // Fallback to local enhancement on any error
        return generateLocalEnhancedPrompt(userPrompt);
    }
}

// Local fallback enhancement when API fails
function generateLocalEnhancedPrompt(userPrompt: string): string {
    const ragContext = buildRagContext(userPrompt);
    
    // Build a comprehensive local enhancement based on the prompt content
    let enhanced = userPrompt;
    
    // Add security requirements based on prompt analysis
    const p = userPrompt.toLowerCase();
    
    if (p.includes('login') || p.includes('auth') || p.includes('password')) {
        enhanced += '. Ensure secure authentication with proper password hashing (bcrypt), input validation, rate limiting, and no hardcoded credentials. Use environment variables for secrets and implement proper session management.';
    } else if (p.includes('api') || p.includes('endpoint') || p.includes('route')) {
        enhanced += '. Implement proper input validation, output encoding, authentication checks, and use parameterized queries. Never expose sensitive data in responses.';
    } else if (p.includes('database') || p.includes('sql') || p.includes('query')) {
        enhanced += '. Use parameterized queries to prevent SQL injection, implement proper access controls, and validate all inputs. Store sensitive data encrypted.';
    } else if (p.includes('file') || p.includes('upload') || p.includes('download')) {
        enhanced += '. Validate file types and sizes, scan for malware, store files securely outside web root, and implement proper access controls.';
    } else {
        enhanced += '. Follow secure coding practices including input validation, output encoding, proper error handling, and avoid hardcoded secrets.';
    }
    
    // Add RAG context if available
    if (ragContext) {
        enhanced += ` Reference these security guidelines: ${ragContext.substring(0, 500)}...`;
    }
    
    return enhanced;
}

// Simple section extractor for markdown-ish KB files
function extractSection(content: string, sectionHeading: string): string {
    try {
        const re = new RegExp(`(^|\n)##\s+${sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\s\S]*?(?=\n##\s+|$)`, 'i');
        const m = content.match(re);
        return m ? m[0].trim() : '';
    } catch {
        return '';
    }
}

// Build a small RAG context string grounded in our local rule files
function buildRagContext(userPrompt: string): string {
    const parts: string[] = [];

    const p = userPrompt || '';
    const wantsAuth = /(auth|login|role|permission|oauth|jwt)/i.test(p);
    const wantsSecrets = /(secret|api\s*key|apikey|token|credential|password)/i.test(p);
    const wantsDB = /(sql|query|database|postgres|mysql|sqlite)/i.test(p);

    if (secureCodingKB) {
        if (wantsSecrets) {
            parts.push(extractSection(secureCodingKB, 'Hardcoded Secrets'));
        }
        if (wantsAuth) {
            parts.push(extractSection(secureCodingKB, 'Missing Authorization Checks'));
            parts.push(extractSection(secureCodingKB, 'Authentication'));
        }
        if (wantsDB) {
            parts.push(extractSection(secureCodingKB, 'SQL Injection'));
        }
        // Always include generic guidelines as a fallback
        parts.push(extractSection(secureCodingKB, 'Additional Secure Coding Guidelines'));
    }

    if (hardcodedSecretsYml && wantsSecrets) {
        // Include a small trimmed excerpt of the YAML rules for secrets
        parts.push('--- hardcoded-secrets.yml excerpt ---');
        parts.push(hardcodedSecretsYml.substring(0, 1200));
    }

    const joined = parts.filter(Boolean).join('\n\n');
    // Cap total length to stay within context limits
    return joined.substring(0, 3000);
}

/* ------------------- Security Scan ------------------- */
function isJavascriptDoc(doc: vscode.TextDocument) {
    return ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(doc.languageId);
}

function runSecurityScan(document: vscode.TextDocument) {
    if (!diagnosticCollection) return;
    diagnosticCollection.delete(document.uri);

    if (document.fileName.endsWith('package.json')) {
        scanDependencies(document);
        return;
    }

    const filePath = document.fileName;
    const extFolder = vscode.workspace.getWorkspaceFolder(document.uri)
        ? vscode.workspace.getWorkspaceFolder(document.uri)!.uri.fsPath
        : path.dirname(filePath);
    const rulesPath = path.join(extFolder, 'rules', 'rules.yml');

    cp.exec('semgrep --version', err => {
        if (err) {
            console.warn('Semgrep not found, fallback to regex.');
            diagnosticCollection!.set(document.uri, findIssuesWithRegex(document));
            return;
        }

        const cmd = `semgrep --json --config ${quote(rulesPath)} ${quote(filePath)}`;
        cp.exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err2, stdout) => {
            if (err2 && !stdout) {
                console.error('Semgrep run error:', err2);
                diagnosticCollection!.set(document.uri, findIssuesWithRegex(document));
                return;
            }
            try {
                const data = JSON.parse(stdout);
                const semgrepDiags = semgrepJsonToDiagnostics(data, document);
                const regexDiags = findIssuesWithRegex(document);
                diagnosticCollection!.set(document.uri, semgrepDiags.concat(regexDiags));
            } catch (e) {
                console.error('Semgrep parse error, fallback to regex', e);
                diagnosticCollection!.set(document.uri, findIssuesWithRegex(document));
            }
        });
    });
}

function quote(s: string) { return s.includes(' ') ? `"${s}"` : s; }

/* ------------------- Fallback Regex Scanner ------------------- */
function findIssuesWithRegex(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const lines = document.getText().split(/\r?\n/);

    // Check for hardcoded secrets
    const secretRegex = /(api[_-]?key|apikey|secret|token|credential|password|pwd)\s*[:=]\s*['"`]([^'"`]+)['"`]/i;
    lines.forEach((line, i) => {
        const m = line.match(secretRegex);
        if (m) {
            const startCol = line.indexOf('"') >= 0 ? line.indexOf('"') : 0;
            const range = new vscode.Range(i, startCol, i, line.length);
            const diag = new vscode.Diagnostic(range, 'Hardcoded secret detected.', vscode.DiagnosticSeverity.Warning);
            diag.code = 'SafePrompt.hardcoded_secret';
            diagnostics.push(diag);
        }
    });

    // Check for missing authorization in sensitive functions
    const authIssues = findMissingAuthorization(document);
    diagnostics.push(...authIssues);

    // Check for SSRF vulnerabilities
    const ssrfIssues = findSSRFVulnerabilities(document);
    diagnostics.push(...ssrfIssues);

    return diagnostics;
}

// Detect functions that may lack authorization checks
function findMissingAuthorization(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    // Patterns for sensitive functions that should have authorization
    const sensitiveFunctionPatterns = [
        /function\s+(login|authenticate|auth)\s*\(/i,
        /function\s+(getUser|getUserData|getUserInfo|fetchUser)\s*\(/i,
        /function\s+(deleteUser|removeUser|updateUser|modifyUser)\s*\(/i,
        /function\s+(admin|root|superuser)\w*\s*\(/i,
        /function\s+(delete|remove|destroy)\w*\s*\(/i,
        /function\s+(update|modify|edit)\w*\s*\(/i,
        /const\s+(login|authenticate|auth)\s*=\s*\(/i,
        /const\s+(getUser|getUserData|getUserInfo|fetchUser)\s*=\s*\(/i,
        /const\s+(deleteUser|removeUser|updateUser|modifyUser)\s*=\s*\(/i,
        /const\s+(admin|root|superuser)\w*\s*=\s*\(/i,
        /const\s+(delete|remove|destroy)\w*\s*=\s*\(/i,
        /const\s+(update|modify|edit)\w*\s*=\s*\(/i,
        /(login|authenticate|auth)\s*:\s*function/i,
        /(getUser|getUserData|getUserInfo|fetchUser)\s*:\s*function/i,
        /(deleteUser|removeUser|updateUser|modifyUser)\s*:\s*function/i,
        /(admin|root|superuser)\w*\s*:\s*function/i,
        /(delete|remove|destroy)\w*\s*:\s*function/i,
        /(update|modify|edit)\w*\s*:\s*function/i
    ];

    // Authorization check patterns
    const authCheckPatterns = [
        /isAuthenticated/i,
        /isAuthorized/i,
        /hasRole/i,
        /hasPermission/i,
        /checkAuth/i,
        /verifyToken/i,
        /validateUser/i,
        /user\.role/i,
        /req\.user/i,
        /session\.user/i,
        /jwt\.verify/i,
        /auth\.verify/i,
        /middleware.*auth/i,
        /requireAuth/i,
        /requireRole/i,
        /requirePermission/i
    ];

    lines.forEach((line, lineIndex) => {
        // Check if line contains a sensitive function
        for (const pattern of sensitiveFunctionPatterns) {
            const match = line.match(pattern);
            if (match) {
                const functionName = match[1] || match[0].split(/\s+/)[1] || 'function';
                
                // Look for authorization checks in the function body (next 20 lines)
                let hasAuthCheck = false;
                const functionStartLine = lineIndex;
                const searchEndLine = Math.min(lineIndex + 20, lines.length);
                
                for (let i = functionStartLine; i < searchEndLine; i++) {
                    const currentLine = lines[i];
                    
                    // Stop searching if we hit another function definition
                    if (i > functionStartLine && /^\s*(function|const|let|var|class)\s+\w+/.test(currentLine)) {
                        break;
                    }
                    
                    // Check for authorization patterns
                    for (const authPattern of authCheckPatterns) {
                        if (authPattern.test(currentLine)) {
                            hasAuthCheck = true;
                            break;
                        }
                    }
                    
                    if (hasAuthCheck) break;
                }
                
                // If no authorization check found, create diagnostic
                if (!hasAuthCheck) {
                    const range = new vscode.Range(lineIndex, 0, lineIndex, line.length);
                    const diag = new vscode.Diagnostic(
                        range, 
                        `Function '${functionName}' may lack authorization checks. Add role validation.`, 
                        vscode.DiagnosticSeverity.Warning
                    );
                    diag.code = 'SafePrompt.missing_authorization';
                    diagnostics.push(diag);
                }
            }
        }
    });

    return diagnostics;
}

// Detect SSRF vulnerabilities
function findSSRFVulnerabilities(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    // SSRF patterns for HTTP requests with user-controlled URLs
    const ssrfPatterns = [
        // Fetch API patterns
        /fetch\s*\(\s*req\.(query|params|body|headers)\.\w+/i,
        /fetch\s*\(\s*request\.(query|params|body|headers)\.\w+/i,
        /fetch\s*\(\s*req\.(query|params|body|headers)\[['"`]\w+['"`]\]/i,
        
        // Axios patterns
        /axios\.(get|post|put|delete|patch|head|options)\s*\(\s*req\.(query|params|body|headers)\.\w+/i,
        /axios\.(get|post|put|delete|patch|head|options)\s*\(\s*request\.(query|params|body|headers)\.\w+/i,
        /axios\.(get|post|put|delete|patch|head|options)\s*\(\s*req\.(query|params|body|headers)\[['"`]\w+['"`]\]/i,
        
        // Request library patterns
        /request\s*\(\s*req\.(query|params|body|headers)\.\w+/i,
        /request\s*\(\s*request\.(query|params|body|headers)\.\w+/i,
        /request\s*\(\s*req\.(query|params|body|headers)\[['"`]\w+['"`]\]/i,
        
        // HTTP/HTTPS module patterns
        /https?\.(get|post|put|delete|patch|head|options)\s*\(\s*req\.(query|params|body|headers)\.\w+/i,
        /https?\.(get|post|put|delete|patch|head|options)\s*\(\s*request\.(query|params|body|headers)\.\w+/i,
        /https?\.(get|post|put|delete|patch|head|options)\s*\(\s*req\.(query|params|body|headers)\[['"`]\w+['"`]\]/i,
        
        // jQuery patterns
        /\$\.(get|post|ajax)\s*\(\s*req\.(query|params|body|headers)\.\w+/i,
        /\$\.(get|post|ajax)\s*\(\s*request\.(query|params|body|headers)\.\w+/i,
        /\$\.(get|post|ajax)\s*\(\s*req\.(query|params|body|headers)\[['"`]\w+['"`]\]/i,
        /\$\.ajax\s*\(\s*\{[^}]*url\s*:\s*req\.(query|params|body|headers)\.\w+/i,
        
        // XMLHttpRequest patterns
        /XMLHttpRequest\.open\s*\(\s*['"`]\w+['"`]\s*,\s*req\.(query|params|body|headers)\.\w+/i,
        /XMLHttpRequest\.open\s*\(\s*['"`]\w+['"`]\s*,\s*request\.(query|params|body|headers)\.\w+/i,
        /XMLHttpRequest\.open\s*\(\s*['"`]\w+['"`]\s*,\s*req\.(query|params|body|headers)\[['"`]\w+['"`]\]/i,
        /new\s+XMLHttpRequest\s*\(\s*\)\.open\s*\(\s*['"`]\w+['"`]\s*,\s*req\.(query|params|body|headers)\.\w+/i,
        
        // Generic patterns for user-controlled URLs
        /fetch\s*\(\s*[^)]*req\.[^)]*\)/i,
        /axios\.(get|post|put|delete|patch|head|options)\s*\(\s*[^)]*req\.[^)]*\)/i,
        /request\s*\(\s*[^)]*req\.[^)]*\)/i,
        /https?\.(get|post|put|delete|patch|head|options)\s*\(\s*[^)]*req\.[^)]*\)/i,
        /\$\.(get|post|ajax)\s*\(\s*[^)]*req\.[^)]*\)/i
    ];

    lines.forEach((line, lineIndex) => {
        for (const pattern of ssrfPatterns) {
            const match = line.match(pattern);
            if (match) {
                const range = new vscode.Range(lineIndex, 0, lineIndex, line.length);
                const diag = new vscode.Diagnostic(
                    range,
                    'SSRF vulnerability: HTTP request with user-controlled input. Validate URL origin and use allowlist of permitted domains.',
                    vscode.DiagnosticSeverity.Error
                );
                diag.code = 'SafePrompt.ssrf_vulnerability';
                diagnostics.push(diag);
            }
        }
    });

    return diagnostics;
}

/* ------------------- Semgrep Output to Diagnostics ------------------- */
function semgrepJsonToDiagnostics(data: any, document: vscode.TextDocument): vscode.Diagnostic[] {
    const diags: vscode.Diagnostic[] = [];
    if (!data || !Array.isArray(data.results)) return diags;

    for (const r of data.results) {
        try {
            const start = r.start || (r.extra && r.extra.start);
            const end = r.end || (r.extra && r.extra.end);
            const message = (r.extra && r.extra.message) || r.check_id || r.message || 'Security issue';

            if (start && end) {
                const range = new vscode.Range(
                    start.line - 1, Math.max(0, (start.col || 1) - 1),
                    end.line - 1, Math.max(0, (end.col || 1) - 1)
                );
                const diag = new vscode.Diagnostic(range, `[Semgrep] ${message}`, vscode.DiagnosticSeverity.Warning);
                diags.push(diag);
            } else {
                diags.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), `[Semgrep] ${message}`, vscode.DiagnosticSeverity.Warning));
            }
        } catch (e) {
            console.error('Error converting semgrep result', e);
        }
    }

    return diags;
}

/* ------------------- Scan Dependencies ------------------- */
function scanDependencies(document: vscode.TextDocument) {
    const diagnostics: vscode.Diagnostic[] = [];
    try {
        const content = document.getText();
        const json = JSON.parse(content);
        const dependencies = { ...json.dependencies, ...json.devDependencies };
        
        // Check for hardcoded secrets in package.json
        const secretIssues = findSecretsInPackageJson(content);
        diagnostics.push(...secretIssues);
        
        // Check for outdated/vulnerable dependencies
        Object.entries(dependencies).forEach(([pkg, version]) => {
            if (typeof version === 'string') {
                const line = content.split(/\r?\n/).findIndex(l => l.includes(`"${pkg}"`));
                if (line >= 0) {
                    const range = new vscode.Range(line, 0, line, content.split(/\r?\n/)[line].length);
                    
                    // Check for various vulnerability patterns
                    const vulnIssues = checkDependencyVulnerabilities(pkg, version, range);
                    diagnostics.push(...vulnIssues);
                }
            }
        });
        
    } catch (e) {
        console.error('Dependency scan error', e);
    }
    diagnosticCollection?.set(document.uri, diagnostics);
}

// Check for hardcoded secrets in package.json
function findSecretsInPackageJson(content: string): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const lines = content.split(/\r?\n/);
    
    // Patterns for secrets in package.json
    const secretPatterns = [
        /(api[_-]?key|apikey|secret|token|password|pwd|credential)\s*[:=]\s*['"`]([^'"`]+)['"`]/i,
        /['"`]([a-zA-Z0-9]{20,})['"`]/g, // Long strings that might be secrets
        /['"`](sk-[a-zA-Z0-9]{20,})['"`]/g, // OpenAI API keys
        /['"`](pk_[a-zA-Z0-9]{20,})['"`]/g, // Stripe keys
        /['"`]([a-zA-Z0-9]{32,})['"`]/g // Generic long tokens
    ];
    
    lines.forEach((line, i) => {
        for (const pattern of secretPatterns) {
            const matches = line.matchAll(pattern);
            for (const match of matches) {
                const secretValue = match[1] || match[0];
                // Skip if it looks like a normal dependency version or hash
                if (secretValue.length < 20 || /^[\d\.\-\^~]+$/.test(secretValue)) continue;
                
                const startCol = line.indexOf(secretValue);
                const range = new vscode.Range(i, startCol, i, startCol + secretValue.length);
                const diag = new vscode.Diagnostic(range, 'Potential hardcoded secret in package.json', vscode.DiagnosticSeverity.Warning);
                diag.code = 'SafePrompt.package_secret';
                diagnostics.push(diag);
            }
        }
    });
    
    return diagnostics;
}

// Check for vulnerable/outdated dependencies
function checkDependencyVulnerabilities(pkg: string, version: string, range: vscode.Range): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    
    // Known vulnerable packages (simulated database)
    const vulnerablePackages: { [key: string]: { minVersion: string, maxVersion: string, cve: string, description: string } } = {
        'lodash': { minVersion: '4.17.0', maxVersion: '4.17.20', cve: 'CVE-2021-23337', description: 'Command injection vulnerability' },
        'axios': { minVersion: '0.0.0', maxVersion: '0.21.4', cve: 'CVE-2021-3749', description: 'Server-Side Request Forgery' },
        'moment': { minVersion: '0.0.0', maxVersion: '2.29.4', cve: 'CVE-2022-24785', description: 'Regular Expression Denial of Service' },
        'express': { minVersion: '0.0.0', maxVersion: '4.17.3', cve: 'CVE-2022-24999', description: 'Prototype pollution vulnerability' },
        'jquery': { minVersion: '0.0.0', maxVersion: '3.6.0', cve: 'CVE-2021-20083', description: 'Cross-site scripting vulnerability' },
        'react': { minVersion: '0.0.0', maxVersion: '17.0.2', cve: 'CVE-2022-0286', description: 'Cross-site scripting vulnerability' },
        'vue': { minVersion: '0.0.0', maxVersion: '2.6.14', cve: 'CVE-2021-32694', description: 'Cross-site scripting vulnerability' },
        'angular': { minVersion: '0.0.0', maxVersion: '13.3.0', cve: 'CVE-2022-25844', description: 'Cross-site scripting vulnerability' }
    };
    
    // Check for outdated versions (simplified version comparison)
    if (isOutdatedVersion(version)) {
        const diag = new vscode.Diagnostic(range, `Dependency "${pkg}" version "${version}" may be outdated`, vscode.DiagnosticSeverity.Warning);
        diag.code = 'SafePrompt.outdated_dependency';
        diagnostics.push(diag);
    }
    
    // Check for known vulnerabilities
    if (vulnerablePackages[pkg]) {
        const vuln = vulnerablePackages[pkg];
        if (isVersionVulnerable(version, vuln.minVersion, vuln.maxVersion)) {
            const diag = new vscode.Diagnostic(range, 
                `Dependency "${pkg}" version "${version}" has known vulnerability: ${vuln.description} (${vuln.cve})`, 
                vscode.DiagnosticSeverity.Error);
            diag.code = 'SafePrompt.vulnerable_dependency';
            diagnostics.push(diag);
        }
    }
    
    // Check for development dependencies in production
    if (pkg.startsWith('@types/') || pkg.includes('typescript') || pkg.includes('eslint') || pkg.includes('prettier')) {
        const diag = new vscode.Diagnostic(range, 
            `Development dependency "${pkg}" should not be in production dependencies`, 
            vscode.DiagnosticSeverity.Warning);
        diag.code = 'SafePrompt.dev_dependency_in_prod';
        diagnostics.push(diag);
    }
    
    return diagnostics;
}

// Simple version comparison (basic implementation)
function isOutdatedVersion(version: string): boolean {
    // Remove common prefixes
    const cleanVersion = version.replace(/^[\^~]/, '');
    
    // Check for very old version patterns
    if (cleanVersion.startsWith('0.0.0') || cleanVersion.startsWith('0.1.') || cleanVersion.startsWith('0.2.')) {
        return true;
    }
    
    // Check for major version 0 (unstable)
    if (cleanVersion.startsWith('0.') && !cleanVersion.startsWith('0.0.')) {
        return true;
    }
    
    return false;
}

// Check if version is within vulnerable range
function isVersionVulnerable(version: string, minVuln: string, maxVuln: string): boolean {
    const cleanVersion = version.replace(/^[\^~]/, '');
    
    // Simple version comparison (this is a basic implementation)
    // In a real scenario, you'd use a proper semver library
    const versionParts = cleanVersion.split('.').map(Number);
    const minParts = minVuln.split('.').map(Number);
    const maxParts = maxVuln.split('.').map(Number);
    
    // Check if version is between min and max vulnerable versions
    for (let i = 0; i < Math.max(versionParts.length, minParts.length, maxParts.length); i++) {
        const v = versionParts[i] || 0;
        const min = minParts[i] || 0;
        const max = maxParts[i] || 0;
        
        if (v < min) return false; // Version is too old
        if (v > max) return false; // Version is too new
        if (v > min && v < max) return true; // Version is in vulnerable range
    }
    
    return false;
}

/* ------------------- QuickFix Provider ------------------- */
class SecurityCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diag of context.diagnostics) {
            if (diag.code === 'SafePrompt.hardcoded_secret') {
                const fix = new vscode.CodeAction('Replace with process.env', vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                const line = document.lineAt(range.start.line).text;
                let envName = 'SECRET';
                const match = line.match(/(api[_-]?key|apikey|secret|token)/i);
                if (match) envName = match[1].toUpperCase().replace(/[^A-Z0-9_]/g, '_');

                const quoteIdx = line.indexOf('"') >= 0 ? line.indexOf('"') : 0;
                const fixRange = new vscode.Range(range.start.line, quoteIdx, range.start.line, line.length);
                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, fixRange, `process.env.${envName}`);
                fix.edit = edit;
                fix.command = { command: 'safePrompt.runScan', title: 'Rescan' };
                actions.push(fix);
            } else if (diag.code === 'SafePrompt.missing_authorization') {
                const fix = new vscode.CodeAction('Add authorization check', vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                const line = document.lineAt(range.start.line).text;
                
                // Extract function name
                const functionMatch = line.match(/(?:function|const|let|var)\s+(\w+)/);
                const functionName = functionMatch ? functionMatch[1] : 'function';
                
                // Add authorization check after the function declaration
                const edit = new vscode.WorkspaceEdit();
                const insertPosition = new vscode.Position(range.start.line + 1, 0);
                const authCheck = `    // TODO: Add authorization check\n    if (!req.user || !req.user.isAuthenticated) {\n        return res.status(401).json({ error: 'Unauthorized' });\n    }\n`;
                edit.insert(document.uri, insertPosition, authCheck);
                fix.edit = edit;
                fix.command = { command: 'safePrompt.runScan', title: 'Rescan' };
                actions.push(fix);
            } else if (diag.code === 'SafePrompt.outdated_dependency') {
                const fix = new vscode.CodeAction('Update to latest version', vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                const line = document.lineAt(range.start.line).text;
                
                // Extract package name and suggest latest version
                const packageMatch = line.match(/"([^"]+)":\s*"([^"]+)"/);
                if (packageMatch) {
                    const pkgName = packageMatch[1];
                    const edit = new vscode.WorkspaceEdit();
                    const newVersion = `"${pkgName}": "^latest"`;
                    const fixRange = new vscode.Range(range.start.line, 0, range.start.line, line.length);
                    edit.replace(document.uri, fixRange, newVersion);
                    fix.edit = edit;
                    fix.command = { command: 'safePrompt.runScan', title: 'Rescan' };
                    actions.push(fix);
                }
            } else if (diag.code === 'SafePrompt.vulnerable_dependency') {
                const fix = new vscode.CodeAction('Update to secure version', vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                const line = document.lineAt(range.start.line).text;
                
                // Extract package name and suggest secure version
                const packageMatch = line.match(/"([^"]+)":\s*"([^"]+)"/);
                if (packageMatch) {
                    const pkgName = packageMatch[1];
                    const edit = new vscode.WorkspaceEdit();
                    const newVersion = `"${pkgName}": "^latest"`;
                    const fixRange = new vscode.Range(range.start.line, 0, range.start.line, line.length);
                    edit.replace(document.uri, fixRange, newVersion);
                    fix.edit = edit;
                    fix.command = { command: 'safePrompt.runScan', title: 'Rescan' };
                    actions.push(fix);
                }
            } else if (diag.code === 'SafePrompt.dev_dependency_in_prod') {
                const fix = new vscode.CodeAction('Move to devDependencies', vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                const line = document.lineAt(range.start.line).text;
                
                // Extract package name and move to devDependencies
                const packageMatch = line.match(/"([^"]+)":\s*"([^"]+)"/);
                if (packageMatch) {
                    const pkgName = packageMatch[1];
                    const pkgVersion = packageMatch[2];
                    const edit = new vscode.WorkspaceEdit();
                    
                    // Remove from dependencies
                    edit.delete(document.uri, range);
                    
                    // Add to devDependencies (find devDependencies section)
                    const content = document.getText();
                    const devDepMatch = content.match(/"devDependencies"\s*:\s*{/);
                    if (devDepMatch) {
                        const insertPos = new vscode.Position(
                            document.positionAt(devDepMatch.index! + devDepMatch[0].length).line,
                            0
                        );
                        edit.insert(document.uri, insertPos, `\n    "${pkgName}": "${pkgVersion}",`);
                    }
                    
                    fix.edit = edit;
                    fix.command = { command: 'safePrompt.runScan', title: 'Rescan' };
                    actions.push(fix);
                }
            } else if (diag.code === 'SafePrompt.package_secret') {
                const fix = new vscode.CodeAction('Replace with environment variable', vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                const line = document.lineAt(range.start.line).text;
                
                // Extract secret and replace with env var
                const secretMatch = line.match(/([^:]+):\s*['"`]([^'"`]+)['"`]/);
                if (secretMatch) {
                    const key = secretMatch[1].trim();
                    const envName = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                    const edit = new vscode.WorkspaceEdit();
                    const newValue = `${key}: process.env.${envName}`;
                    const fixRange = new vscode.Range(range.start.line, 0, range.start.line, line.length);
                    edit.replace(document.uri, fixRange, newValue);
                    fix.edit = edit;
                    fix.command = { command: 'safePrompt.runScan', title: 'Rescan' };
                    actions.push(fix);
                }
            } else if (diag.code === 'SafePrompt.ssrf_vulnerability') {
                const fix = new vscode.CodeAction('Add URL validation', vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                const line = document.lineAt(range.start.line).text;
                
                // Add URL validation before the HTTP request
                const edit = new vscode.WorkspaceEdit();
                const insertPosition = new vscode.Position(range.start.line, 0);
                const urlValidation = `    // TODO: Add URL validation to prevent SSRF\n    if (!isValidUrl(url)) {\n        return res.status(400).json({ error: 'Invalid URL' });\n    }\n    `;
                edit.insert(document.uri, insertPosition, urlValidation);
                fix.edit = edit;
                fix.command = { command: 'safePrompt.runScan', title: 'Rescan' };
                actions.push(fix);
            }
        }
        return actions;
    }
}
