/**
 * nav-router.ts — Application navigation router.
 * Manages tab switching, active view state, and view lifecycle management (SOLID - LSP, OCP).
 */

type ViewLoader = () => void | Promise<void>;

const viewLoaders = new Map<string, ViewLoader>();
const registeredViewControllers = new Map<string, IView>();
const initializedViews = new Set<string>();

let activeViewName = 'dashboard';
let currentViewController: IView | null = null;

function registerViewLoader(viewName: string, loader: ViewLoader): void {
  viewLoaders.set(viewName, loader);
}

function registerViewController(controller: IView): void {
  registeredViewControllers.set(controller.id, controller);
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
  const previousViewName = activeViewName;

  // Unmount previous view controller if active (Lifecycle / Memory leak prevention)
  if (currentViewController && typeof currentViewController.unmount === 'function') {
    try {
      void currentViewController.unmount();
    } catch (err) {
      console.error(`[nav-router] Error unmounting view "${previousViewName}":`, err);
    }
  }

  activeViewName = viewName;

  if (typeof $$ !== 'undefined') {
    const navItems = $$<HTMLButtonElement>('.nav-item');
    const views = $$<HTMLDivElement>('.view');

    navItems.forEach((n) => {
      const isActive = n.dataset.view === viewName;
      n.classList.toggle('active', isActive);
      n.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    views.forEach((v) => v.classList.toggle('active', v.id === `view-${viewName}`));
  }

  // Check for modern registered IViewController
  const controller = registeredViewControllers.get(viewName);
  if (controller) {
    currentViewController = controller;
    if (!initializedViews.has(viewName)) {
      if (typeof controller.init === 'function') {
        const container = typeof document !== 'undefined' ? document.getElementById(`view-${viewName}`) || undefined : undefined;
        try {
          void controller.init(container);
        } catch (err) {
          console.error(`[nav-router] Error initializing view "${viewName}":`, err);
        }
      }
      initializedViews.add(viewName);
    }
    if (typeof controller.mount === 'function') {
      try {
        void controller.mount();
      } catch (err) {
        console.error(`[nav-router] Error mounting view "${viewName}":`, err);
      }
    }
  } else {
    currentViewController = null;
    // Invoke legacy registered view loader if available
    const loader = viewLoaders.get(viewName);
    if (loader) {
      try {
        const res = loader();
        if (res && typeof (res as any).catch === 'function') {
          (res as Promise<void>).catch((err) => {
            console.error(`[nav-router] Async error in view "${viewName}":`, err);
          });
        }
      } catch (err) {
        console.error(`[nav-router] Synchronous error loading view "${viewName}":`, err);
      }
    } else if (viewName === 'failures') {
      try {
        loadFailures();
      } catch (err) {
        console.error('[nav-router] loadFailures error:', err);
      }
    }
  }
}

// Make navigation globally accessible on window for HTML onclick / IPC handlers
if (typeof window !== 'undefined') {
  (window as any).navigate = navigate;
  (window as any).registerViewLoader = registerViewLoader;
  (window as any).registerViewController = registerViewController;
  (window as any).getCurrentView = getCurrentView;
}

function initNavigation(): void {
  if (typeof $$ !== 'undefined') {
    const navItems = $$<HTMLButtonElement>('.nav-item');
    navItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        if (v) navigate(v);
      });
    });
  }

  // Sidebar CTA "Run doctor" button
  if (typeof $ !== 'undefined') {
    const sidebarRunBtn = $('#sidebarRunBtn') as HTMLButtonElement | null;
    if (sidebarRunBtn) {
      sidebarRunBtn.addEventListener('click', () => {
        navigate('doctor');
        const runBtn = document.querySelector<HTMLButtonElement>('#runDoctorBtn, #doctorRunBtn');
        if (runBtn) runBtn.click();
      });
    }
  }

  // Preload bridge IPC navigation listener
  if (typeof window !== 'undefined' && (window as any).ag?.onNavigate) {
    (window as any).ag.onNavigate((view: string) => {
      navigate(view);
    });
  }
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, {
    navigate,
    getCurrentView,
    registerViewLoader,
    registerViewController,
    initNavigation,
  });
}
