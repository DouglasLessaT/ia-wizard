# PrivateWizard — AI Agents Dashboard para VS Code / Antigravity

Dashboard na Activity Bar para orquestrar e monitorar agents de IA no seu projeto.

## Como rodar em desenvolvimento

1. `npm install`
2. Abra a pasta no VS Code e pressione **F5** (abre uma janela "Extension Development Host")
3. Na nova janela, abra qualquer projeto e clique no ícone **PrivateWizard** na Activity Bar
4. Clique em **Inicializar PrivateWizard** — isso cria `.privatewizard/agents.json` no projeto

## Como funciona

- A fonte da verdade é o arquivo `.privatewizard/agents.json` do workspace
- O dashboard observa o arquivo (file watcher): edite o JSON e a UI atualiza na hora
- Botões Iniciar/Pausar/Parar atualizam status e logs (persistidos no JSON)

## Formato do agents.json

```json
{
  "project": "Meu Projeto",
  "agents": [
    {
      "id": "coder",
      "name": "Coder",
      "role": "Implementação",
      "model": "claude-sonnet-4-6",
      "status": "idle",
      "currentTask": "Refatorar módulo de auth",
      "tasks": [
        { "id": "t1", "title": "Escrever testes", "status": "in_progress" }
      ],
      "logs": []
    }
  ]
}
```

## Onde plugar agents reais

Em `src/dashboardView.ts`, no handler da mensagem `start`, está marcado o
ponto de integração. Ali você pode:

- Chamar a API da Anthropic (Messages API) e ir gravando logs via `store.setStatus(...)`
- Spawnar um processo (ex.: `claude` CLI / Claude Code) com `child_process`
- Conectar a um orquestrador externo via HTTP/WebSocket e refletir o estado no JSON

Como o estado vive em `.privatewizard/agents.json`, qualquer processo externo que
escreva nesse arquivo também atualiza o dashboard automaticamente.

## Instalação (VS Code e Antigravity)

Antigravity é um fork do VS Code, então a instalação é idêntica — só muda o
comando da CLI (`code` → `antigravity`).

### 1. Gerar o pacote `.vsix`

Na raiz do projeto:

```bash
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository --skip-license
```

Isso gera `privatewizard-0.1.0.vsix`.

### 2. Instalar pela CLI

**VS Code:**

```bash
code --install-extension privatewizard-0.1.0.vsix --force
```

**Antigravity:**

```bash
antigravity --install-extension privatewizard-0.1.0.vsix --force
```

> Se a CLI não for encontrada, use o comando com o caminho absoluto do `.vsix`
> ou instale pela interface (passo 3). No VS Code, habilite a CLI `code` com
> **Cmd/Ctrl+Shift+P → Shell Command: Install 'code' command in PATH**.

Caminho da CLI por SO (caso `code`/`antigravity` não esteja no PATH):

| SO | VS Code | Antigravity |
|----|---------|-------------|
| **Linux** | `/usr/bin/code` | `/usr/bin/antigravity` |
| **macOS** | `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code` | `/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity` |
| **Windows** | `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd` | `%LOCALAPPDATA%\Programs\Antigravity\bin\antigravity.cmd` |

### 3. Instalar pela interface (alternativa)

1. Abra a aba **Extensions** (Cmd/Ctrl+Shift+X)
2. No menu **⋯** (canto superior direito) → **Install from VSIX...**
3. Selecione o arquivo `privatewizard-0.1.0.vsix`

### 4. Depois de instalar

- **Reinicie** o editor.
- A extensão ativa quando o workspace tem `.privatewizard/agents.json`, ou pelo
  comando **PrivateWizard: Abrir Dashboard** (Cmd/Ctrl+Shift+P).

### Módulo nativo (node-pty)

O `.vsix` embute o `node-pty`, um módulo nativo compilado para a versão de
Node/Electron da máquina que gerou o pacote. Se o dashboard abrir mas o
terminal PTY falhar com erro tipo `NODE_MODULE_VERSION mismatch`, recompile
para a ABI do editor de destino:

```bash
npx @electron/rebuild -v <versao-do-electron-do-editor>
```

A versão de Electron aparece em **Help → About** (ou `Sobre`) do editor.
