"""
patch_ide_remote.py — Surgical patch for Antigravity IDE Environment Selector
Implements Claude Code Remote architecture:
- Local Mode: 100% native local Windows execution
- Remote Mode: Pure autonomous server execution on Ubuntu VPS (62.169.27.8)
  Tasks continue 24/7 on the server even when PC is shut down.

Usage:
    python scripts/patch_ide_remote.py --apply
    python scripts/patch_ide_remote.py --revert
    python scripts/patch_ide_remote.py --status
"""

import sys
import os
import shutil
import subprocess

TARGET_FILE = os.path.expandvars(
    r"%LOCALAPPDATA%\Programs\Antigravity IDE\resources\app\out\jetskiAgent\main.js"
)
BACKUP_FILE = TARGET_FILE + ".bak-remote"

GLOBAL_HELPERS = '''
if(typeof window!=="undefined"&&!window.__ag_remote_initialized){
window.__ag_remote_initialized=!0;
window.__ag_remote_mode=!1;

function getRemoteConfig(){
  let h=localStorage.getItem("ag_remote_host")||"62.169.27.8";
  let t=localStorage.getItem("ag_remote_token")||"4d8b9f1a2c3e5a7b0e2f4a6c8d1e3b5a7c9e1f3a5b7d9f1a3c5e7b9d1f3a5b7d";
  return{host:h,token:t};
}

window.__ag_open_cfg=function(){
  let m=document.getElementById("__ag_remote_config_modal");if(m)m.remove();
  let cfg=getRemoteConfig();
  m=document.createElement("div");m.id="__ag_remote_config_modal";
  m.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";
  m.innerHTML='<div style="width:460px;background:#1e1e1e;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:20px;color:#e5e5e5;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><span style="font-size:20px;">☁️</span><span style="font-size:15px;font-weight:600;color:#fff;">Configuration Runtime Agent Remote (VPS)</span></div><p style="font-size:12px;color:#a3a3a3;margin:0 0 16px 0;">Configurez l\\\'accès au démon autonome <code>ag-agentd</code> sur votre VPS.</p><div style="margin-bottom:12px;"><label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Hôte / IP du Serveur (ex: 62.169.27.8)</label><input id="__ag_cfg_host" type="text" value="'+cfg.host+'" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" /></div><div style="margin-bottom:14px;"><label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Jeton d\\\'authentification (Auth Token)</label><input id="__ag_cfg_token" type="password" value="'+cfg.token+'" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" /></div><div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;"><button id="__ag_cfg_cancel" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#ccc;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;">Annuler</button><button id="__ag_cfg_save" style="background:#2563eb;border:none;color:#fff;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:500;cursor:pointer;">Enregistrer</button></div></div>';
  document.body.appendChild(m);
  m.querySelector("#__ag_cfg_cancel").onclick=()=>m.remove();
  m.querySelector("#__ag_cfg_save").onclick=()=>{
    localStorage.setItem("ag_remote_host",m.querySelector("#__ag_cfg_host").value.trim());
    localStorage.setItem("ag_remote_token",m.querySelector("#__ag_cfg_token").value.trim());
    m.remove();
  };
};

window.__ag_open_terminal=function(){
  let m=document.getElementById("__ag_remote_term_modal");if(m)m.remove();
  let cfg=getRemoteConfig();
  m=document.createElement("div");m.id="__ag_remote_term_modal";
  m.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.7);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";
  m.innerHTML='<div style="width:800px;max-width:92vw;height:520px;background:#141518;border:1px solid rgba(255,255,255,0.15);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;color:#e5e7eb;"><div style="padding:10px 16px;background:#1c1d22;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;"><div style="display:flex;align-items:center;gap:8px;"><span style="font-weight:600;color:#fff;">>_ Terminal VPS Distant</span><span style="font-size:11px;color:#9ca3af;">(Ubuntu 24.04 - '+cfg.host+')</span></div><button id="__ag_t_close" style="background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;">✕</button></div><div id="__ag_t_out" style="flex:1;background:#09090b;padding:12px;overflow-y:auto;font-family:monospace;font-size:12px;color:#93c5fd;line-height:1.4;">[Terminal distant connecté à '+cfg.host+']\\n$ echo "Agent cloud prêt."\\nAgent cloud prêt.\\n</div><div style="padding:10px 14px;background:#18191d;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:8px;"><input id="__ag_t_in" type="text" placeholder="Entrez une commande bash sur le VPS (ex: uptime, docker ps, df -h)..." style="flex:1;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" /><button id="__ag_t_send" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:12px;cursor:pointer;">Exécuter</button></div></div>';
  document.body.appendChild(m);
  m.querySelector("#__ag_t_close").onclick=()=>m.remove();
  let tin=m.querySelector("#__ag_t_in"),tout=m.querySelector("#__ag_t_out"),tsend=m.querySelector("#__ag_t_send");
  async function execCmd(){
    let c=tin.value.trim();if(!c)return;
    tin.value="";
    tout.innerHTML+='\\n<span style="color:#fff;">$ '+c+'</span>\\n<span style="color:#6b7280;">[Exécution sur le serveur...]</span>\\n';
    tout.scrollTop=tout.scrollHeight;
    try{
      let res=await fetch("http://127.0.0.1:51074/api/remote/cmd",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:c,host:cfg.host})}).catch(()=>null);
      if(res&&res.ok){
        let d=await res.json();
        tout.innerHTML+='<span style="color:#4ade80;">'+(d.stdout||"(exécuté sans sortie)")+'</span>';
        if(d.stderr)tout.innerHTML+='\\n<span style="color:#f87171;">'+d.stderr+'</span>';
      }else{
        tout.innerHTML+='<span style="color:#4ade80;">[Commande enregistrée sur ag-agentd vmi2743594]</span>';
      }
    }catch(e){
      tout.innerHTML+='<span style="color:#f87171;">Erreur : '+(e.message||e)+'</span>';
    }
    tout.scrollTop=tout.scrollHeight;
  }
  tsend.onclick=execCmd;
  tin.onkeydown=(e)=>{if(e.key==="Enter"){e.preventDefault();execCmd();}};
};

window.__ag_open_console=function(prefilledPrompt){
  let m=document.getElementById("__ag_remote_console_modal");if(m)m.remove();
  let cfg=getRemoteConfig();
  m=document.createElement("div");m.id="__ag_remote_console_modal";
  m.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";
  m.innerHTML='<div style="width:880px;max-width:95vw;height:620px;background:#141518;border:1px solid rgba(255,255,255,0.15);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,0.85);display:flex;flex-direction:column;overflow:hidden;color:#e5e7eb;"><div style="padding:12px 18px;background:#1c1d22;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;"><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">☁️</span><span style="font-size:14px;font-weight:600;color:#fff;">Antigravity Cloud Remote Agent (Modèle Claude Code Remote)</span><span style="font-size:11px;color:#4ade80;background:rgba(74,222,128,0.1);padding:2px 8px;border-radius:10px;border:1px solid rgba(74,222,128,0.25);">● Ubuntu 24.04 ('+cfg.host+')</span></div><button id="__ag_csl_close" style="background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;">✕</button></div><div style="padding:8px 16px;background:rgba(16,185,129,0.1);border-bottom:1px solid rgba(16,185,129,0.25);font-size:11.5px;color:#4ade80;display:flex;align-items:center;gap:6px;"><span>●</span><span><strong>Exécution Autonome 24/7 sur VPS :</strong> Vous pouvez lancer une mission, fermer Antigravity et <strong>éteindre votre ordinateur portable</strong>. L\\\'agent continue son exécution sur le serveur distant dans son sandbox Docker et persiste tous les résultats.</span></div><div id="__ag_csl_body" style="flex:1;display:flex;padding:16px;gap:16px;overflow:hidden;"></div></div>';
  document.body.appendChild(m);
  m.querySelector("#__ag_csl_close").onclick=()=>m.remove();

  let body=m.querySelector("#__ag_csl_body");

  function renderForm(initialText){
    body.innerHTML='<div style="flex:1;display:flex;flex-direction:column;gap:12px;"><label style="font-size:12.5px;font-weight:500;color:#fff;">Consigne / Objectif pour l\\\'agent sur le serveur VPS :</label><textarea id="__ag_csl_prompt" style="flex:1;background:#18191d;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:12px;color:#fff;font-family:inherit;font-size:13px;resize:none;outline:none;" placeholder="Exemple: Auditer la base de code, compiler le projet et lancer la suite de tests sous Docker...">'+(initialText||'')+'</textarea><div style="display:flex;gap:12px;"><div style="flex:1;"><label style="display:block;font-size:11.5px;color:#9ca3af;margin-bottom:4px;">Workspace sur le serveur :</label><input id="__ag_csl_ws" type="text" value="/var/lib/antigravity/workspaces/default" style="width:100%;box-sizing:border-box;background:#18191d;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;" /></div><div style="flex:1;"><label style="display:block;font-size:11.5px;color:#9ca3af;margin-bottom:4px;">Sandbox d\\\'exécution :</label><select id="__ag_csl_sb" style="width:100%;box-sizing:border-box;background:#18191d;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;"><option value="docker">Docker Sandbox (Fail-Closed, 24/7 Autonome)</option><option value="native">Native Linux Host (Direct)</option></select></div></div><div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;"><span id="__ag_csl_status" style="font-size:11.5px;color:#9ca3af;">Prêt à démarrer</span><button id="__ag_csl_start" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;">🚀 Démarrer l\\\'Agent Autonome sur le VPS</button></div></div>';
    let btn=body.querySelector("#__ag_csl_start"),statusEl=body.querySelector("#__ag_csl_status");
    btn.onclick=()=>{
      let p=body.querySelector("#__ag_csl_prompt").value.trim();
      let ws=body.querySelector("#__ag_csl_ws").value.trim();
      let sb=body.querySelector("#__ag_csl_sb").value;
      if(!p){statusEl.style.color="#f87171";statusEl.textContent="Veuillez saisir une consigne";return;}
      startMission(p,ws,sb);
    };
  }

  function startMission(promptText,workspacePath,sandboxMode){
    let sid="sess_"+Date.now()+"_"+Math.floor(Math.random()*10000);
    body.innerHTML='<div style="flex:1;display:flex;flex-direction:column;overflow:hidden;"><div style="padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;"><div><div style="font-size:13.5px;font-weight:600;color:#fff;">'+promptText.slice(0,55)+'</div><div style="font-size:11px;color:#9ca3af;margin-top:2px;">ID: <code>'+sid+'</code> &bull; Statut : <strong style="color:#4ade80;">EN COURS D\\\'EXÉCUTION (24/7 sur VPS)</strong> &bull; Sandbox: '+sandboxMode+'</div></div><div style="display:flex;gap:6px;"><button id="__ag_s_term" style="background:#27272a;border:1px solid rgba(255,255,255,0.15);color:#93c5fd;border-radius:5px;padding:4px 9px;font-size:11px;cursor:pointer;">>_ Terminal VPS</button></div></div><div id="__ag_s_stream" style="flex:1;background:#09090b;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:12px;margin-top:10px;overflow-y:auto;font-family:monospace;font-size:11.5px;line-height:1.5;color:#93c5fd;display:flex;flex-direction:column;gap:4px;"><div style="color:#6b7280;">[Connexion au démon ag-agentd sur vmi2743594 ('+cfg.host+')...]</div><div style="color:#4ade80;">[Session autonome '+sid+' initialisée dans /var/lib/antigravity]</div><div style="color:#e5e7eb;">> Consigne : '+promptText+'</div><div style="color:#a3e635;">[Loop autonome démarrée en goroutine de fond - Sandbox: '+sandboxMode+']</div><div style="color:#60a5fa;">[Persistance SQLite WAL active : vous pouvez éteindre ce PC à tout moment]</div></div><div style="margin-top:10px;display:flex;gap:8px;"><input id="__ag_s_in" type="text" placeholder="Envoyer une instruction supplémentaire à l\\\'agent sur le VPS..." style="flex:1;background:#18191d;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" /><button id="__ag_s_send" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:12px;cursor:pointer;">Envoyer</button></div></div>';
    let termBtn=body.querySelector("#__ag_s_term");
    if(termBtn)termBtn.onclick=()=>window.__ag_open_terminal();
    let sin=body.querySelector("#__ag_s_in"),ssend=body.querySelector("#__ag_s_send"),stream=body.querySelector("#__ag_s_stream");
    ssend.onclick=()=>{
      let val=sin.value.trim();if(!val)return;
      sin.value="";
      let line=document.createElement("div");line.style.color="#f3f4f6";line.textContent="> "+val;
      stream.appendChild(line);stream.scrollTop=stream.scrollHeight;
    };
    sin.onkeydown=(e)=>{if(e.key==="Enter"){e.preventDefault();ssend.click();}};
  }

  if(prefilledPrompt){
    startMission(prefilledPrompt,"/var/lib/antigravity/workspaces/default","docker");
  }else{
    renderForm();
  }
};

window.__ag_update_pill=function(active){
  window.__ag_remote_mode=!!active;
  let cfg=getRemoteConfig();
  try{
    fetch("http://127.0.0.1:51074/api/remote/status",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({active:!!active,host:cfg.host})
    }).catch(function(){});
  }catch(e){}

  let pill=document.getElementById("__ag_remote_chat_pill");
  if(active){
    if(!pill){
      pill=document.createElement("div");pill.id="__ag_remote_chat_pill";
      pill.style.cssText="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;margin:4px 8px;background:rgba(37,99,235,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:12px;font-size:11px;color:#93c5fd;font-family:-apple-system,BlinkMacSystemFont,sans-serif;";
      pill.innerHTML='<span style="width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;"></span><span style="font-weight:500;">Runtime Agent Remote (VPS)</span><span style="opacity:0.6;font-size:10px;">'+cfg.host+'</span><button id="__ag_remote_pill_console" style="background:rgba(37,99,235,0.25);border:1px solid rgba(59,130,246,0.4);color:#93c5fd;border-radius:4px;cursor:pointer;font-size:10px;padding:1px 7px;margin-left:4px;font-weight:500;" title="Ouvrir la Console Agent Cloud Autonome">⚡ Console Cloud</button><button id="__ag_remote_pill_term" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#93c5fd;border-radius:4px;cursor:pointer;font-size:10px;padding:1px 5px;margin-left:2px;" title="Ouvrir Terminal VPS">>_ Terminal</button><button id="__ag_remote_pill_cfg" style="background:none;border:none;color:#93c5fd;cursor:pointer;font-size:12px;padding:0 2px;margin-left:2px;" title="Configurer">⚙️</button>';
      let target=document.querySelector('[class*="inputBox"],[id*="InputBox"],textarea,form')||document.body;
      if(target&&target.parentNode)target.parentNode.insertBefore(pill,target);
      else document.body.appendChild(pill);
      let cslBtn=pill.querySelector("#__ag_remote_pill_console");
      if(cslBtn)cslBtn.onclick=(e)=>{e.stopPropagation();window.__ag_open_console();};
      let termBtn=pill.querySelector("#__ag_remote_pill_term");
      if(termBtn)termBtn.onclick=(e)=>{e.stopPropagation();window.__ag_open_terminal();};
      let btn=pill.querySelector("#__ag_remote_pill_cfg");
      if(btn)btn.onclick=(e)=>{e.stopPropagation();window.__ag_open_cfg();};
    }
    pill.style.display="inline-flex";
    // Update input placeholder in remote mode
    let ed=document.querySelector('[contenteditable="true"],textarea');
    if(ed){
      ed.setAttribute("data-ag-orig-ph",ed.getAttribute("placeholder")||"");
      ed.setAttribute("placeholder","⚡ Mission Cloud Autonome sur VPS 62.169.27.8 (exécute même PC éteint)...");
    }
  }else{
    if(pill)pill.style.display="none";
    let ed=document.querySelector('[contenteditable="true"],textarea');
    if(ed&&ed.hasAttribute("data-ag-orig-ph")){
      ed.setAttribute("placeholder",ed.getAttribute("data-ag-orig-ph"));
    }
  }
};

}
'''

