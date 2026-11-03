/**
 * types/view.ts
 *
 * Contrat standardisé pour toutes les vues du Renderer (SOLID - Liskov & Interface Segregation).
 * Permet un couplage faible entre le routeur de navigation et les contrôleurs de page.
 */

export interface IView {
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

export type ViewFactory = () => IView;
