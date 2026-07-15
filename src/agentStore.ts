import * as vscode from 'vscode';
import * as path from 'path';

export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'done';

export interface AgentTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
}

export interface Agent {
  id: string;
  name: string;
  role: string;            // ex: "Arquiteto", "Revisor de código", "Testes"
  model: string;           // ex: "claude-sonnet-4-6"
  status: AgentStatus;
  currentTask?: string;
  tasks: AgentTask[];
  logs: string[];
  // --- campos do canvas (Fase 2) ---
  cli?: string;            // 'claude' | 'codex' | 'gemini' | 'shell' | 'custom'
  dir?: string;            // working directory do terminal
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface PrivateWizardConfig {
  project?: string;
  agents: Agent[];
}

const DEFAULT_CONFIG: PrivateWizardConfig = {
  project: 'Meu Projeto',
  agents: [
    {
      id: 'architect',
      name: 'Maestro',
      role: 'Orquestrador',
      model: 'claude-sonnet-4-6',
      status: 'idle',
      currentTask: 'Aguardando instruções',
      tasks: [
        { id: 't1', title: 'Planejar sprint', status: 'pending' }
      ],
      logs: []
    },
    {
      id: 'coder',
      name: 'Coder',
      role: 'Implementação',
      model: 'claude-sonnet-4-6',
      status: 'idle',
      tasks: [],
      logs: []
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      role: 'Revisão de código',
      model: 'claude-haiku-4-5',
      status: 'idle',
      tasks: [],
      logs: []
    }
  ]
};

/**
 * Lê, observa e persiste a configuração de agents do workspace.
 * Fonte da verdade: <workspace>/.privatewizard/agents.json
 */
export class AgentStore implements vscode.Disposable {
  private _config: PrivateWizardConfig = { agents: [] };
  private watcher?: vscode.FileSystemWatcher;
  private readonly _onDidChange = new vscode.EventEmitter<PrivateWizardConfig>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly workspaceRoot: string | undefined) {}

  get config(): PrivateWizardConfig {
    return this._config;
  }

  private get configUri(): vscode.Uri | undefined {
    if (!this.workspaceRoot) return undefined;
    const rel =
      vscode.workspace.getConfiguration('privateWizard').get<string>('configPath') ??
      '.privatewizard/agents.json';
    return vscode.Uri.file(path.join(this.workspaceRoot, rel));
  }

  async load(): Promise<void> {
    const uri = this.configUri;
    if (!uri) {
      this._config = { agents: [] };
      this._onDidChange.fire(this._config);
      return;
    }
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      this._config = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      // Arquivo ainda não existe — dashboard mostra estado vazio com CTA de init
      this._config = { agents: [] };
    }
    this._onDidChange.fire(this._config);
  }

  startWatching(): void {
    const uri = this.configUri;
    if (!uri) return;
    this.watcher = vscode.workspace.createFileSystemWatcher(uri.fsPath);
    this.watcher.onDidChange(() => this.load());
    this.watcher.onDidCreate(() => this.load());
    this.watcher.onDidDelete(() => this.load());
  }

  /** Cria .privatewizard/agents.json com um time de exemplo. */
  async init(): Promise<void> {
    const uri = this.configUri;
    if (!uri) {
      vscode.window.showErrorMessage('PrivateWizard: abra uma pasta/workspace primeiro.');
      return;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8')
    );
    vscode.window.showInformationMessage('PrivateWizard inicializado: .privatewizard/agents.json criado.');
    await this.load();
  }

  async save(): Promise<void> {
    const uri = this.configUri;
    if (!uri) return;
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(this._config, null, 2), 'utf8')
    );
  }

  /** Atualiza o status de um agent e persiste. Ponto de integração com runtimes reais. */
  async setStatus(agentId: string, status: AgentStatus, logLine?: string): Promise<void> {
    const agent = this._config.agents.find(a => a.id === agentId);
    if (!agent) return;
    agent.status = status;
    if (logLine) {
      agent.logs.push(`[${new Date().toLocaleTimeString()}] ${logLine}`);
      if (agent.logs.length > 200) agent.logs.shift();
    }
    await this.save();
    this._onDidChange.fire(this._config);
  }

  /** Cria ou atualiza um agent vindo do canvas e persiste. */
  async upsert(agent: Agent): Promise<void> {
    const i = this._config.agents.findIndex(a => a.id === agent.id);
    if (i >= 0) this._config.agents[i] = { ...this._config.agents[i], ...agent };
    else this._config.agents.push(agent);
    await this.save();
    this._onDidChange.fire(this._config);
  }

  /** Remove um agent e persiste. */
  async remove(agentId: string): Promise<void> {
    const before = this._config.agents.length;
    this._config.agents = this._config.agents.filter(a => a.id !== agentId);
    if (this._config.agents.length !== before) {
      await this.save();
      this._onDidChange.fire(this._config);
    }
  }

  /** Persiste só posição/tamanho das janelas (drag). Não dispara onDidChange. */
  async saveLayout(layout: Array<{ id: string; x: number; y: number; w: number; h: number }>): Promise<void> {
    for (const l of layout) {
      const a = this._config.agents.find(x => x.id === l.id);
      if (a) { a.x = l.x; a.y = l.y; a.w = l.w; a.h = l.h; }
    }
    await this.save();
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}