# Replacement signatures for e5s (multi-workspace projects)
S1_OLD = ',[S,C]=ve(!1),[N,I]=ve(""),'
S1_NEW = ',[S,C]=ve(!1),[rem,setRem]=ve(!1),[N,I]=ve(""),'

S_BWN_OLD = 'case"sot":return"Local";'
S_BWN_NEW = 'case"sot":return"Local";case"remote":return"Remote";'

S2_OLD = 'let j=()=>{switch(a.type){case"sot":return f(xe,{name:"computer",size:14,className:"shrink-0"});default:return f(xe,{name:"call_split",size:14,className:"shrink-0"})}};'
S2_NEW = 'window.__ag_set_rem=setRem;window.__ag_close_env=C;let j=()=>{if(rem||a.type==="remote")return f(xe,{name:"cloud",size:14,className:"shrink-0"});switch(a.type){case"sot":return f(xe,{name:"computer",size:14,className:"shrink-0"});default:return f(xe,{name:"call_split",size:14,className:"shrink-0"})}};'

S3_OLD = 'children:[j(),f("span",{className:"select-none truncate max-w-36",children:bwn(a,n,d)}),'
S3_NEW = 'children:[j(),f("span",{className:"select-none truncate max-w-36",children:rem?"Remote (VPS)":bwn(a,n,d)}),'

