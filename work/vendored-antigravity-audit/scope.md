# Case Scope

## meta
- case_id: vendored-antigravity-audit
- created: 2026-09-02T17:20:59.9584784+01:00
- operator: local
- project_root: C:\Users\amine\Downloads\antigravity-add-model-main\antigravity-add-model-main
- primary_skill: reverse-engineering/SKILL.md
- primary_id: R0
- lead_role: lead
- specialist_roles: []
- hint: Analyze vendored Antigravity 2.11.0 language_server binary patch and app.asar
- preset: offline-sample

## auth
- status: granted
- basis: own_system
- evidence_of_auth: preset:offline-sample (owner-operated local file)
- MUST NOT proceed if status != granted

## in_scope
- assets:
  - C:\Users\amine\Downloads\antigravity-add-model-main\antigravity-add-model-main\remote\vendor\antigravity\resources\bin\language_server.exe
- surfaces: []
- activities: []

## out_of_scope
- assets: []
- activities: [dos, phishing_real_users, unrestricted_exfil]

## network_profile
- mode: offline
- notes: |
    offline | lab_only | authorized_target_only | unrestricted_lab
    Change mode only after auth.status = granted.

## deliverables
- report: true
- field_journal: true
- diagrams: true
- timeline: true

## constraints
- timebox: {}
- stealth: low
- data_handling: anonymize

## signoff
- ready_for_act: true
- checklist:
  - [x] auth.status = granted
  - [x] in_scope.assets non-empty OR offline sample path set
  - [x] network_profile.mode chosen
  - [ ] out_of_scope reviewed
  - [ ] roles assigned (see skills/ops/role-map.md)

## ops_refs
- skills/ops/scope-contract.md
- skills/ops/evidence-finding-path.md
- skills/ops/role-map.md
- skills/ops/timeline-workitem.md
- skills/ops/IDENTITY.md