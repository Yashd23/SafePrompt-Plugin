"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
var vscode = require("vscode");
var cp = require("child_process");
var path = require("path");
var fs = require("fs");
var groq_sdk_1 = require("groq-sdk");
var dotenv = require("dotenv");
dotenv.config();
var groq = new groq_sdk_1.default({ apiKey: process.env.GROQ_API_KEY });
var diagnosticCollection;
/* --------------------------- Activate / Deactivate --------------------------- */
function activate(context) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('SafePrompt');
    context.subscriptions.push(diagnosticCollection);
    // 1) Monitor document changes for PROMPT annotations
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(function (event) {
        try {
            detectAndEnhancePrompts(event.document);
        }
        catch (e) {
            console.error('Prompt enhance error', e);
        }
    }));
    // 2) Run scan on save
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(function (doc) {
        try {
            if (isJavascriptDoc(doc) || doc.fileName.endsWith("package.json")) {
                runSecurityScan(doc);
            }
        }
        catch (e) {
            console.error('Scan on save error', e);
        }
    }));
    // 3) Manual scan command
    context.subscriptions.push(vscode.commands.registerCommand('SafePrompt.runScan', function () {
        var editor = vscode.window.activeTextEditor;
        if (editor)
            runSecurityScan(editor.document);
        else
            vscode.window.showInformationMessage('Open a JS/TS file to scan.');
    }));
    // 4) CodeAction provider for quick fixes
    var provider = new SecurityCodeActionProvider();
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'json'], provider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
    // Initial scan if an active JS/TS file is open
    var active = vscode.window.activeTextEditor;
    if (active && (isJavascriptDoc(active.document) || active.document.fileName.endsWith("package.json"))) {
        runSecurityScan(active.document);
    }
    console.log('SafePrompt extension activated');
}
function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.clear();
        diagnosticCollection.dispose();
    }
}
/* --------------------------- Prompt detection/enhancement --------------------------- */
function detectAndEnhancePrompts(document) {
    var text = document.getText();
    var lines = text.split(/\r?\n/);
    var edit = new vscode.WorkspaceEdit();
    var madeEdit = false;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var m = line.match(/^\s*\/\/\s*PROMPT\s*:\s*(.+)$/i);
        if (m) {
            var userPrompt = m[1].trim();
            var nextLine = lines[i + 1] || '';
            if (!nextLine.match(/^\s*\/\/\s*ENHANCED_PROMPT\s*:/i)) {
                var enhanced = enhancePromptText(userPrompt);
                var insertion = "// ENHANCED_PROMPT: ".concat(enhanced);
                var pos = new vscode.Position(i + 1, 0);
                edit.insert(document.uri, pos, insertion + '\n');
                madeEdit = true;
            }
        }
    }
    if (madeEdit) {
        vscode.workspace.applyEdit(edit).then(function () {
            vscode.window.showInformationMessage('SafePrompt: Enhanced prompt(s) inserted.');
        });
    }
}
function enhancePromptText(prompt) {
    var kbPath = path.join(__dirname, "secure_coding_kb.txt");
    var kbContent = "";
    try {
        kbContent = fs.readFileSync(kbPath, "utf8");
    }
    catch (err) {
        console.warn("Knowledge base not found, using default fallback");
    }
    var enhanced = prompt;
    if (kbContent) {
        if (/login|auth/i.test(prompt)) {
            var authGuidelines = extractSection(kbContent, "Missing Authorization Checks");
            enhanced += ", ensure security: ".concat(authGuidelines);
        }
        else if (/api|key|secret|token/i.test(prompt)) {
            var secretGuidelines = extractSection(kbContent, "Hardcoded Secrets");
            enhanced += ", ensure security: ".concat(secretGuidelines);
        }
        else {
            var genericGuidelines = extractSection(kbContent, "Additional Secure Coding Guidelines");
            enhanced += ", follow security best practices: ".concat(genericGuidelines);
        }
    }
    else {
        enhanced += ", include input validation, role-based authorization, avoid hardcoded secrets";
    }
    if (!enhanced.toLowerCase().includes("no hardcoded")) {
        enhanced += ", do not include hardcoded API keys or secrets";
    }
    return enhanced;
}
function extractSection(content, section) {
    var regex = new RegExp("##\\s+".concat(section, "[\\s\\S]*?(?=##|$)"), "i");
    var match = content.match(regex);
    return match ? match[0].replace(/\n/g, " ").slice(0, 250) + "..." : "";
}
/* --------------------------- Security Scan --------------------------- */
function isJavascriptDoc(document) {
    return ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(document.languageId);
}
function runSecurityScan(document) {
    if (!diagnosticCollection)
        return;
    diagnosticCollection.delete(document.uri);
    if (document.fileName.endsWith("package.json")) {
        scanDependencies(document);
        return;
    }
    var filePath = document.fileName;
    var extFolder = vscode.workspace.getWorkspaceFolder(document.uri)
        ? vscode.workspace.getWorkspaceFolder(document.uri).uri.fsPath
        : path.dirname(filePath);
    var rulesPath = path.join(extFolder, 'semgrep_rules', 'rules.yml');
    cp.exec('semgrep --version', function (err) {
        if (err) {
            console.warn('Semgrep not found, falling back to regex scanning.');
            diagnosticCollection.set(document.uri, findIssuesWithRegex(document));
            return;
        }
        var cmd = "semgrep --json --config ".concat(quote(rulesPath), " ").concat(quote(filePath));
        cp.exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, function (err2, stdout) {
            if (err2 && !stdout) {
                console.error('Semgrep run error:', err2);
                diagnosticCollection.set(document.uri, findIssuesWithRegex(document));
                return;
            }
            try {
                var data = JSON.parse(stdout);
                var semgrepDiags = semgrepJsonToDiagnostics(data, document);
                var regexDiags = findIssuesWithRegex(document);
                diagnosticCollection.set(document.uri, semgrepDiags.concat(regexDiags));
            }
            catch (e) {
                console.error('Error parsing semgrep output, fallback to regex', e);
                diagnosticCollection.set(document.uri, findIssuesWithRegex(document));
            }
        });
    });
}
function quote(s) {
    if (!s)
        return s;
    if (s.includes(' '))
        return "\"".concat(s, "\"");
    return s;
}
function semgrepJsonToDiagnostics(data, document) {
    var diags = [];
    if (!data || !Array.isArray(data.results))
        return diags;
    for (var _i = 0, _a = data.results; _i < _a.length; _i++) {
        var r = _a[_i];
        try {
            var start = r.start || (r.extra && r.extra.start);
            var end = r.end || (r.extra && r.extra.end);
            var message = (r.extra && r.extra.message) || r.check_id || r.message || 'Security issue';
            if (start && end) {
                var range = new vscode.Range(start.line - 1, Math.max(0, (start.col || 1) - 1), end.line - 1, Math.max(0, (end.col || 1) - 1));
                var diag = new vscode.Diagnostic(range, "[Semgrep] ".concat(message, " (OWASP A01, CWE-798)"), vscode.DiagnosticSeverity.Warning);
                diag.code = r.check_id || "SafePrompt.security_issue";
                diags.push(diag);
            }
        }
        catch (e) {
            console.error('Error converting semgrep result', e);
        }
    }
    return diags;
}
/* --------------------------- Fallback Regex Scanner --------------------------- */
function findIssuesWithRegex(document) {
    var diagnostics = [];
    var lines = document.getText().split(/\r?\n/);
    // Hardcoded secret
    var secretRegex = /(api[_-]?key|apikey|secret|token)\s*[:=]\s*['"`]([^'"`]+)['"`]/i;
    lines.forEach(function (line, i) {
        var m = line.match(secretRegex);
        if (m) {
            var startCol = line.indexOf('"') >= 0 ? line.indexOf('"') : 0;
            var range = new vscode.Range(i, startCol, i, line.length);
            var diag = new vscode.Diagnostic(range, 'Hardcoded secret detected. Consider using environment variables. (CWE-798)', vscode.DiagnosticSeverity.Warning);
            diag.code = 'SafePrompt.hardcoded_secret';
            diagnostics.push(diag);
        }
    });
    // Missing auth
    var funcRegex = /(function\s+([a-zA-Z0-9_]+)\s*\(|const\s+([a-zA-Z0-9_]+)\s*=\s*\(.*\)\s*=>)/i;
    lines.forEach(function (line, i) {
        var m = line.match(funcRegex);
        if (m) {
            var name_1 = m[2] || m[3] || '';
            if (/login|auth|getuser/i.test(name_1)) {
                var hasAuth = false;
                for (var j = i; j < Math.min(lines.length, i + 8); j++) {
                    if (/role|authorize|auth|req.user|hasRole/i.test(lines[j])) {
                        hasAuth = true;
                        break;
                    }
                }
                if (!hasAuth) {
                    var range = new vscode.Range(i, 0, i, line.length);
                    var diag = new vscode.Diagnostic(range, "Possible missing authorization check in function \"".concat(name_1, "\". (OWASP A01)"), vscode.DiagnosticSeverity.Warning);
                    diag.code = 'SafePrompt.missing_auth';
                    diagnostics.push(diag);
                }
            }
        }
    });
    return diagnostics;
}
/* --------------------------- Dependency Scanner --------------------------- */
function scanDependencies(document) {
    try {
        var pkg = JSON.parse(document.getText());
        var diags = [];
        if (pkg.dependencies) {
            for (var _i = 0, _a = Object.entries(pkg.dependencies); _i < _a.length; _i++) {
                var _b = _a[_i], dep = _b[0], version = _b[1];
                if (/express/i.test(dep) && /^3/.test(version)) {
                    var range = new vscode.Range(0, 0, 0, 0);
                    var diag = new vscode.Diagnostic(range, "Dependency \"".concat(dep, "\" is outdated (v").concat(version, "). Update to a secure version."), vscode.DiagnosticSeverity.Warning);
                    diag.code = "SafePrompt.outdated_dep";
                    diags.push(diag);
                }
            }
        }
        diagnosticCollection.set(document.uri, diags);
    }
    catch (e) {
        console.error("Dependency scan failed", e);
    }
}
/* --------------------------- Quick-fix Provider --------------------------- */
var SecurityCodeActionProvider = /** @class */ (function () {
    function SecurityCodeActionProvider() {
    }
    SecurityCodeActionProvider.prototype.provideCodeActions = function (document, range, context) {
        var actions = [];
        for (var _i = 0, _a = context.diagnostics; _i < _a.length; _i++) {
            var diag = _a[_i];
            // Hardcoded secret fix
            if (diag.code === 'SafePrompt.hardcoded_secret') {
                var title = 'Replace literal with process.env reference';
                var fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                var line = document.lineAt(range.start.line).text;
                var envName = 'SECRET';
                var secretMatch = line.match(/(api[_-]?key|apikey|secret|token)/i);
                if (secretMatch) {
                    envName = secretMatch[1].toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                }
                var quoteIdx = line.indexOf('"') >= 0 ? line.indexOf('"') : 0;
                var fixRange = new vscode.Range(range.start.line, quoteIdx, range.start.line, line.length);
                var edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, fixRange, "process.env.".concat(envName));
                fix.edit = edit;
                fix.command = { command: 'SafePrompt.runScan', title: 'Rescan (SafePrompt)' };
                actions.push(fix);
            }
            // Missing authorization fix
            if (diag.code === 'SafePrompt.missing_auth') {
                var title = 'Insert role-based authorization check';
                var fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                var edit = new vscode.WorkspaceEdit();
                edit.insert(document.uri, new vscode.Position(range.start.line + 1, 0), "if (!req.user || req.user.role !== 'admin') return res.status(403).send('Forbidden');\n");
                fix.edit = edit;
                fix.command = { command: 'SafePrompt.runScan', title: 'Rescan (SafePrompt)' };
                actions.push(fix);
            }
            // Outdated dependency fix
            if (diag.code === 'SafePrompt.outdated_dep') {
                var title = 'Update dependency to latest version';
                var fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
                fix.diagnostics = [diag];
                fix.command = {
                    command: 'SafePrompt.showDepUpdate',
                    title: 'Run: npm install <dep>@latest'
                };
                actions.push(fix);
            }
        }
        return actions;
    };
    return SecurityCodeActionProvider;
}());