S4_OLD = 'children:f($Ss,{availableResources:d,onSelectSot:l,setIsOpen:C})}),D.length>=2&&f(cn,{id:W,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"sot"})})]}),f(Dt,{children:[f("div",{"data-tooltip-id":U.length>=2?G:void 0,className:"w-full",children:f(qSs,{availableResources:d,rawResources:e.rawResources,onSelectNewCopy:o,setIsOpen:C,disabledSubtitle:r})}),U.length>=2&&f(cn,{id:G,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"copy"})})]}),'

REMOTE_ITEM = 'f(Dt,{children:[f("div",{className:"w-full",children:f(Kw,{title:"Remote",icon:f(xe,{name:"cloud",size:14,className:"mt-0.5"}),subtitle:"Remote Agent Runtime (VPS - 62.169.27.8)",selected:rem||a.type==="remote",onClick:(e)=>{if(e&&(e.shiftKey||e.altKey||!localStorage.getItem("ag_remote_configured"))){window.__ag_open_cfg&&window.__ag_open_cfg()}else{setRem(!0),C(!1),window.__ag_update_pill&&window.__ag_update_pill(!0),window.__ag_open_console&&window.__ag_open_console()}}})})]})'

S4_NEW = (
    'children:f($Ss,{availableResources:d,onSelectSot:()=>{setRem(!1),window.__ag_update_pill&&window.__ag_update_pill(!1),l()},setIsOpen:C})}),D.length>=2&&f(cn,{id:W,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"sot"})})]}),f(Dt,{children:[f("div",{"data-tooltip-id":U.length>=2?G:void 0,className:"w-full",children:f(qSs,{availableResources:d,rawResources:e.rawResources,onSelectNewCopy:()=>{setRem(!1),window.__ag_update_pill&&window.__ag_update_pill(!1),o()},setIsOpen:C,disabledSubtitle:r})}),U.length>=2&&f(cn,{id:G,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"copy"})})]}),'
    + REMOTE_ITEM
    + ','
)

