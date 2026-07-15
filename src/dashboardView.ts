import * as vscode from 'vscode';

/**
 * Painel enxuto na Activity Bar: atalhos para abrir o Canvas e criar um agent.
 * A orquestração de verdade (terminais, drag, wizard) vive no Canvas
 * (canvasPanel.ts). Aqui só ficam os botões e a lista de agents como atalho.
 */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'privateWizard.dashboard';
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: { config: { project?: string; agents: Array<{ id: string; name: string; role?: string; status?: string; model?: string; cli?: string }> }; onDidChange: vscode.Event<unknown> }
  ) {
    store.onDidChange(() => this.postState());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.html(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(msg => {
      switch (msg.type) {
        case 'ready': this.postState(); break;
        case 'openCanvas': vscode.commands.executeCommand('privateWizard.canvas'); break;
        case 'newAgent': vscode.commands.executeCommand('privateWizard.newAgent'); break;
        case 'run': vscode.commands.executeCommand('privateWizard.agentRun', msg.agentId); break;
        case 'stop': vscode.commands.executeCommand('privateWizard.agentStop', msg.agentId); break;
        case 'kill': vscode.commands.executeCommand('privateWizard.agentKill', msg.agentId); break;
        case 'openConfig': vscode.commands.executeCommand('privateWizard.init').then(() => {
          const folders = vscode.workspace.workspaceFolders;
          if (folders?.length) {
            const rel = vscode.workspace.getConfiguration('privateWizard').get<string>('configPath') ?? '.privatewizard/agents.json';
            vscode.window.showTextDocument(vscode.Uri.joinPath(folders[0].uri, rel));
          }
        }); break;
      }
    });
  }

  refresh(): void { this.postState(); }
  private postState(): void { this.view?.webview.postMessage({ type: 'state', config: this.store.config }); }

  private html(webview: vscode.Webview): string {
    const nonce = String(Math.random()).slice(2);
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 10px; font-size: 12px; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
  button {
    display: flex; align-items: center; justify-content: center; gap: 7px;
    border: none; border-radius: 5px; padding: 8px 10px; cursor: pointer; font-size: 12px; font-weight: 600;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { opacity: 0.92; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); margin: 4px 0 8px; }
  .row {
    display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 4px; cursor: pointer;
  }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .caret { width: 12px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 10px; flex: none; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .dot.running { background: var(--vscode-testing-iconPassed, #2ea043); }
  .dot.idle, .dot.paused, .dot.done, .dot.error { background: var(--vscode-descriptionForeground); }
  .name { font-weight: 600; }
  .role { color: var(--vscode-descriptionForeground); margin-left: auto; font-size: 11px; }
  .detail { padding: 4px 6px 10px 24px; display: none; }
  .detail.open { display: block; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 7px; }
  .meta b { color: var(--vscode-foreground); font-weight: 600; }
  .ctl { display: flex; gap: 6px; flex-wrap: wrap; }
  .ctl button { padding: 3px 9px; font-size: 11px; }
  .ctl button.danger { background: var(--vscode-errorForeground, #e03131); color: #fff; }
  .empty { color: var(--vscode-descriptionForeground); padding: 8px 6px; }
  .footer { margin-top: 12px; }
  .footer a { color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 11px; }
</style>
</head>
<body>
  <div class="actions">
    <button id="openCanvas">◆ Abrir Canvas</button>
    <button id="newAgent" class="secondary">＋ Novo Agente</button>
  </div>
  <h2 id="title">Agents</h2>
  <div id="root"></div>
  <div class="footer"><a id="openConfig">Editar agents.json</a></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const expanded = new Set();   // ids de agents com o painel aberto
  let lastConfig = { agents: [] };
  function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function render(config) {
    lastConfig = config;
    document.getElementById('title').textContent = config.project ? config.project + ' — Agents' : 'Agents';
    const agents = config.agents || [];
    if (!agents.length) {
      root.innerHTML = '<div class="empty">Nenhum agent ainda. Clique em <b>Abrir Canvas</b> e depois em <b>Novo Agente</b>.</div>';
      return;
    }
    root.innerHTML = agents.map(a => {
      const id = esc(a.id), open = expanded.has(a.id);
      return '<div class="row" data-toggle="' + id + '">' +
          '<span class="caret">' + (open ? '▾' : '▸') + '</span>' +
          '<span class="dot ' + esc(a.status || 'idle') + '"></span>' +
          '<span class="name">' + esc(a.name) + '</span>' +
          (a.role ? '<span class="role">' + esc(a.role) + '</span>' : '') +
        '</div>' +
        '<div class="detail ' + (open ? 'open' : '') + '" data-detail="' + id + '">' +
          '<div class="meta">runtime <b>' + esc(a.cli || 'shell') + '</b> · modelo <b>' + esc(a.model || '—') + '</b><br>' +
            'status <b>' + esc(a.status || 'idle') + '</b> · tokens <b>—</b> <span style="opacity:.7">(quando rodar LLM real)</span></div>' +
          '<div class="ctl">' +
            '<button data-run="' + id + '">▷ Iniciar</button>' +
            '<button class="secondary" data-stop="' + id + '">■ Parar</button>' +
            '<button class="danger" data-kill="' + id + '">× Kill</button>' +
          '</div>' +
        '</div>';
    }).join('');

    root.querySelectorAll('[data-toggle]').forEach(el => { el.onclick = () => {
      const k = el.dataset.toggle; expanded.has(k) ? expanded.delete(k) : expanded.add(k); render(lastConfig);
    }; });
    root.querySelectorAll('[data-run]').forEach(el => { el.onclick = e => { e.stopPropagation(); vscode.postMessage({ type: 'run', agentId: el.dataset.run }); }; });
    root.querySelectorAll('[data-stop]').forEach(el => { el.onclick = e => { e.stopPropagation(); vscode.postMessage({ type: 'stop', agentId: el.dataset.stop }); }; });
    root.querySelectorAll('[data-kill]').forEach(el => { el.onclick = e => { e.stopPropagation(); vscode.postMessage({ type: 'kill', agentId: el.dataset.kill }); }; });
  }

  document.getElementById('openCanvas').onclick = () => vscode.postMessage({ type: 'openCanvas' });
  document.getElementById('newAgent').onclick = () => vscode.postMessage({ type: 'newAgent' });
  document.getElementById('openConfig').onclick = () => vscode.postMessage({ type: 'openConfig' });
  window.addEventListener('message', e => { if (e.data.type === 'state') render(e.data.config); });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
