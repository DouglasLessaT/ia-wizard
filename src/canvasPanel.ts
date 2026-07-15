import * as vscode from 'vscode';
import { AgentStore, Agent } from './agentStore';
import { PtyManager } from './ptyManager';

/**
 * Fase 2 — canvas com terminais REAIS. Porta o design privateWizard.dc.html para um
 * WebviewPanel em vanilla JS (canvas pan/zoom, janelas arrastáveis, connectors,
 * Agent Manager, wizard) e hospeda um xterm.js por janela ligado a um node-pty
 * real (PtyManager). Fonte da verdade: .privatewizard/agents.json (AgentStore).
 * Fase 2 roda shell real; spawnar CLI escolhido fica p/ fase seguinte.
 */
let current: vscode.WebviewPanel | undefined;

/** Ação da sidebar sobre um agent: abre o canvas se preciso e roteia a mensagem. */
export function agentAction(context: vscode.ExtensionContext, store: AgentStore, action: 'run'|'stop'|'kill', agentId: string): void {
  const send = () => current?.webview.postMessage({ type: 'agentAction', action, id: agentId });
  if (!current) { openCanvas(context, store); setTimeout(send, 400); } // espera o ready/render montar a janela
  else { current.reveal(); send(); }
}

export function openCanvas(context: vscode.ExtensionContext, store: AgentStore, opts?: { wizard?: boolean }): void {
  if (current) { current.reveal(); if (opts?.wizard) current.webview.postMessage({ type: 'openWizard' }); return; }
  const panel = vscode.window.createWebviewPanel(
    'privateWizard.canvas',
    'PrivateWizard — Canvas',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [context.extensionUri] }
  );
  current = panel;

  const ptys = new PtyManager(
    msg => panel.webview.postMessage(msg),
    // uma sessão pediu para criar outra (comando `pw new ...` no terminal)
    req => panel.webview.postMessage({ type: 'spawnRequest', req })
  );

  const uri = (...p: string[]) =>
    panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, ...p)).toString();
  const xtermJs = uri('node_modules', '@xterm', 'xterm', 'lib', 'xterm.js');
  const xtermCss = uri('node_modules', '@xterm', 'xterm', 'css', 'xterm.css');

  const nonce = String(Math.random()).slice(2);
  const csp =
    `default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; ` +
    `img-src ${panel.webview.cspSource}; font-src ${panel.webview.cspSource} https://fonts.gstatic.com; ` +
    `script-src ${panel.webview.cspSource} 'nonce-${nonce}';`;
  const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '~';
  panel.webview.html = html(nonce, csp, xtermJs, xtermCss, wsDir);

  const pushState = () =>
    panel.webview.postMessage({ type: 'state', config: store.config });
  const sub = store.onDidChange(pushState);

  panel.webview.onDidReceiveMessage(async (m: any) => {
    switch (m.type) {
      case 'ready': pushState(); if (opts?.wizard) panel.webview.postMessage({ type: 'openWizard' }); break;
      case 'pty:ensure': ptys.ensure(m.id, m.dir, m.cli); break;
      case 'pty:in': ptys.write(m.id, m.data); break;
      case 'pty:run': ptys.run(m.id, m.cli); break;
      case 'pty:stop': ptys.stop(m.id); break;
      case 'pty:resize': ptys.resize(m.id, m.cols, m.rows); break;
      case 'pty:kill': ptys.kill(m.id); break;
      case 'saveLayout': await store.saveLayout(m.layout); break;
      case 'createAgent': await store.upsert(m.agent as Agent); break;
      case 'removeAgent': ptys.kill(m.id); await store.remove(m.id); break;
    }
  });

  panel.onDidDispose(() => { sub.dispose(); ptys.dispose(); current = undefined; });
}