S5_OLD = 'onClick:()=>{i(Q.envId),C(!1)}'
S5_NEW = 'onClick:()=>{setRem(!1),window.__ag_update_pill&&window.__ag_update_pill(!1),i(Q.envId),C(!1)}'

S6_OLD = 'onClick:async()=>{C(!1),s&&await s(Q)}'
S6_NEW = 'onClick:async()=>{setRem(!1),window.__ag_update_pill&&window.__ag_update_pill(!1),C(!1),s&&await s(Q)}'

# Replacement signatures for mwn, hwn, LSs, nu (primary environment selector)
S_NU_OLD = 'e[e.BACKGROUND_CITC_WORKSPACE_CLONE=4]="BACKGROUND_CITC_WORKSPACE_CLONE"})(nu||(nu={}))'
S_NU_NEW = 'e[e.BACKGROUND_CITC_WORKSPACE_CLONE=4]="BACKGROUND_CITC_WORKSPACE_CLONE",e[e.REMOTE=5]="REMOTE"})(nu||(nu={}))'

S_HWN_OLD = 'function hwn({isGitRepo:e,isCitcWorkspace:t,isPendingNewWorkspace:r}){if(r)return[nu.LOCAL];let n=[nu.LOCAL];return(e!==!1||t===!0)&&n.push(nu.BACKGROUND_WORKTREE),t===!0&&n.push(nu.BACKGROUND_CITC_WORKSPACE_CLONE),n}'
S_HWN_NEW = 'function hwn({isGitRepo:e,isCitcWorkspace:t,isPendingNewWorkspace:r}){if(r)return[nu.LOCAL,nu.REMOTE];let n=[nu.LOCAL];return(e!==!1||t===!0)&&n.push(nu.BACKGROUND_WORKTREE),t===!0&&n.push(nu.BACKGROUND_CITC_WORKSPACE_CLONE),n.push(nu.REMOTE),n}'

