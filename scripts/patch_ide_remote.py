"""
patch_ide_remote.py — Surgical patch for Antigravity IDE Environment Selector

Injects the 'Remote' option into the bottom-left chat environment dropdown
alongside 'Local' and 'New Worktree'.

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

# Helper definitions attached to global window
GLOBAL_HELPERS = '''
if(typeof window!=="undefined"&&!window.__ag_remote_initialized){
window.__ag_remote_initialized=!0;
window.__ag_open_cfg=function(){
  let m=document.getElementById("__ag_remote_config_modal");if(m)m.remove();
  let h=localStorage.getItem("ag_remote_host")||"https://pharmaceuticals-willing-warrant-pound.trycloudflare.com";
  let t=localStorage.getItem("ag_remote_token")||"";
  m=document.createElement("div");m.id="__ag_remote_config_modal";
  m.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";
  m.innerHTML='<div style="width:460px;background:#1e1e1e;border:1px solid rgba(255,255,255,0.15);border-radius:12px;box-shadow:0 20px 40px rgba(0,0,0,0.6);padding:20px;color:#e5e5e5;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><span style="font-size:20px;">☁️</span><span style="font-size:15px;font-weight:600;color:#fff;">Configuration Runtime Agent Remote (VPS)</span></div><p style="font-size:12px;color:#a3a3a3;margin:0 0 16px 0;">Configurez l\\\'accès au daemon distant <code>ag-agentd</code> sur votre VPS.</p><div style="margin-bottom:12px;"><label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Hôte / URL du Daemon (Cloudflare Ingress ou IP:Port)</label><input id="__ag_cfg_host" type="text" value="'+h+'" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" /></div><div style="margin-bottom:14px;"><label style="display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:#d4d4d4;">Jeton d\\\'authentification (Auth Token)</label><input id="__ag_cfg_token" type="password" value="'+t+'" style="width:100%;box-sizing:border-box;background:#262626;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:8px 10px;font-size:12px;color:#fff;outline:none;" /></div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;background:rgba(255,255,255,0.03);padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.07);"><button id="__ag_cfg_test" style="background:#333;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:5px;padding:5px 10px;font-size:11px;cursor:pointer;">Tester la connexion</button><span id="__ag_cfg_status" style="font-size:11px;color:#a3a3a3;">Prêt</span></div><div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;"><button id="__ag_cfg_cancel" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#ccc;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;">Annuler</button><button id="__ag_cfg_save" style="background:#2563eb;border:none;color:#fff;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:500;cursor:pointer;">Sélectionner Runtime Remote</button></div></div>';
  document.body.appendChild(m);
  let hi=m.querySelector("#__ag_cfg_host"),ti=m.querySelector("#__ag_cfg_token"),st=m.querySelector("#__ag_cfg_status");
  m.querySelector("#__ag_cfg_test").onclick=async()=>{
    st.style.color="#93c5fd";st.textContent="Test en cours...";
    try{let res=await fetch(hi.value.trim().replace(/\\/+$/,'')+"/health",{cache:"no-cache"});if(res.ok){let d=await res.json();st.style.color="#4ade80";st.textContent="● En ligne ("+(d.platform||"linux")+" / ag-agentd v"+(d.version||"2.0.0")+")"}else{st.style.color="#f87171";st.textContent="HTTP "+res.status}}catch(e){st.style.color="#f87171";st.textContent="Échec : "+(e.message||"injoignable")}
  };
  m.querySelector("#__ag_cfg_cancel").onclick=()=>m.remove();
  m.querySelector("#__ag_cfg_save").onclick=()=>{
    localStorage.setItem("ag_remote_host",hi.value.trim());localStorage.setItem("ag_remote_token",ti.value.trim());localStorage.setItem("ag_remote_configured","true");
    m.remove();if(window.__ag_set_rem)window.__ag_set_rem(!0);if(window.__ag_close_env)window.__ag_close_env(!1);window.__ag_update_pill&&window.__ag_update_pill(!0);
  };
};
window.__ag_update_pill=function(active){
  let pill=document.getElementById("__ag_remote_chat_pill");
  if(active){
    if(!pill){
      pill=document.createElement("div");pill.id="__ag_remote_chat_pill";
      pill.style.cssText="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;margin:4px 8px;background:rgba(37,99,235,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:12px;font-size:11px;color:#93c5fd;font-family:-apple-system,BlinkMacSystemFont,sans-serif;";
      pill.innerHTML='<span style="width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;"></span><span style="font-weight:500;">Runtime Agent Remote (VPS)</span><span style="opacity:0.6;font-size:10px;">62.169.27.8</span><button id="__ag_remote_pill_cfg" style="background:none;border:none;color:#93c5fd;cursor:pointer;font-size:12px;padding:0 2px;margin-left:4px;" title="Configurer">⚙️</button>';
      let target=document.querySelector('[class*="inputBox"],[id*="InputBox"],textarea,form')||document.body;
      if(target&&target.parentNode)target.parentNode.insertBefore(pill,target);
      else document.body.appendChild(pill);
      let btn=pill.querySelector("#__ag_remote_pill_cfg");
      if(btn)btn.onclick=(e)=>{e.stopPropagation();window.__ag_open_cfg();};
    }
    pill.style.display="inline-flex";
  }else{
    if(pill)pill.style.display="none";
  }
};
}
'''

# Replacement signatures
S1_OLD = ',[S,C]=ve(!1),[N,I]=ve(""),'
S1_NEW = ',[S,C]=ve(!1),[rem,setRem]=ve(!1),[N,I]=ve(""),'

S_BWN_OLD = 'case"sot":return"Local";'
S_BWN_NEW = 'case"sot":return"Local";case"remote":return"Remote";'

S2_OLD = 'let j=()=>{switch(a.type){case"sot":return f(xe,{name:"computer",size:14,className:"shrink-0"});default:return f(xe,{name:"call_split",size:14,className:"shrink-0"})}};'
S2_NEW = 'window.__ag_set_rem=setRem;window.__ag_close_env=C;let j=()=>{if(rem||a.type==="remote")return f(xe,{name:"cloud",size:14,className:"shrink-0"});switch(a.type){case"sot":return f(xe,{name:"computer",size:14,className:"shrink-0"});default:return f(xe,{name:"call_split",size:14,className:"shrink-0"})}};'

S3_OLD = 'children:[j(),f("span",{className:"select-none truncate max-w-36",children:bwn(a,n,d)}),'
S3_NEW = 'children:[j(),f("span",{className:"select-none truncate max-w-36",children:rem?"Remote (VPS)":bwn(a,n,d)}),'

S4_OLD = 'children:f($Ss,{availableResources:d,onSelectSot:l,setIsOpen:C})}),D.length>=2&&f(cn,{id:W,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"sot"})})]}),f(Dt,{children:[f("div",{"data-tooltip-id":U.length>=2?G:void 0,className:"w-full",children:f(qSs,{availableResources:d,rawResources:e.rawResources,onSelectNewCopy:o,setIsOpen:C,disabledSubtitle:r})}),U.length>=2&&f(cn,{id:G,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"copy"})})]}),'

REMOTE_ITEM = 'f(Dt,{children:[f("div",{className:"w-full",children:f(Kw,{title:"Remote",icon:f(xe,{name:"cloud",size:14,className:"mt-0.5"}),subtitle:"Remote Agent Runtime (VPS - 62.169.27.8)",selected:rem||a.type==="remote",onClick:(e)=>{if(e&&(e.shiftKey||e.altKey||!localStorage.getItem("ag_remote_configured"))){window.__ag_open_cfg&&window.__ag_open_cfg()}else{setRem(!0),C(!1),window.__ag_update_pill&&window.__ag_update_pill(!0)}}})})]})'

S4_NEW = (
    'children:f($Ss,{availableResources:d,onSelectSot:()=>{setRem(!1),window.__ag_update_pill&&window.__ag_update_pill(!1),l()},setIsOpen:C})}),D.length>=2&&f(cn,{id:W,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"sot"})})]}),f(Dt,{children:[f("div",{"data-tooltip-id":U.length>=2?G:void 0,className:"w-full",children:f(qSs,{availableResources:d,rawResources:e.rawResources,onSelectNewCopy:()=>{setRem(!1),window.__ag_update_pill&&window.__ag_update_pill(!1),o()},setIsOpen:C,disabledSubtitle:r})}),U.length>=2&&f(cn,{id:G,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"copy"})})]}),'
    + REMOTE_ITEM
    + ','
)

S5_OLD = 'onClick:()=>{i(Q.envId),C(!1)}'
S5_NEW = 'onClick:()=>{setRem(!1),window.__ag_update_pill&&window.__ag_update_pill(!1),i(Q.envId),C(!1)}'

S6_OLD = 'onClick:async()=>{C(!1),s&&await s(Q)}'
S6_NEW = 'onClick:async()=>{setRem(!1),window.__ag_update_pill&&window.__ag_update_pill(!1),C(!1),s&&await s(Q)}'


def check_status():
    if not os.path.exists(TARGET_FILE):
        print(f"ERROR: Antigravity IDE main.js not found at {TARGET_FILE}")
        return False
    with open(TARGET_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    applied = "Remote Agent Runtime (VPS - 62.169.27.8)" in content and "[rem,setRem]=ve(!1)" in content
    print(f"Status: {'PATCHED (Remote option is active)' if applied else 'UNPATCHED'}")
    return applied


def apply_patch():
    if not os.path.exists(TARGET_FILE):
        print(f"ERROR: Target file not found: {TARGET_FILE}")
        sys.exit(1)

    with open(TARGET_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if "Remote Agent Runtime (VPS - 62.169.27.8)" in content and "[rem,setRem]=ve(!1)" in content:
        print("Patch already applied. Nothing to do.")
        return

    # Create backup if not exists
    if not os.path.exists(BACKUP_FILE):
        print(f"Creating backup at {BACKUP_FILE}...")
        shutil.copy2(TARGET_FILE, BACKUP_FILE)
    else:
        print(f"Existing backup found at {BACKUP_FILE}")

    # Validate patterns
    targets = [
        ("S1", S1_OLD),
        ("S_BWN", S_BWN_OLD),
        ("S2", S2_OLD),
        ("S3", S3_OLD),
        ("S4", S4_OLD),
        ("S5", S5_OLD),
        ("S6", S6_OLD),
    ]
    for name, pattern in targets:
        if pattern not in content:
            print(f"ERROR: Target pattern {name} not found in {TARGET_FILE}")
            sys.exit(1)

    print("Applying surgical patch...")
    patched = GLOBAL_HELPERS + "\n" + content
    patched = patched.replace(S1_OLD, S1_NEW, 1)
    patched = patched.replace(S_BWN_OLD, S_BWN_NEW, 1)
    patched = patched.replace(S2_OLD, S2_NEW, 1)
    patched = patched.replace(S3_OLD, S3_NEW, 1)
    patched = patched.replace(S4_OLD, S4_NEW, 1)
    patched = patched.replace(S5_OLD, S5_NEW, 1)
    patched = patched.replace(S6_OLD, S6_NEW, 1)

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
    print("SUCCESS: Antigravity IDE patched successfully!")
    print("Please reload the Antigravity window (Developer: Reload Window) or restart the IDE.")


def revert_patch():
    if not os.path.exists(BACKUP_FILE):
        print(f"ERROR: Backup file {BACKUP_FILE} not found!")
        sys.exit(1)

    print(f"Restoring {TARGET_FILE} from backup...")
    shutil.copy2(BACKUP_FILE, TARGET_FILE)
    print("SUCCESS: Reverted Antigravity IDE to original state.")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] == "--status":
        check_status()
    elif sys.argv[1] == "--apply":
        apply_patch()
    elif sys.argv[1] == "--revert":
        revert_patch()
    else:
        print("Usage: python patch_ide_remote.py [--apply | --revert | --status]")
