import * as vscode from 'vscode';
import { AgentStore } from './agentStore';
import { DashboardViewProvider } from './dashboardView';
import { openPtySpike } from './ptySpike';
import { openCanvas, agentAction } from './canvasPanel';

export function activate(context: vscode.ExtensionContext): void {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const store = new AgentStore(root);
  const provider = new DashboardViewProvider(context.extensionUri, store);

  context.subscriptions.push(
    store,
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, provider),
    vscode.commands.registerCommand('privateWizard.openDashboard', () =>
      vscode.commands.executeCommand('workbench.view.extension.privateWizard')
    ),
    vscode.commands.registerCommand('privateWizard.refresh', () => store.load()),
    vscode.commands.registerCommand('privateWizard.init', () => store.init()),
    vscode.commands.registerCommand('privateWizard.spike', () => openPtySpike(context)),
    vscode.commands.registerCommand('privateWizard.canvas', () => openCanvas(context, store)),
    vscode.commands.registerCommand('privateWizard.newAgent', () => openCanvas(context, store, { wizard: true })),
    vscode.commands.registerCommand('privateWizard.agentRun', (id: string) => agentAction(context, store, 'run', id)),
    vscode.commands.registerCommand('privateWizard.agentStop', (id: string) => agentAction(context, store, 'stop', id)),
    vscode.commands.registerCommand('privateWizard.agentKill', (id: string) => agentAction(context, store, 'kill', id))
  );

  store.load();
  store.startWatching();
}

export function deactivate(): void {}