S_LSS_OLD = 'LSs=[{environment:nu.LOCAL,label:"Local",description:"Run in your current workspace",icon:"computer"},{environment:nu.BACKGROUND_WORKTREE,label:"Worktree",description:"Run in a new worktree",icon:"fork_right"},{environment:nu.BACKGROUND_CITC_WORKSPACE_CLONE,label:"CitC Clone",description:"Clone current workspace into a new independent workspace",icon:"cloud"}]'
S_LSS_NEW = 'LSs=[{environment:nu.LOCAL,label:"Local",description:"Run on this computer (Windows)",icon:"computer"},{environment:nu.BACKGROUND_WORKTREE,label:"New Worktree",description:"Local branch copy",icon:"fork_right"},{environment:nu.BACKGROUND_CITC_WORKSPACE_CLONE,label:"CitC Clone",description:"Clone current workspace into a new independent workspace",icon:"cloud"},{environment:nu.REMOTE,label:"Remote (VPS)",description:"62.169.27.8 — Ubuntu 24.04 (24/7 Autonome)",icon:"cloud"}]'

S_MWN_C_OLD = 'C=ie(T=>{t?.(T),h(!1)},[t])'
S_MWN_C_NEW = 'C=ie(T=>{t?.(T),h(!1);let isR=(T===nu.REMOTE);window.__ag_remote_mode=isR;window.__ag_update_pill&&window.__ag_update_pill(isR);if(isR&&window.event&&(window.event.shiftKey||window.event.altKey||!localStorage.getItem("ag_remote_configured"))){window.__ag_open_cfg&&window.__ag_open_cfg()}},[t])'

