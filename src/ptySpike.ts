import * as vscode from 'vscode';
import * as os from 'os';
import * as pty from 'node-pty';

/**
 * Fase 0 — de-risk. Prova que node-pty (host) + xterm.js (webview) funcionam
 * dentro de uma extensão VS Code: spawna um shell real, faz stream dos bytes
 * pra webview e devolve o que o usuário digita. Se rodar no Extension
 * Development Host, o resto do projeto é UI.
 */
export function openPtySpike(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'privateWizard.spike',
    'PrivateWizard — PTY Spike',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [context.extensionUri] }
  );

  const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
  const child = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd,
    env: process.env as { [key: string]: string }
  });

  child.onData(data => panel.webview.postMessage({ type: 'out', data }));
  child.onExit(({ exitCode }) => panel.webview.postMessage({ type: 'exit', code: exitCode }));

  panel.webview.onDidReceiveMessage(msg => {
    if (msg.type === 'in') child.write(msg.data);
    else if (msg.type === 'resize') child.resize(msg.cols, msg.rows);
  });

  panel.onDidDispose(() => child.kill());

  const xtermJs = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js')
  );
  const xtermCss = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css')
  );

  const nonce = String(Math.random()).slice(2);
  const csp =
    `default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline'; ` +
    `script-src ${panel.webview.cspSource} 'nonce-${nonce}'; font-src ${panel.webview.cspSource};`;

  panel.webview.html = /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${xtermCss}" />
<style>
  html, body { height: 100%; margin: 0; background: #1a1a1c; }
  #term { height: 100vh; padding: 6px; }
</style>
</head>
<body>
<div id="term"></div>
<script nonce="${nonce}" src="${xtermJs}"></script>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const term = new Terminal({ fontFamily: 'monospace', fontSize: 13, cursorBlink: true });
  term.open(document.getElementById('term'));
  term.focus();

  term.onData(d => vscode.postMessage({ type: 'in', data: d }));

  function fit() {
    // ponytail: cálculo de cols/rows na unha; troco por @xterm/addon-fit se virar produção
    const cell = 9, line = 17;
    const cols = Math.max(20, Math.floor((window.innerWidth - 12) / cell));
    const rows = Math.max(6, Math.floor((window.innerHeight - 12) / line));
    term.resize(cols, rows);
    vscode.postMessage({ type: 'resize', cols, rows });
  }
  window.addEventListener('resize', fit);
  fit();

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'out') term.write(m.data);
    else if (m.type === 'exit') term.write('\\r\\n[processo saiu: ' + m.code + ']\\r\\n');
  });
</script>
</body>
</html>`;
}
