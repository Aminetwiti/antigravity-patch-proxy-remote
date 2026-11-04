/**
 * types/view.ts
 *
 * Contrat standardisé pour toutes les vues du Renderer (SOLID - Liskov & Interface Segregation).
 * Déclaré en mode ambient script pour être disponible dans tout le projet Renderer.
 */

interface IDisposable {
  dispose(): void;
}

type LifecycleHook = () => Promise<void> | void;

interface IView {
  /** Identifiant unique de la vue (ex: 'dashboard', 'logs', 'traffic') */
  readonly id: string;

  /** Titre ou libellé de la vue */
  readonly title?: string;

  /** Initialisation unique au démarrage ou premier chargement */
  init?(container?: HTMLElement): Promise<void> | void;

  /** Cycle de vie : appelé lors de l'activation / affichage de la vue */
  mount(): Promise<void> | void;

  /** Cycle de vie : appelé lors du départ de la vue (nettoyage timers, listeners) */
  unmount?(): Promise<void> | void;

  /** Rafraîchissement des données de la vue */
  refresh?(): Promise<void> | void;
}

type IViewController = IView;

type ViewFactory = () => IView;

if (typeof exports !== 'undefined') {
  // ambient types only
}