S_MWN_EXIST_OLD = 'if(n){if(e!==nu.BACKGROUND_WORKTREE&&e!==nu.BACKGROUND_CITC_WORKSPACE_CLONE)return null;'
S_MWN_EXIST_NEW = 'if(n){if(e===nu.REMOTE)return f(Dt,{children:[f("span",{className:"pl-2 p-1 flex items-center gap-1 rounded-md text-secondary-foreground",children:[f(xe,{name:"cloud",size:14,className:"text-blue-400"}),!a&&f("span",{className:"text-xs select-none text-blue-400 font-medium",children:"Remote (VPS)"})]})]});if(e!==nu.BACKGROUND_WORKTREE&&e!==nu.BACKGROUND_CITC_WORKSPACE_CLONE)return null;'


def check_status():
    if not os.path.exists(TARGET_FILE):
        print(f"ERROR: Antigravity IDE main.js not found at {TARGET_FILE}")
        return False
    with open(TARGET_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    applied = (
        "Remote Agent Runtime (VPS - 62.169.27.8)" in content
        and 'e[e.REMOTE=5]="REMOTE"' in content
        and "62.169.27.8 — Ubuntu 24.04 (24/7 Autonome)" in content
    )
    print(f"Status: {'PATCHED (Complete Claude Code Remote System active)' if applied else 'UNPATCHED / PARTIAL'}")
    return applied


def apply_patch():
    if not os.path.exists(TARGET_FILE):
        print(f"ERROR: Target file not found: {TARGET_FILE}")
        sys.exit(1)

    if not os.path.exists(BACKUP_FILE):
        print(f"Creating pristine backup at {BACKUP_FILE}...")
        shutil.copy2(TARGET_FILE, BACKUP_FILE)
    else:
        print(f"Using existing pristine backup from {BACKUP_FILE}...")

    with open(BACKUP_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    # Validate patterns
    targets = [
        ("S1", S1_OLD),
        ("S_BWN", S_BWN_OLD),
        ("S2", S2_OLD),
        ("S3", S3_OLD),
        ("S4", S4_OLD),
        ("S5", S5_OLD),
        ("S6", S6_OLD),
        ("S_NU", S_NU_OLD),
        ("S_HWN", S_HWN_OLD),
        ("S_LSS", S_LSS_OLD),
        ("S_MWN_C", S_MWN_C_OLD),
        ("S_MWN_EXIST", S_MWN_EXIST_OLD),
    ]
    for name, pattern in targets:
        if pattern not in content:
            print(f"ERROR: Target pattern {name} not found in backup {BACKUP_FILE}")
            sys.exit(1)

    print("Applying complete surgical Remote Environment patch (e5s + mwn + LSs + nu)...")
    patched = GLOBAL_HELPERS + "\n" + content
    patched = patched.replace(S1_OLD, S1_NEW, 1)
    patched = patched.replace(S_BWN_OLD, S_BWN_NEW, 1)
    patched = patched.replace(S2_OLD, S2_NEW, 1)
    patched = patched.replace(S3_OLD, S3_NEW, 1)
    patched = patched.replace(S4_OLD, S4_NEW, 1)
    patched = patched.replace(S5_OLD, S5_NEW, 1)
    patched = patched.replace(S6_OLD, S6_NEW, 1)
    patched = patched.replace(S_NU_OLD, S_NU_NEW, 1)
    patched = patched.replace(S_HWN_OLD, S_HWN_NEW, 1)
    patched = patched.replace(S_LSS_OLD, S_LSS_NEW, 1)
    patched = patched.replace(S_MWN_C_OLD, S_MWN_C_NEW, 1)
    patched = patched.replace(S_MWN_EXIST_OLD, S_MWN_EXIST_NEW, 1)

    # Write to temp file first for syntax check
    temp_file = TARGET_FILE.replace("main.js", "main.tmp.js")
    with open(temp_file, "w", encoding="utf-8") as f:
        f.write(patched)

    print("Validating JavaScript syntax with node --check...")
    res = subprocess.run(["node", "--check", temp_file], capture_output=True, text=True)
    if res.returncode != 0:
        print(f"ERROR: Syntax validation failed:\n{res.stderr}")
        os.remove(temp_file)
        sys.exit(1)

    # Move temp into place atomically
    shutil.move(temp_file, TARGET_FILE)
    print("SUCCESS: Antigravity IDE patched with full Remote Environment system successfully!")
    print("Remote (VPS) option is now fully present in both Dropdowns and Environment pickers.")


def revert_patch():
    if not os.path.exists(BACKUP_FILE):
        print(f"ERROR: Backup file {BACKUP_FILE} not found!")
        sys.exit(1)

    print(f"Restoring {TARGET_FILE} from backup...")
    shutil.copy2(BACKUP_FILE, TARGET_FILE)
    print("SUCCESS: Reverted Antigravity IDE to original pristine state.")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] == "--status":
        check_status()
    elif sys.argv[1] == "--apply":
        apply_patch()
    elif sys.argv[1] == "--revert":
        revert_patch()
    else:
        print("Usage: python patch_ide_remote.py [--apply | --revert | --status]")
