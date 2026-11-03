/**
 * nav-router.ts — Application navigation router.
 * Manages tab switching, active view state, and view loader registration (Open/Closed Principle).
 */


type ViewLoader = () => void | Promise<void>;

const viewLoaders = new Map<string, ViewLoader>();
let activeViewName = 'dashboard';

function registerViewLoader(viewName: string, loader: ViewLoader): void {
  viewLoaders.set(viewName, loader);
}

function getCurrentView(): string {
  return activeViewName;
}

function loadFailures(): void {
  const w = window as unknown as { AgFailureShowcase?: { renderFailureScenariosShowcase: (s?: string) => number; wireShowcaseAutoRender: () => void } };
  if (w.AgFailureShowcase?.wireShowcaseAutoRender) {
    w.AgFailureShowcase.wireShowcaseAutoRender();
  }
  if (w.AgFailureShowcase?.renderFailureScenariosShowcase) {
    w.AgFailureShowcase.renderFailureScenariosShowcase('#failureScenarioShowcase');
  }
}

function navigate(viewName: string): void {
  activeViewName = viewName;
  const navItems = $$<HTMLButtonElement>('.nav-item');
  const views = $$<HTMLDivElement>('.view');

  navItems.forEach((n) => {
    const isActive = n.dataset.view === viewName;
    n.classList.toggle('active', isActive);
    n.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  views.forEach((v) => v.classList.toggle('active', v.id === `view-${viewName}`));

  // Invoke registered view loader if available
  const loader = viewLoaders.get(viewName);
  if (loader) {
    void loader();
  } else if (viewName === 'failures') {
    loadFailures();
  }
}

// Make navigate globally accessible on window for HTML onclick / IPC handlers
if (typeof window !== 'undefined') {
  (window as any).navigate = navigate;
  (window as any).registerViewLoader = registerViewLoader;
}

function initNavigation(): void {
  const navItems = $$<HTMLButtonElement>('.nav-item');
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v) navigate(v);
    });
  });

  // Sidebar CTA "Run doctor" button
  const sidebarRunBtn = $('#sidebarRunBtn') as HTMLButtonElement;
  if (sidebarRunBtn) {
    sidebarRunBtn.addEventListener('click', () => {
      navigate('doctor');
      const runBtn = document.querySelector<HTMLButtonElement>('#runDoctorBtn, #doctorRunBtn');
      if (runBtn) runBtn.click();
    });
  }

  // Preload bridge IPC navigation listener
  if (typeof window !== 'undefined' && (window as any).ag?.onNavigate) {
    (window as any).ag.onNavigate((view: string) => {
      navigate(view);
    });
  }
}