function html(nonce: string, csp: string, xtermJs: string, xtermCss: string, wsDir: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${xtermCss}" />
<style>
:root{
  --app:#f3f3f4; --surface:#ffffff; --surface2:#f6f6f7; --sidebar:#f7f7f8; --activity:#efeff1;
  --titlebar:#e8e8ec; --border:#e4e4e8; --border-strong:#d3d3d9;
  --text:#26262b; --dim:#6c6c76; --faint:#a2a2ac; --accent:#fe8330; --accent-2:#ffa832; --accent-soft:#ffe9d5;
  --canvas:#fbfbfc; --dot:#e6e6ec; --term:#ffffff; --term-head:#f3f3f6;
  --green:#2f9e44; --blue:#1971c2; --red:#e03131; --yellow:#b0800f; --cyan:#0c8599; --mag:#9c36b5; --sel:#e6ecff;
}
body.dark{
  --app:#181819; --surface:#212123; --surface2:#28282b; --sidebar:#1e1e20; --activity:#171718;
  --titlebar:#141416; --border:#2e2e33; --border-strong:#3a3a41;
  --text:#e7e7ec; --dim:#9a9aa4; --faint:#63636c; --accent:#fe8330; --accent-2:#ffa832; --accent-soft:#40291a;
  --canvas:#151517; --dot:#292930; --term:#1a1a1c; --term-head:#232326;
  --green:#5bc46a; --blue:#4aa3ff; --red:#ff6b6b; --yellow:#e6b850; --cyan:#3bc9db; --mag:#da77f2; --sel:#2a3350;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden}
body{background:var(--app);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased;font-size:13px}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:6px}
::-webkit-scrollbar-track{background:transparent}
@keyframes mpulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes dashmove{to{stroke-dashoffset:-24}}
@keyframes fadeup{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes ovin{from{opacity:0}to{opacity:1}}
.app{height:100vh;width:100vw;display:flex;flex-direction:column;background:var(--app);overflow:hidden}
.mono{font-family:'JetBrains Mono',monospace}
button{font-family:inherit}
.term{padding:6px 8px}
.term .xterm{height:100%}
</style>
</head>
<body>
<div class="app" id="app"></div>

<script nonce="${nonce}" src="${xtermJs}"></script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

const GLYPH = {
  claude:{g:'✳',c:'accent'}, codex:{g:'⌬',c:'text'}, gemini:{g:'✦',c:'mag'},
  glm:{g:'◈',c:'blue'}, grok:{g:'✕',c:'text'},
  shell:{g:'›',c:'cyan'}, custom:{g:'⬡',c:'blue'}
};
const STAT = {
  running:{v:'green',l:'Running',p:true}, review:{v:'yellow',l:'Review',p:true},
  idle:{v:'faint',l:'Idle',p:false}, error:{v:'red',l:'Error',p:true}
};

const TITLE = {claude:'Claude Code',codex:'Codex',gemini:'Gemini CLI',glm:'GLM',grok:'Grok',shell:'Shell',custom:'Custom Agent'};
const WORKSPACE_DIR = ${JSON.stringify(wsDir)};

// LLM por runtime. IDs Anthropic são reais (jul/2026). Demais são plausíveis — ajuste conforme a CLI instalada.
const MODELS = {
  claude: { llm:'Anthropic', list:[
    {id:'claude-opus-4-8', name:'Opus 4.8'},
    {id:'claude-sonnet-5', name:'Sonnet 5'},
    {id:'claude-haiku-4-5', name:'Haiku 4.5'},
    {id:'claude-fable-5', name:'Fable 5'}
  ]},
  codex:  { llm:'OpenAI',  list:[{id:'gpt-5.4',name:'GPT-5.4'},{id:'gpt-5.4-mini',name:'GPT-5.4 mini'}] },
  gemini: { llm:'Google',  list:[{id:'gemini-3',name:'Gemini 3'},{id:'gemini-3-flash',name:'Gemini 3 Flash'}] },
  glm:    { llm:'Zhipu',   list:[{id:'glm-4.6',name:'GLM-4.6'},{id:'glm-4.6-air',name:'GLM-4.6 Air'}] },
  grok:   { llm:'xAI',     list:[{id:'grok-4',name:'Grok 4'},{id:'grok-4-fast',name:'Grok 4 Fast'}] },
  shell:  { llm:'—',       list:[{id:'zsh',name:'zsh'}] },
  custom: { llm:'—',       list:[] }
};

const state = {
  theme:'light', activeActivity:'privateWizard', selectedAgentId:null,
  focusedWindow:null, zoom:0.74, pan:{x:120,y:40},
  wizardOpen:false, wizardStep:0,
  draft:{ cli:'', name:'', role:'', dir:'~', perms:'ask', model:'', skills:['mcp'] },
  windows:[]
};
let zc = 1, drag = null, panning = false;
const terms = {}; // id -> { term } xterm instances vivas
const pendingPrompts = {}; // agentId -> prompt inicial a enviar quando o terminal montar (pw new "prompt")

// Agent (.privatewizard/agents.json) -> window do canvas. Posições default em grade se ausentes.
function fromAgents(cfg){
  const ags = (cfg && cfg.agents) || [];
  return ags.map((a,i)=>({
    id:a.id, agentId:a.id, title:a.name||TITLE[a.cli]||'Agent', cli:a.cli||'shell',
    agent:a.name||null, status:a.status||'idle', model:a.model||'',
    dir:a.dir||'~', w:a.w||452, h:a.h||230,
    x:(a.x!=null)?a.x:60+(i%2)*520, y:(a.y!=null)?a.y:40+Math.floor(i/2)*360,
    z:i+1
  }));
}

const $ = (s,r=document)=>r.querySelector(s);
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setState(patch){ Object.assign(state, patch); render(); }

// ---- interações ----
function setZoom(z){ state.zoom = Math.max(0.32, Math.min(1.7, z)); render(); }
function zoomIn(){ setZoom(state.zoom*1.15); }
function zoomOut(){ setZoom(state.zoom/1.15); }
function zoomReset(){ setState({zoom:1}); }
function fitView(){ setState({zoom:0.6, pan:{x:120,y:24}}); }

function focusWindow(id){ const z=++zc; state.focusedWindow=id; const w=state.windows.find(x=>x.id===id); if(w) w.z=z; render(); }
function selectWindow(id){ state.selectedAgentId=id; focusWindow(id); }
function centerOn(id){
  const w=state.windows.find(x=>x.id===id); const el=$('#canvas'); if(!w||!el) return;
  const z=state.zoom;
  state.pan={ x: el.clientWidth/2 - (w.x+w.w/2)*z, y: el.clientHeight/2 - (w.y+110)*z };
  render();
}
function selectAgent(id){ state.selectedAgentId=id; focusWindow(id); centerOn(id); }

function onCanvasDown(e){
  if(e.target.id!=='canvas' && e.target.id!=='layer' && e.target.tagName!=='svg') return;
  panning=true;
  drag={ type:'pan', sx:e.clientX, sy:e.clientY, ox:state.pan.x, oy:state.pan.y };
  render();
}
function startWinDrag(e,id){
  e.stopPropagation(); focusWindow(id);
  const w=state.windows.find(x=>x.id===id);
  drag={ type:'win', id, sx:e.clientX, sy:e.clientY, ox:w.x, oy:w.y };
}
function startWinResize(e,id){
  e.stopPropagation(); focusWindow(id);
  const w=state.windows.find(x=>x.id===id);
  drag={ type:'resize', id, sx:e.clientX, sy:e.clientY, ow:w.w, oh:w.h };
}
function onMove(e){
  if(!drag) return;
  const dx=e.clientX-drag.sx, dy=e.clientY-drag.sy;
  if(drag.type==='pan'){ state.pan={x:drag.ox+dx, y:drag.oy+dy}; render(); }
  else if(drag.type==='resize'){ const z=state.zoom; const w=state.windows.find(x=>x.id===drag.id); w.w=Math.max(280,drag.ow+dx/z); w.h=Math.max(120,drag.oh+dy/z); render(); }
  else { const z=state.zoom; const w=state.windows.find(x=>x.id===drag.id); w.x=drag.ox+dx/z; w.y=drag.oy+dy/z; render(); }
}
function onUp(){
  const persist = drag && (drag.type==='win' || drag.type==='resize');
  if(drag){ drag=null; }
  if(panning){ panning=false; render(); }
  if(persist) saveLayout();
}
let layoutTimer=null;
function saveLayout(){
  clearTimeout(layoutTimer);
  layoutTimer=setTimeout(()=>{
    vscode.postMessage({ type:'saveLayout', layout: state.windows.map(w=>({ id:w.agentId, x:Math.round(w.x), y:Math.round(w.y), w:Math.round(w.w), h:Math.round(w.h) })) });
  }, 300);
}

// ---- wizard ----
function openWizard(){ setState({ wizardOpen:true, wizardStep:0, draft:{ cli:'', name:'', role:'', dir:WORKSPACE_DIR, perms:'ask', model:'', skills:['mcp'] } }); }
function closeWizard(){ setState({wizardOpen:false}); }
function wizardBack(){ setState({wizardStep:Math.max(0,state.wizardStep-1)}); }
function canNext(){ const d=state.draft, st=state.wizardStep; if(st===0) return !!d.cli; if(st===1) return d.name.trim().length>0; return true; }
function wizardNext(){ if(!canNext()) return; if(state.wizardStep>=2){ createAgent(); return; } setState({wizardStep:state.wizardStep+1}); }
function setDraft(p){ Object.assign(state.draft,p); render(); }
function toggleSkill(id){ const s=state.draft.skills; const i=s.indexOf(id); if(i>=0) s.splice(i,1); else s.push(id); render(); }
// Cria um agent (usado pelo wizard e pelo comando pw new de outra sessão).
function spawnAgent(opts){
  const cli=opts.cli||'shell';
  const m=MODELS[cli];
  const defModel = (m&&m.list.length)? m.list[0].id : '';
  const base=((opts.name||'').trim()||cli||'agent').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'agent';
  const taken=new Set(state.windows.map(w=>w.agentId));
  let id=base, n=2; while(taken.has(id)){ id=base+'-'+(n++); }
  const cx=-state.pan.x/state.zoom+260, cy=-state.pan.y/state.zoom+180;
  const agent={
    id, name:((opts.name||'').trim()||TITLE[cli]||'Agent'), role:(opts.role||'').trim(),
    model:opts.model||defModel||'auto', status:'idle', tasks:[], logs:[],
    cli, dir:opts.dir||WORKSPACE_DIR, x:Math.round(cx), y:Math.round(cy), w:452, h:230
  };
  vscode.postMessage({ type:'createAgent', agent }); // host persiste → volta via 'state'
  state.pendingFocus=id;
  return id;
}
function createAgent(){
  spawnAgent(state.draft);
  state.wizardOpen=false; render();
}

function killWindow(id){
  const w=state.windows.find(x=>x.id===id); if(!w) return;
  const t=terms[id];
  if(t){ t.term.dispose(); delete terms[id]; }
  vscode.postMessage({ type:'pty:kill', id:w.agentId });   // mata o processo
  vscode.postMessage({ type:'removeAgent', id:w.agentId }); // host remove do agents.json → volta via 'state'
  state.windows = state.windows.filter(x=>x.id!==id);       // some já (otimista); o 'state' confirma
  render();
}

function toggleTheme(){ setState({theme: state.theme==='dark'?'light':'dark'}); }

// ---- render ----
function winView(w){
  const g=GLYPH[w.cli]||GLYPH.custom, st=STAT[w.status]||STAT.idle;
  const focused=w.id===state.focusedWindow;
  return { ...w, glyph:g.g, glyphColor:'var(--'+g.c+')', dot:'var(--'+st.v+')', statusLabel:st.l,
    pulse: st.p?'mpulse 1.8s ease-in-out infinite':'none',
    agentLabel: w.agent?('Agent/'+w.agent):'terminal', treeLabel:'Agent/'+(w.agent||''),
    rowBg: state.selectedAgentId===w.id?'var(--sel)':'transparent',
    cardBorder: focused?'var(--accent)':'var(--border)',
    boxShadow: focused?'0 0 0 2px var(--accent), 0 14px 44px rgba(0,0,0,.18)':'0 6px 24px rgba(0,0,0,.10)' };
}

function render(){
  const S=state;
  const views=S.windows.map(winView);
  const connectors=''; // ponytail: connectors do mock removidos; sem grafo de deps real ainda
  const running=S.windows.filter(w=>w.status==='running').length;

  document.body.classList.toggle('dark', S.theme==='dark');

  const app = $('#app');
  app.innerHTML = ''
  // body row (só canvas + agent manager; sem chrome de editor — já estamos dentro do VS Code)
  + '<div style="flex:1;display:flex;min-height:0">'
    // canvas
    + '<div style="flex:1;display:flex;flex-direction:column;min-width:0;background:var(--canvas)">'
      // toolbar fina do canvas: título + New Agent + tema
      + '<div style="height:38px;flex:0 0 38px;display:flex;align-items:center;gap:8px;padding:0 12px;background:var(--surface2);border-bottom:1px solid var(--border)">'
        + '<span style="width:18px;height:18px;border-radius:5px;background:var(--accent);color:#fff;font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center">W</span>'
        + '<span style="font-size:12.5px;font-weight:600">privateWizard.canvas</span>'
        + '<span style="color:var(--faint);font-size:11.5px">'+S.windows.length+' agents</span>'
        + '<span style="flex:1"></span>'
        + '<button data-act="openWizard" style="border:none;background:var(--accent);color:#fff;font-size:12px;padding:5px 12px;border-radius:6px;cursor:pointer;font-weight:600">＋ Novo Agente</button>'
+ '<span data-act="toggleTheme" title="Tema" style="cursor:pointer;color:var(--dim);font-size:14px;padding:4px 12px 4px 6px">'+(S.theme==='dark'?'🌒':'☀')+'</span>'      + '</div>'
      + '<div id="canvas" style="flex:1;position:relative;overflow:hidden;cursor:'+(panning?'grabbing':'default')+';background:radial-gradient(var(--dot) 1.1px, transparent 1.1px);background-size:22px 22px;background-position:'+S.pan.x+'px '+S.pan.y+'px">'
        + '<div id="layer" style="position:absolute;left:0;top:0;transform-origin:0 0;transform:translate('+S.pan.x+'px,'+S.pan.y+'px) scale('+S.zoom+')">'
          + '<svg width="4000" height="3000" style="position:absolute;left:0;top:0;pointer-events:none;overflow:visible">'+connectors+'</svg>'
          + views.map(w=>''
            + '<div data-act="selectWindow" data-id="'+w.id+'" style="position:absolute;left:'+w.x+'px;top:'+w.y+'px;width:'+w.w+'px;z-index:'+w.z+';background:var(--term);border:1px solid var(--border);border-radius:9px;box-shadow:'+w.boxShadow+';overflow:hidden">'
              + '<div data-act="winDrag" data-id="'+w.id+'" style="height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;background:var(--term-head);border-bottom:1px solid var(--border);cursor:grab;user-select:none">'
                + '<span class="mono" style="color:'+w.glyphColor+';font-size:13px">'+w.glyph+'</span>'
                + '<span style="font-size:12px;font-weight:600;color:var(--text)">'+esc(w.title)+'</span>'
                + '<span style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:'+w.dot+'"><span style="width:6px;height:6px;border-radius:50%;background:'+w.dot+';display:inline-block;animation:'+w.pulse+'"></span>'+w.statusLabel+'</span>'
                + '<span style="flex:1"></span>'
                + '<span data-act="killWindow" data-id="'+w.id+'" title="Fechar / matar terminal" style="color:var(--faint);font-size:15px;line-height:1;cursor:pointer;padding:0 4px">×</span>'
              + '</div>'
              + '<div class="term" data-term-slot="'+w.id+'" style="height:'+w.h+'px"></div>'
              // ponytail: rodapé reservado p/ barra de tokens quando o agent rodar LLM real (input/output tokens). Hoje só o dir.
              + '<div style="padding:6px 13px 9px;border-top:1px dashed var(--border);display:flex;align-items:center;gap:6px;color:var(--faint);font-size:10.5px;background:var(--term)"><span style="color:var(--dim)">⌂</span> '+esc(w.dir)+'</div>'
              + '<div data-act="winResize" data-id="'+w.id+'" title="Redimensionar" style="position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;color:var(--faint);font-size:12px;display:flex;align-items:flex-end;justify-content:flex-end;user-select:none">◢</div>'
            + '</div>').join('')
        + '</div>'
        // zoom controls
        + '<div style="position:absolute;right:16px;bottom:16px;display:flex;align-items:center;gap:2px;background:var(--surface);border:1px solid var(--border);border-radius:9px;box-shadow:0 4px 16px rgba(0,0,0,.08);padding:3px;z-index:50">'
          + '<button data-act="zoomOut" style="width:30px;height:28px;border:none;background:none;cursor:pointer;font-size:17px;color:var(--dim);border-radius:6px">−</button>'
          + '<button data-act="zoomReset" class="mono" style="min-width:52px;height:28px;border:none;background:none;cursor:pointer;font-size:12px;color:var(--text);border-radius:6px">'+Math.round(S.zoom*100)+'%</button>'
          + '<button data-act="zoomIn" style="width:30px;height:28px;border:none;background:none;cursor:pointer;font-size:17px;color:var(--dim);border-radius:6px">＋</button>'
          + '<div style="width:1px;height:18px;background:var(--border);margin:0 3px"></div>'
          + '<button data-act="fitView" title="Fit" style="width:30px;height:28px;border:none;background:none;cursor:pointer;font-size:14px;color:var(--dim);border-radius:6px">⊡</button>'
        + '</div>'
      + '</div>'
    + '</div>'
  + '</div>'
  // wizard
  + (S.wizardOpen ? wizardHtml() : '');

  wire();
  mountTerminals();
}

// Cria/reparenta o xterm de cada janela no seu slot. appendChild MOVE o nó
// sem destruí-lo, então o terminal sobrevive aos re-renders do innerHTML.
function mountTerminals(){
  state.windows.forEach(w=>{
    const slot=document.querySelector('[data-term-slot="'+w.id+'"]');
    if(!slot) return;
    let t=terms[w.id];
    if(!t){
      const el=document.createElement('div'); el.style.height='100%';
      const term=new Terminal({ fontFamily:"'JetBrains Mono', monospace", fontSize:11.5, cursorBlink:true, convertEol:true, theme:xtermTheme() });
      term.open(el);
      term.onData(d=>vscode.postMessage({ type:'pty:in', id:w.agentId, data:d }));
      t=terms[w.id]={ term, el, agentId:w.agentId };
      vscode.postMessage({ type:'pty:ensure', id:w.agentId, dir:w.dir, cli:w.cli });
      // prompt inicial vindo de 'pw new' — envia depois do CLI subir
      const p=pendingPrompts[w.agentId];
      if(p){ delete pendingPrompts[w.agentId]; setTimeout(()=>vscode.postMessage({ type:'pty:in', id:w.agentId, data:p+'\\r' }), 1500); }
    }
    if(t.el.parentElement!==slot){ slot.appendChild(t.el); }
    // clicar no corpo do terminal foca o xterm (sem re-render, preserva o caret)
    slot.onmousedown=(e)=>{ e.stopPropagation(); t.term.focus(); };
    fitTerm(w.id);
  });
  // re-foca o terminal da janela em foco após o reparent (o rebuild do innerHTML rouba foco)
  const f=terms[state.focusedWindow];
  if(f) f.term.focus();
  // some terminais de janelas removidas
  Object.keys(terms).forEach(id=>{ if(!state.windows.find(w=>w.id===id)){ terms[id].term.dispose(); vscode.postMessage({type:'pty:kill', id:terms[id].agentId}); delete terms[id]; } });
}

function fitTerm(id){
  const t=terms[id]; if(!t||!t.el.clientWidth) return;
  // ponytail: fit na unha (largura/altura da célula aproximadas); troco por addon-fit se precisar
  const cols=Math.max(20, Math.floor(t.el.clientWidth/6.6));
  const rows=Math.max(6, Math.floor(t.el.clientHeight/16));
  if(cols!==t.cols || rows!==t.rows){ t.cols=cols; t.rows=rows; t.term.resize(cols,rows); vscode.postMessage({type:'pty:resize', id:t.agentId, cols, rows}); }
}

function xtermTheme(){
  const dark=state.theme==='dark';
  return dark
    ? { background:'#1a1a1c', foreground:'#e7e7ec', cursor:'#fe8330' }
    : { background:'#ffffff', foreground:'#26262b', cursor:'#fe8330' };
}

// Dropdown de modelo + badge da LLM, dependente do runtime (d.cli). Custom = campo livre.
function modelFieldHtml(cli, model){
  const m=MODELS[cli]||MODELS.custom;
  const badge='<span style="font-size:10.5px;color:var(--dim)">LLM: <b style="color:var(--text)">'+esc(m.llm)+'</b></span>';
  let field;
  if(!m.list.length){
    field='<input data-field="model" value="'+esc(model||'')+'" placeholder="model id (ex: my-model)" class="mono" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);border-radius:9px;font-size:12.5px;outline:none">';
  } else {
    const cur = model || m.list[0].id;
    field='<select data-field="model" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);border-radius:9px;font-size:13px;outline:none;cursor:pointer">'
      + m.list.map(o=>'<option value="'+esc(o.id)+'"'+(o.id===cur?' selected':'')+'>'+esc(o.name)+' — '+esc(o.id)+'</option>').join('')
      + '</select>';
  }
  return '<div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;font-weight:600">Model</span>'+badge+'</div>'+field+'</div>';
}

function wizardHtml(){
  const S=state, d=S.draft, st=S.wizardStep;
  const cliOptions=[
    {id:'claude',name:'Claude Code',glyph:'✳',desc:'Anthropic · Opus 4.8 / Sonnet 5',color:'accent'},
    {id:'codex',name:'Codex',glyph:'⌬',desc:'OpenAI · GPT-5.4',color:'text'},
    {id:'gemini',name:'Gemini CLI',glyph:'✦',desc:'Google · Gemini 3',color:'mag'},
    {id:'glm',name:'GLM',glyph:'◈',desc:'Zhipu · GLM-4.6',color:'blue'},
    {id:'grok',name:'Grok',glyph:'✕',desc:'xAI · Grok 4',color:'text'},
    {id:'shell',name:'Shell',glyph:'›',desc:'Plain terminal · zsh',color:'cyan'},
    {id:'custom',name:'Custom',glyph:'⬡',desc:'Your own command',color:'blue'}
  ];
  const permOptions=[
    {id:'ask',label:'Ask every time',desc:'Approve each file edit'},
    {id:'auto',label:'Auto-accept edits',desc:'Run without prompts'},
    {id:'read',label:'Read-only',desc:'No writes to disk'}
  ];
  const skillOptions=[{id:'mcp',label:'MCP servers'},{id:'tests',label:'Run tests'},{id:'lint',label:'Lint & format'},{id:'git',label:'Git commit'}];
  const steps=['Runtime','Identity','Config'];

  const stepsHtml=steps.map((s,i)=>'<div style="display:flex;align-items:center;gap:9px"><div style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:50%;background:'+(i<=st?'var(--accent)':'var(--surface2)')+';color:'+(i<=st?'#fff':'var(--faint)')+';border:1px solid '+(i<=st?'var(--accent)':'var(--border)')+';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">'+(i+1)+'</span><span style="font-size:12.5px;font-weight:600;color:'+(i===st?'var(--text)':'var(--dim)')+';white-space:nowrap">'+s+'</span></div>'+(i<steps.length-1?'<span style="width:34px;height:2px;border-radius:2px;background:'+(i<st?'var(--accent)':'var(--border)')+';margin:0 10px"></span>':'')+'</div>').join('');

  let bodyHtml='';
  if(st===0){
    bodyHtml='<div style="font-size:12px;color:var(--dim);margin-bottom:12px">Choose the runtime for this agent.</div><div style="display:flex;flex-direction:column;gap:9px">'
      + cliOptions.map(o=>{ const sel=d.cli===o.id; return '<div data-act="pickCli" data-id="'+o.id+'" style="display:flex;align-items:center;gap:13px;padding:12px 14px;border:1.5px solid '+(sel?'var(--accent)':'var(--border)')+';background:'+(sel?'var(--accent-soft)':'var(--surface)')+';border-radius:11px;cursor:pointer"><span class="mono" style="width:34px;height:34px;border-radius:9px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--'+o.color+')">'+o.glyph+'</span><div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">'+o.name+'</div><div style="font-size:11.5px;color:var(--dim)">'+o.desc+'</div></div>'+(sel?'<span style="color:var(--accent);font-size:17px">●</span>':'')+'</div>'; }).join('')
      + '</div>';
  } else if(st===1){
    bodyHtml='<div style="display:flex;flex-direction:column;gap:15px">'
      + '<div><div style="font-size:12px;font-weight:600;margin-bottom:6px">Agent name</div><input data-field="name" value="'+esc(d.name)+'" placeholder="e.g. Fullstack, QA, security" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);border-radius:9px;font-size:13px;outline:none"></div>'
      + '<div><div style="font-size:12px;font-weight:600;margin-bottom:6px">Role <span style="color:var(--faint);font-weight:400">(optional)</span></div><input data-field="role" value="'+esc(d.role)+'" placeholder="What should this agent focus on?" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);border-radius:9px;font-size:13px;outline:none"></div>'
      + modelFieldHtml(d.cli, d.model)
      + '<div><div style="font-size:12px;font-weight:600;margin-bottom:6px">Working directory</div><input data-field="dir" value="'+esc(d.dir)+'" class="mono" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);border-radius:9px;font-size:12.5px;outline:none"></div>'
      + '</div>';
  } else {
    bodyHtml='<div style="display:flex;flex-direction:column;gap:16px">'
      + '<div><div style="font-size:12px;font-weight:600;margin-bottom:8px">Permissions</div><div style="display:flex;flex-direction:column;gap:8px">'
        + permOptions.map(o=>{ const sel=d.perms===o.id; return '<div data-act="pickPerm" data-id="'+o.id+'" style="display:flex;align-items:center;gap:11px;padding:10px 12px;border:1.5px solid '+(sel?'var(--accent)':'var(--border)')+';background:'+(sel?'var(--accent-soft)':'var(--surface)')+';border-radius:9px;cursor:pointer"><span style="width:16px;height:16px;border-radius:50%;border:1.5px solid '+(sel?'var(--accent)':'var(--border)')+';display:flex;align-items:center;justify-content:center">'+(sel?'<span style="width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block"></span>':'')+'</span><div style="flex:1"><span style="font-size:13px;font-weight:600">'+o.label+'</span> <span style="font-size:11.5px;color:var(--dim)">· '+o.desc+'</span></div></div>'; }).join('')
      + '</div></div>'
      + '<div><div style="font-size:12px;font-weight:600;margin-bottom:8px">Skills</div><div style="display:flex;flex-wrap:wrap;gap:8px">'
        + skillOptions.map(o=>{ const on=d.skills.includes(o.id); return '<div data-act="toggleSkill" data-id="'+o.id+'" style="display:flex;align-items:center;gap:7px;padding:7px 12px;border:1.5px solid '+(on?'var(--accent)':'var(--border)')+';background:'+(on?'var(--accent-soft)':'var(--surface)')+';border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:500"><span style="width:14px;height:14px;border-radius:4px;border:1.5px solid '+(on?'var(--accent)':'var(--border)')+';display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--accent)">'+(on?'✓':'')+'</span>'+o.label+'</div>'; }).join('')
      + '</div></div>'
      + '<div class="mono" style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:11.5px;line-height:1.7;color:var(--dim)">'
        + '<div><span style="color:var(--accent)">runtime</span>  '+((cliOptions.find(o=>o.id===d.cli)||{}).name||'—')+'</div>'
        + '<div><span style="color:var(--accent)">llm</span>      '+esc((MODELS[d.cli]||MODELS.custom).llm)+'</div>'
        + '<div><span style="color:var(--accent)">model</span>    '+(esc(d.model)||'auto')+'</div>'
        + '<div><span style="color:var(--accent)">name</span>     '+(esc(d.name.trim())||'unnamed')+'</div>'
        + '<div><span style="color:var(--accent)">role</span>     '+(esc(d.role.trim())||'—')+'</div>'
        + '<div><span style="color:var(--accent)">access</span>   '+((permOptions.find(o=>o.id===d.perms)||{}).label||'—')+'</div>'
        + '<div><span style="color:var(--accent)">skills</span>   '+(d.skills.length?d.skills.join(', '):'none')+'</div>'
      + '</div>';
  }

  const ok=canNext();
  return '<div data-act="closeWizard" style="position:fixed;inset:0;background:rgba(15,15,20,.42);display:flex;align-items:center;justify-content:center;z-index:200;animation:ovin .16s ease">'
    + '<div data-act="stop" style="width:560px;max-width:92vw;max-height:88vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.34);animation:fadeup .22s ease">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px 0"><div style="display:flex;align-items:center;gap:9px;font-size:15.5px;font-weight:700"><span style="width:22px;height:22px;border-radius:6px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px">＋</span> New Agent</div><span data-act="closeWizard" style="cursor:pointer;color:var(--faint);font-size:20px">×</span></div>'
      + '<div style="display:flex;align-items:center;padding:18px 22px 4px">'+stepsHtml+'</div>'
      + '<div style="padding:12px 22px 6px;min-height:236px">'+bodyHtml+'</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 22px 20px;gap:10px">'
        + (st>0?'<button data-act="wizardBack" style="padding:9px 16px;background:none;border:1px solid var(--border-strong);color:var(--text);border-radius:9px;cursor:pointer;font-size:12.5px;font-weight:600">Back</button>':'')
        + '<div style="flex:1"></div>'
        + '<button id="wizardNextBtn" data-act="wizardNext" style="padding:9px 22px;background:'+(ok?'var(--accent)':'var(--border)')+';color:'+(ok?'#fff':'var(--faint)')+';border:none;border-radius:9px;cursor:'+(ok?'pointer':'not-allowed')+';font-size:12.5px;font-weight:700">'+(st>=2?'Create Agent':'Continue')+'</button>'
      + '</div>'
    + '</div>'
  + '</div>';
}

// ---- event wiring (delegação) ----
const ACTIONS={
  toggleTheme, openWizard, closeWizard, wizardBack, wizardNext,
  zoomIn, zoomOut, zoomReset, fitView,
  selectWindow:(id)=>selectWindow(id), selectAgent:(id)=>selectAgent(id), killWindow:(id)=>killWindow(id),
  activity:(id)=>setState({activeActivity:id}),
  pickCli:(id)=>{ const m=MODELS[id]; setDraft({cli:id, model: m&&m.list.length? m.list[0].id : ''}); },
  pickPerm:(id)=>setDraft({perms:id}), toggleSkill:(id)=>toggleSkill(id),
  stop:()=>{}
};
function wire(){
  const canvas=$('#canvas');
  if(canvas) canvas.onmousedown=onCanvasDown;
  document.querySelectorAll('[data-act]').forEach(el=>{
    const act=el.dataset.act, id=el.dataset.id;
    if(act==='winDrag'){ el.onmousedown=(e)=>startWinDrag(e,id); return; }
    if(act==='winResize'){ el.onmousedown=(e)=>startWinResize(e,id); return; }
    if(act==='killWindow'){ el.onmousedown=(e)=>e.stopPropagation(); el.onclick=(e)=>{ e.stopPropagation(); killWindow(id); }; return; }
    if(act==='stop'){ el.onmousedown=(e)=>e.stopPropagation(); el.onclick=(e)=>e.stopPropagation(); return; }
    if(act==='closeWizard'){ el.onclick=(e)=>{ if(e.target===el) closeWizard(); }; return; }
    el.onclick=(e)=>{ e.stopPropagation(); const fn=ACTIONS[act]; if(fn) fn(id); };
  });
  // reflete canNext() no botão Continue sem re-render (preserva o caret ao digitar o nome)
  function refreshNextBtn(){
    const b=document.getElementById('wizardNextBtn'); if(!b) return;
    const ok=canNext();
    b.style.background = ok?'var(--accent)':'var(--border)';
    b.style.color = ok?'#fff':'var(--faint)';
    b.style.cursor = ok?'pointer':'not-allowed';
  }
  document.querySelectorAll('[data-field]').forEach(inp=>{
    const set=(e)=>{ state.draft[inp.dataset.field]=e.target.value; refreshNextBtn(); }; // sem re-render: preserva foco/caret
    inp.oninput=set; inp.onchange=set; // change cobre o <select> de Model
  });
  refreshNextBtn();
}

window.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);
const canvasWheel=(e)=>{ if(Math.abs(e.deltaY)>0){ e.preventDefault(); setZoom(state.zoom*(e.deltaY<0?1.08:0.92)); } };
window.addEventListener('wheel', (e)=>{ if($('#canvas') && $('#canvas').contains(e.target)) canvasWheel(e); }, {passive:false});

// mensagens do host (extensão)
window.addEventListener('message', e=>{
  const m=e.data;
  if(m.type==='state'){
    // preserva posições em memória durante um drag (o disco pode chegar atrasado)
    const prev={}; state.windows.forEach(w=>prev[w.id]=w);
    state.windows = fromAgents(m.config);
    state.windows.forEach(w=>{ if(prev[w.id]){ w.z=prev[w.id].z; } });
    if(state.pendingFocus){ const id=state.pendingFocus; state.pendingFocus=null; render(); const w=state.windows.find(x=>x.id===id); if(w){ focusWindow(id); centerOn(id); } return; }
    render();
  } else if(m.type==='pty:out'){
    const t=Object.values(terms).find(x=>x.agentId===m.id); if(t) t.term.write(m.data);
  } else if(m.type==='pty:exit'){
    const t=Object.values(terms).find(x=>x.agentId===m.id); if(t) t.term.write('\\r\\n[processo saiu: '+m.code+']\\r\\n');
  } else if(m.type==='openWizard'){
    openWizard();
  } else if(m.type==='agentAction'){
    // ação vinda da sidebar (Iniciar/Parar/Kill) sobre um agentId
    const w=state.windows.find(x=>x.agentId===m.id);
    if(m.action==='kill'){ if(w) killWindow(w.id); }
    else if(m.action==='run'){ vscode.postMessage({type:'pty:run', id:m.id, cli:w&&w.cli}); if(w){ focusWindow(w.id); centerOn(w.id); } }
    else if(m.action==='stop'){ vscode.postMessage({type:'pty:stop', id:m.id}); }
  } else if(m.type==='spawnRequest'){
    // uma sessão pediu (via pw new) para criar outro agent em outro terminal
    const r=m.req||{};
    const id=spawnAgent({ cli:r.cli, name:r.name, dir:r.dir, role:r.prompt });
    // guarda o prompt inicial p/ enviar ao terminal filho assim que ele montar
    if(r.prompt && r.prompt.trim()){ pendingPrompts[id]=r.prompt.trim(); }
    render(); setTimeout(()=>{ const w=state.windows.find(x=>x.agentId===id); if(w){ focusWindow(w.id); centerOn(w.id); } }, 60);
  }
});

vscode.postMessage({ type:'ready' });
</script>
</body>
</html>`;
}
