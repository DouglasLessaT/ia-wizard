import * as vscode from 'vscode';
import * as os from 'os';
import * as pty from 'node-pty';

/**
 * Um pty (shell real) por janela do canvas, roteado por agentId. Reusa o padrão
 * validado em ptySpike.ts. Ao criar, se o agent tem um `cli` de runtime
 * (claude/codex/...), auto-roda o comando dentro do shell — se o CLI não existir
 * no PATH, o próprio shell mostra "command not found" (não derruba o terminal).
 */
// Comando real a executar por runtime. Só os presentes no PATH rodam de fato.
const CLI_CMD: Record<string, string> = {
  claude: 'claude', codex: 'codex', gemini: 'gemini', glm: 'glm', grok: 'grok'
};

// Sentinela para o comando `pw` (uma sessão cria outra). A função shell `pw`
// imprime <STX>PWNEW <json><ETX>; a extensão detecta no stream, cria o agent e
// remove o marcador do que vai pra tela (bytes de controle, invisíveis).
const PW_START = '\x02PWNEW ';
const PW_END = '\x03PW\x03';
// Função `pw` injetada no shell (bash/zsh): pw new <runtime> [--name X] [--dir D] [prompt...]
const PW_FUNC =
  `pw(){ ` +
  `if [ "$1" != "new" ]; then echo "uso: pw new <runtime> [--name NOME] [--dir DIR] [prompt]"; return 1; fi; shift; ` +
  `local rt="$1"; shift; local name="" dir="$PWD" prompt=""; ` +
  `while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --dir) dir="$2"; shift 2;; *) prompt="$prompt $1"; shift;; esac; done; ` +
  `printf '\\002PWNEW {"cli":"%s","name":"%s","dir":"%s","prompt":"%s"}\\003PW\\003\\n' "$rt" "$name" "$dir" "$(echo $prompt | sed 's/\"/\\\\\"/g')"; ` +
  `echo "→ pedido: novo agent '$rt' $name"; }`;

export class PtyManager implements vscode.Disposable {
  private ptys = new Map<string, pty.IPty>();
  private clis = new Map<string, string>(); // id -> cli (para reiniciar)
  private buf = new Map<string, string>();   // id -> buffer p/ detectar o marcador partido entre chunks

  constructor(
    private readonly post: (msg: unknown) => void,
    private readonly onSpawnRequest: (req: { cli: string; name: string; dir: string; prompt: string }) => void
  ) {}

  /** Garante um pty vivo para o agent; expande `dir` (~) e auto-roda o CLI. */
  ensure(id: string, dir?: string, cli?: string): void {
    if (this.ptys.has(id)) return;
    if (cli) this.clis.set(id, cli);
    const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');
    const cwd = resolveDir(dir);
    const child = pty.spawn(shell, [], {
      name: 'xterm-color', cols: 80, rows: 24, cwd, env: process.env as { [key: string]: string }
    });
    child.onData(data => { const clean = this.scan(id, data); if (clean) this.post({ type: 'pty:out', id, data: clean }); });
    child.onExit(({ exitCode }) => { this.post({ type: 'pty:exit', id, code: exitCode }); this.ptys.delete(id); this.buf.delete(id); });
    this.ptys.set(id, child);
    // injeta a função `pw` (uma sessão inicia outra) assim que o shell sobe
    setTimeout(() => child.write(PW_FUNC + '\r clear\r'), 250);
    // pequeno delay: dá tempo do shell inicializar antes de auto-rodar o CLI
    if (cli && CLI_CMD[cli]) setTimeout(() => this.run(id, cli), 700);
  }

  /** Procura o marcador PWNEW no stream, dispara o spawn e devolve o texto limpo p/ a tela. */
  private scan(id: string, chunk: string): string {
    let s = (this.buf.get(id) || '') + chunk;
    let out = '';
    for (;;) {
      const i = s.indexOf(PW_START);
      if (i < 0) break;                         // sem marcador → resto é texto normal
      const j = s.indexOf(PW_END, i);
      if (j < 0) { out += s.slice(0, i); s = s.slice(i); this.buf.set(id, s); return out; } // incompleto: segura a cauda
      out += s.slice(0, i);
      try { this.onSpawnRequest(JSON.parse(s.slice(i + PW_START.length, j))); } catch { /* json ruim, ignora */ }
      s = s.slice(j + PW_END.length);
    }
    out += s;
    this.buf.set(id, '');
    return out;
  }

  /** (Re)executa o CLI do runtime no shell. Chamado no ensure e no botão Iniciar. */
  run(id: string, cli?: string): void {
    const child = this.ptys.get(id); if (!child) return;
    const which = cli ?? this.clis.get(id);
    const cmd = which && CLI_CMD[which];
    if (cmd) child.write(cmd + '\r'); // roda dentro do shell → CLI ausente vira "command not found"
  }

  /** Envia Ctrl+C para interromper o que estiver rodando (botão Parar). */
  stop(id: string): void { this.ptys.get(id)?.write(''); }

  write(id: string, data: string): void { this.ptys.get(id)?.write(data); }
  resize(id: string, cols: number, rows: number): void {
    // ponytail: cols/rows>0 evita crash do node-pty com dimensão zero em janela recém-criada
    if (cols > 0 && rows > 0) this.ptys.get(id)?.resize(cols, rows);
  }
  kill(id: string): void { this.ptys.get(id)?.kill(); this.ptys.delete(id); this.clis.delete(id); }

  dispose(): void { for (const p of this.ptys.values()) p.kill(); this.ptys.clear(); this.clis.clear(); }
}

function resolveDir(dir?: string): string {
  const home = os.homedir();
  let p = (!dir || dir === '~') ? home : dir.startsWith('~/') ? home + dir.slice(1) : dir;
  // fallback pro home se o caminho não existir (evita chdir(2) failed → pty morre)
  try { return require('fs').statSync(p).isDirectory() ? p : home; } catch { return home; }
}
