/**
 * ag-doctor UI — Features module (Axe 1 + Axe 2)
 * Installation Detector and Real-time Proxy Monitor.
 * Self-contained; reads window.ag bridge; safe to load after app.js.
 *
 * Wrapped in an IIFE so top-level declarations don't collide with app.ts
 * (both files are compiled as scripts and share the renderer global scope).
 */
(function () {
  "use strict";

  type InstallationCandidate = {
    path: string;
    exists: boolean;
    version?: "v1" | "v2" | "unknown";
    productName?: string;
    pid?: number;
    port?: number;
    recommended?: boolean;
    reason?: string;
    conflict?: boolean;
  };

  type ProxyStats = {
    running: boolean;
    port?: number;
    uptimeSec?: number;
    latencyMs?: number;
    requests?: number;
    errors?: number;
    lastError?: string;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Axe 1 — Installation Detector
  // ─────────────────────────────────────────────────────────────────────────────

  const installGrid = () => document.getElementById("installDetectorGrid");
  const installSummary = () => document.getElementById("installDetectorSummary");
  const installBadge = () => document.getElementById("installDetectorBadge");

  function renderInstallCard(c: InstallationCandidate): HTMLElement {
    const card = document.createElement("div");
    card.className = "install-card" + (c.recommended ? " recommended" : "");

    const head = document.createElement("div");
    head.className = "install-card-head";
    const pill = document.createElement("span");
    const ver = c.version || "unknown";
    pill.className = "install-version-pill " + (ver === "v2" ? "v2" : ver === "v1" ? "v1" : "");
    pill.textContent = (c.productName || "Antigravity") + " · " + ver.toUpperCase();
    head.appendChild(pill);
    card.appendChild(head);

    const pathEl = document.createElement("div");
    pathEl.className = "install-path";
    pathEl.textContent = c.path;
    card.appendChild(pathEl);

    const meta = document.createElement("div");
    meta.className = "install-meta";
    if (typeof c.pid === "number") {
      const it = document.createElement("span");
      it.className = "install-meta-item";
      it.textContent = "PID " + c.pid;
      meta.appendChild(it);
    }
    if (typeof c.port === "number") {
      const it = document.createElement("span");
      it.className = "install-meta-item" + (c.conflict ? " warn" : " ok");
      it.textContent = "Port " + c.port + (c.conflict ? " (conflict)" : "");
      meta.appendChild(it);
    }
    if (c.exists) {
      const it = document.createElement("span");
      it.className = "install-meta-item ok";
      it.textContent = "present";
      meta.appendChild(it);
    } else {
      const it = document.createElement("span");
      it.className = "install-meta-item warn";
      it.textContent = "missing";
      meta.appendChild(it);
    }
    card.appendChild(meta);

    if (c.reason) {
      const r = document.createElement("div");
      r.className = "install-reason";
      r.textContent = c.reason;
      card.appendChild(r);
    }
    return card;
  }

  async function runInstallScan(): Promise<void> {
    const grid = installGrid();
    const summary = installSummary();
    const badge = installBadge();
    if (!grid || !summary) return;

    summary.textContent = "Scanning installations…";
    grid.innerHTML = '<div class="skeleton-card skeleton-target"></div><div class="skeleton-card skeleton-target"></div>';

    try {
      const bridge = (window as any).ag;
      if (!bridge || typeof bridge.detectInstallation !== "function") {
        summary.textContent = "Bridge unavailable: window.ag.detectInstallation() is missing.";
        grid.innerHTML = "";
        return;
      }
      const result = await bridge.detectInstallation();
      const candidates: InstallationCandidate[] = Array.isArray(result?.candidates)
        ? result.candidates
        : Array.isArray(result) ? result : [];

      grid.innerHTML = "";
      if (candidates.length === 0) {
        summary.textContent = "No Antigravity installations detected on this device.";
        return;
      }

      const hasConflict = candidates.some((c) => c.conflict);
      if (badge) {
        badge.hidden = !hasConflict;
        badge.textContent = hasConflict ? "conflict" : "ok";
        badge.className = "badge " + (hasConflict ? "badge-warn" : "badge-ok");
      }

      const recommended = candidates.filter((c) => c.recommended).length;
      summary.textContent =
        candidates.length + " installation(s) detected" +
        (recommended ? `, ${recommended} recommended` : "") +
        (hasConflict ? " — version conflict between ports." : ".");

      candidates
        .sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended))
        .forEach((c) => grid.appendChild(renderInstallCard(c)));
    } catch (err: any) {
      summary.textContent = "Scan failed: " + (err?.message || String(err));
      grid.innerHTML = "";
    }
  }

  function wireInstallDetector(): void {
    const btn = document.getElementById("installDetectorScanBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      btn.setAttribute("disabled", "true");
      runInstallScan().finally(() => btn.removeAttribute("disabled"));
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Axe 2 — Real-time Proxy Monitor
  // ─────────────────────────────────────────────────────────────────────────────

  let _proxyLatencyEl: HTMLElement | null = null;
  let _proxyStatusEl: HTMLElement | null = null;
  let _proxyUptimeEl: HTMLElement | null = null;
  let _proxySparkLine: SVGPolylineElement | null = null;
  let _proxyBadge: HTMLElement | null = null;
  let _proxyToggleBtn: HTMLButtonElement | null = null;

  function getProxyElements() {
    if (!_proxyLatencyEl) _proxyLatencyEl = document.getElementById("proxyLatency");
    if (!_proxyStatusEl) _proxyStatusEl = document.getElementById("proxyStatus");
    if (!_proxyUptimeEl) _proxyUptimeEl = document.getElementById("proxyUptime");
    if (!_proxySparkLine) _proxySparkLine = document.getElementById("proxySparkLine") as unknown as SVGPolylineElement | null;
    if (!_proxyBadge) _proxyBadge = document.getElementById("proxyMonitorBadge");
    if (!_proxyToggleBtn) _proxyToggleBtn = document.getElementById("proxyMonitorToggleBtn") as HTMLButtonElement | null;
    return {
      latency: _proxyLatencyEl,
      status: _proxyStatusEl,
      uptime: _proxyUptimeEl,
      sparkLine: _proxySparkLine,
      badge: _proxyBadge,
      toggleBtn: _proxyToggleBtn,
    };
  }

  const proxyLatencyEl = () => getProxyElements().latency;
  const proxyStatusEl = () => getProxyElements().status;
  const proxyUptimeEl = () => getProxyElements().uptime;
  const proxySparkLine = () => getProxyElements().sparkLine;
  const proxyBadge = () => getProxyElements().badge;
  const proxyToggleBtn = () => getProxyElements().toggleBtn;

  const SPARK_MAX = 60;
  const sparkBuffer: number[] = [];

  function pushSpark(value: number): void {
    sparkBuffer.push(value);
    if (sparkBuffer.length > SPARK_MAX) sparkBuffer.shift();
    const line = proxySparkLine();
    if (!line) return;
    const w = 200;
    const h = 40;
    const max = Math.max(50, ...sparkBuffer);
    const min = Math.min(0, ...sparkBuffer);
    const range = Math.max(1, max - min);
    const pts = sparkBuffer
      .map((v, i) => {
        const x = (i / Math.max(1, SPARK_MAX - 1)) * w;
        const y = h - ((v - min) / range) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    line.setAttribute("points", pts);
  }

  function formatUptimeSec(sec?: number): string {
    if (typeof sec !== "number" || !isFinite(sec) || sec < 0) return "—";
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${ss}s`;
    return `${ss}s`;
  }

  let proxyTimer: number | null = null;
  let proxyRunning = false;

  async function pollProxy(): Promise<void> {
    const bridge = (window as any).ag;
    if (!bridge || typeof bridge.proxyStats !== "function") return;
    try {
      const stats: ProxyStats = await bridge.proxyStats();
      const latEl = proxyLatencyEl();
      const statEl = proxyStatusEl();
      const upEl = proxyUptimeEl();
      const badge = proxyBadge();

      if (latEl) {
        latEl.textContent = typeof stats.latencyMs === "number" ? `${stats.latencyMs} ms` : "—";
        latEl.className =
          "proxy-stat-value" +
          (typeof stats.latencyMs === "number" && stats.latencyMs < 500
            ? " ok"
            : stats.latencyMs && stats.latencyMs > 1500
            ? " err"
            : "");
      }
      if (statEl) {
        statEl.textContent = stats.running
          ? `Running${typeof stats.port === "number" ? " on port " + stats.port : ""}`
          : "Stopped";
        statEl.className = "proxy-stat-value" + (stats.running ? " ok" : " err");
      }
      if (upEl) upEl.textContent = formatUptimeSec(stats.uptimeSec);

      if (badge) {
        badge.hidden = !stats.running;
        badge.textContent = stats.running ? "live" : "idle";
        badge.className = "badge " + (stats.running ? "badge-ok" : "badge-warn");
      }
      if (typeof stats.latencyMs === "number") pushSpark(stats.latencyMs);
    } catch {
      /* swallow — keep polling so transient errors self-heal */
    }
  }

  function startProxyMonitor(): void {
    if (proxyRunning) return;
    proxyRunning = true;
    const btn = proxyToggleBtn();
    if (btn) btn.textContent = "Stop monitoring";
    const badge = proxyBadge();
    if (badge) {
      badge.hidden = false;
      badge.textContent = "live";
      badge.className = "badge badge-ok";
    }
    pollProxy();
    proxyTimer = window.setInterval(pollProxy, 1500);
  }

  function stopProxyMonitor(): void {
    proxyRunning = false;
    if (proxyTimer !== null) {
      window.clearInterval(proxyTimer);
      proxyTimer = null;
    }
    const btn = proxyToggleBtn();
    if (btn) btn.textContent = "Start monitoring";
    const badge = proxyBadge();
    if (badge) {
      badge.hidden = false;
      badge.textContent = "idle";
      badge.className = "badge badge-warn";
    }
  }

  function wireProxyMonitor(): void {
    const btn = proxyToggleBtn();
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (proxyRunning) stopProxyMonitor();
      else startProxyMonitor();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────────────────────────────────────

  function boot(): void {
    wireInstallDetector();
    wireProxyMonitor();
    // Auto-scan once the info view becomes visible.
    const infoView = document.getElementById("view-info");
    if (infoView) {
      const obs = new MutationObserver(() => {
        if (infoView.classList.contains("active")) {
          runInstallScan();
          obs.disconnect();
        }
      });
      obs.observe(infoView, { attributes: true, attributeFilter: ["class"] });
      if (infoView.classList.contains("active")) runInstallScan();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/**
 * ag-doctor UI � Failure Scenarios Showcase Auto-Wire
 * Renders the visual showcase of all known provider error cards when the
 * "Failure Scenarios" view becomes active. Lazy, idempotent.
 */
(function () {
  "use strict";
  const VIEW_SEL = "#view-failures";
  const TARGET_SEL = "#failureScenarioShowcase";

  function bootShowcase() {
    const view = document.querySelector(VIEW_SEL);
    const target = document.querySelector(TARGET_SEL);
    if (!view || !target) return;

    const render = () => {
      // Lazy-load via the global bridge; safe to call multiple times.
      const w = window as unknown as { AgFailureShowcase?: { renderFailureScenariosShowcase: (s?: string) => number } };
      if (w.AgFailureShowcase && typeof w.AgFailureShowcase.renderFailureScenariosShowcase === "function") {
        w.AgFailureShowcase.renderFailureScenariosShowcase(TARGET_SEL);
      }
    };

    if (view.classList.contains("active")) render();

    document.body.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      const btn = t.closest('.nav-item[data-view="failures"]');
      if (btn) setTimeout(render, 30);
    });

    const refreshBtn = document.getElementById("openFailureShowcaseBtn2");
    if (refreshBtn) refreshBtn.addEventListener("click", render);

    // Filter chips
    const chips = Array.from(document.querySelectorAll(".agy-filter-chip"));
    if (chips.length) {
      chips.forEach((chip) => {
        chip.addEventListener("click", () => {
          chips.forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
          const filter = chip.getAttribute("data-filter") || "all";
          render();
          if (target) {
            Array.from(target.children).forEach((el) => {
              const id = (el as HTMLElement).getAttribute("data-scenario-id") || "";
              (el as HTMLElement).style.display = filter === "all" || id === filter ? "" : "none";
            });
          }
        });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootShowcase);
  } else {
    bootShowcase();
  }
})();
