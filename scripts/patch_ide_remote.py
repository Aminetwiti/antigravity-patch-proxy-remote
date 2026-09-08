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

# Replacement signatures
S1_OLD = ',[S,C]=ve(!1),[N,I]=ve(""),'
S1_NEW = ',[S,C]=ve(!1),[rem,setRem]=ve(!1),[N,I]=ve(""),'

S_BWN_OLD = 'case"sot":return"Local";'
S_BWN_NEW = 'case"sot":return"Local";case"remote":return"Remote";'

S2_OLD = 'let j=()=>{switch(a.type){case"sot":return f(xe,{name:"computer",size:14,className:"shrink-0"});default:return f(xe,{name:"call_split",size:14,className:"shrink-0"})}};'
S2_NEW = 'let j=()=>{if(rem||a.type==="remote")return f(xe,{name:"cloud",size:14,className:"shrink-0"});switch(a.type){case"sot":return f(xe,{name:"computer",size:14,className:"shrink-0"});default:return f(xe,{name:"call_split",size:14,className:"shrink-0"})}};'

S3_OLD = 'children:[j(),f("span",{className:"select-none truncate max-w-36",children:bwn(a,n,d)}),'
S3_NEW = 'children:[j(),f("span",{className:"select-none truncate max-w-36",children:rem?"Remote":bwn(a,n,d)}),'

S4_OLD = 'children:f($Ss,{availableResources:d,onSelectSot:l,setIsOpen:C})}),D.length>=2&&f(cn,{id:W,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"sot"})})]}),f(Dt,{children:[f("div",{"data-tooltip-id":U.length>=2?G:void 0,className:"w-full",children:f(qSs,{availableResources:d,rawResources:e.rawResources,onSelectNewCopy:o,setIsOpen:C,disabledSubtitle:r})}),U.length>=2&&f(cn,{id:G,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"copy"})})]}),'

REMOTE_ITEM = 'f(Dt,{children:[f("div",{className:"w-full",children:f(Kw,{title:"Remote",icon:f(xe,{name:"cloud",size:14,className:"mt-0.5"}),subtitle:"Remote Agent (62.169.27.8)",selected:rem||a.type==="remote",onClick:()=>{setRem(!0);try{let u=localStorage.getItem("ag_remote_url")||"https://pharmaceuticals-willing-warrant-pound.trycloudflare.com/console?token=4d8b9f1a2c3e5a7b0e2f4a6c8d1e3b5a7c9e1f3a5b7d9f1a3c5e7b9d1f3a5b7d";window.open(u,"_blank")}catch(err){console.error(err)}C(!1)}})})]}),'

S4_NEW = (
    'children:f($Ss,{availableResources:d,onSelectSot:()=>{setRem(!1),l()},setIsOpen:C})}),D.length>=2&&f(cn,{id:W,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"sot"})})]}),f(Dt,{children:[f("div",{"data-tooltip-id":U.length>=2?G:void 0,className:"w-full",children:f(qSs,{availableResources:d,rawResources:e.rawResources,onSelectNewCopy:()=>{setRem(!1),o()},setIsOpen:C,disabledSubtitle:r})}),U.length>=2&&f(cn,{id:G,place:"right",noFade:!0,children:f(sSt,{resources:d,mode:"copy"})})]}),'
    + REMOTE_ITEM
)

S5_OLD = 'onClick:()=>{i(Q.envId),C(!1)}'
S5_NEW = 'onClick:()=>{setRem(!1),i(Q.envId),C(!1)}'

S6_OLD = 'onClick:async()=>{C(!1),s&&await s(Q)}'
S6_NEW = 'onClick:async()=>{setRem(!1),C(!1),s&&await s(Q)}'


def check_status():
    if not os.path.exists(TARGET_FILE):
        print(f"ERROR: Antigravity IDE main.js not found at {TARGET_FILE}")
        return False
    with open(TARGET_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    applied = "Remote Agent (62.169.27.8)" in content and "[rem,setRem]=ve(!1)" in content
    print(f"Status: {'PATCHED (Remote option is active)' if applied else 'UNPATCHED'}")
    return applied


def apply_patch():
    if not os.path.exists(TARGET_FILE):
        print(f"ERROR: Target file not found: {TARGET_FILE}")
        sys.exit(1)

    with open(TARGET_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if "Remote Agent (62.169.27.8)" in content:
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
    patched = content.replace(S1_OLD, S1_NEW, 1)
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
