// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, command errors, feature,
// activity and vehicle names), in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

const both = (en, fr) => ({ en, fr });

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  activity: both('Status', 'État'),
  'connector-status': both('Connector', 'Connecteur'),
  'charging-state': both('Charging state', 'État de charge'),
  'vehicle-status': both('Vehicle', 'Véhicule'),
  power: both('Power', 'Puissance'),
  'current-l1': both('Current L1', 'Courant L1'),
  'current-l2': both('Current L2', 'Courant L2'),
  'current-l3': both('Current L3', 'Courant L3'),
  'voltage-l1': both('Voltage L1', 'Tension L1'),
  'voltage-l2': both('Voltage L2', 'Tension L2'),
  'voltage-l3': both('Voltage L3', 'Tension L3'),
  'session-energy': both('Energy of the session', 'Énergie de la session'),
  'session-duration': both('Duration of the session', 'Durée de la session'),
  'session-cost': both('Cost of the session', 'Coût de la session'),
  'max-current': both('Maximum current', 'Courant maximal'),
  'start-session': both('Start a session', 'Démarrer une session'),
  'stop-session': both('Stop the session', 'Arrêter la session'),
  availability: both('Availability', 'Disponibilité'),
  reboot: both('Reboot the charge point', 'Redémarrer la borne'),
};

export const ACTIVITY_NAMES = {
  available: both('Available', 'Disponible'),
  charging: both('Charging', 'En charge'),
  unavailable: both('Blocked', 'Bloquée'),
  error: both('Error', 'Erreur'),
  offline: both('Offline', 'Hors ligne'),
  unknown: both('Unknown', 'Inconnu'),
};

export const VEHICLE_NAMES = {
  standby: both('No vehicle', 'Aucun véhicule'),
  vehicle_detected: both('Vehicle connected', 'Véhicule branché'),
  ready: both('Vehicle ready to charge', 'Véhicule prêt à charger'),
  no_power: both('No power', 'Pas de courant'),
  vehicle_error: both('Vehicle error', 'Erreur du véhicule'),
};

export const AVAILABILITY_NAMES = {
  operative: both('Available', 'Disponible'),
  blocked: both('Blocked', 'Bloquée'),
};

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

const plural = (n, en, fr) =>
  both(`${n} ${en}${n > 1 ? 's' : ''}`, `${n} ${fr}${n > 1 ? 's' : ''}`);

export const T = {
  noToken: both(
    'Enter the API token of your Blue Current account (my.bluecurrent.nl, Advanced, Home Assistant API token).',
    "Saisissez le jeton d'API de votre compte Blue Current (my.bluecurrent.nl, Avancé, jeton d'API Home Assistant).",
  ),
  connecting: both('Connecting to Blue Current…', 'Connexion à Blue Current…'),
  connected: (count) => {
    const points = plural(count, 'charge point', 'borne');
    return both(
      `Connected to Blue Current: ${points.en}. Open Discovery to add them.`,
      `Connecté à Blue Current : ${points.fr}. Ouvrez Découverte pour les ajouter.`,
    );
  },
  noChargePoint: both(
    'Connected to Blue Current, but the account has no charge point.',
    "Connecté à Blue Current, mais le compte n'a aucune borne.",
  ),
  refused: (wait) =>
    both(
      `Blue Current refused the API token: create a new one and save it in the configuration. One new try in ${wait.en}, or click "Test the connection".`,
      `Blue Current a refusé le jeton d'API : créez-en un nouveau et enregistrez-le dans la configuration. Nouvel essai dans ${wait.fr}, ou cliquez sur « Tester la connexion ».`,
    ),
  rateLimited: (wait) =>
    both(
      `The daily request limit of Blue Current is reached: it is reset at midnight (Amsterdam time). Connecting again in ${wait.en}.`,
      `La limite quotidienne de requêtes de Blue Current est atteinte : elle repart à minuit (heure d'Amsterdam). Nouvelle connexion dans ${wait.fr}.`,
    ),
  tooMany: (wait) =>
    both(
      `Blue Current asks to slow down (HTTP 429). Connecting again in ${wait.en}.`,
      `Blue Current demande de ralentir (HTTP 429). Nouvelle connexion dans ${wait.fr}.`,
    ),
  alreadyConnected: (wait) =>
    both(
      `Blue Current says this connection is already open elsewhere (another Gladys, a Home Assistant?). New try in ${wait.en}.`,
      `Blue Current indique que cette connexion est déjà ouverte ailleurs (un autre Gladys, un Home Assistant ?). Nouvel essai dans ${wait.fr}.`,
    ),
  unreachable: (wait) =>
    both(
      `Blue Current cannot be reached. New try in ${wait.en}.`,
      `Blue Current est injoignable. Nouvel essai dans ${wait.fr}.`,
    ),
  lost: (wait) =>
    both(
      `The connection to Blue Current was lost. Connecting again in ${wait.en}.`,
      `La connexion à Blue Current a été perdue. Nouvelle connexion dans ${wait.fr}.`,
    ),
  test: {
    cooldown: both('Tested less than 30 s ago.', 'Testé il y a moins de 30 s.'),
    waiting: both(
      'Still connecting to Blue Current: look at the status in a minute.',
      'Connexion à Blue Current en cours : regardez le statut dans une minute.',
    ),
  },
};

/** Errors of the commands, shown by Gladys when a command is refused. */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  disabled: both(
    'Commands are not allowed: turn on "Allow the commands" in the configuration.',
    'Les commandes ne sont pas autorisées : activez « Autoriser les commandes » dans la configuration.',
  ),
  rebootDisabled: both(
    'Rebooting is not allowed: turn on "Allow rebooting the charge point" in the configuration.',
    "Le redémarrage n'est pas autorisé : activez « Autoriser le redémarrage de la borne » dans la configuration.",
  ),
  invalidValue: both('Invalid value.', 'Valeur invalide.'),
  notConnected: both('Not connected to Blue Current.', 'Non connecté à Blue Current.'),
  unknownChargePoint: both(
    'This charge point is not on the Blue Current account.',
    "Cette borne n'est pas sur le compte Blue Current.",
  ),
  stillRunning: both(
    'Another command is still running: try again in a few seconds.',
    'Une autre commande est en cours : réessayez dans quelques secondes.',
  ),
  tooSlow: both(
    'Blue Current answered too slowly: the command was not sent. Try again.',
    "Blue Current a répondu trop lentement : la commande n'a pas été envoyée. Réessayez.",
  ),
  unknownState: both(
    'The state of the charge point could not be read: the command was not sent.',
    "L'état de la borne n'a pas pu être lu : la commande n'a pas été envoyée.",
  ),
  notSent: both(
    'The connection to Blue Current is closed: the command was not sent.',
    "La connexion à Blue Current est fermée : la commande n'a pas été envoyée.",
  ),
  offline: both(
    'The charge point is offline: the command was not sent.',
    "La borne est hors ligne : la commande n'a pas été envoyée.",
  ),
  inError: both(
    'The charge point is in error: the command was not sent.',
    "La borne est en erreur : la commande n'a pas été envoyée.",
  ),
  blocked: both(
    'The charge point is blocked: make it available first. The command was not sent.',
    "La borne est bloquée : rendez-la d'abord disponible. La commande n'a pas été envoyée.",
  ),
  noVehicle: both(
    'No vehicle ready on the charge point: plug in the vehicle first. The command was not sent.',
    "Aucun véhicule prêt sur la borne : branchez d'abord le véhicule. La commande n'a pas été envoyée.",
  ),
  noCard: both(
    'Blue Current gives no default charge card for this charge point: the session cannot be started from Gladys.',
    'Blue Current ne donne aucune carte de recharge par défaut pour cette borne : la session ne peut pas être démarrée depuis Gladys.',
  ),
  refused: both('Blue Current refused the command.', 'Blue Current a refusé la commande.'),
  receivedNoResult: both(
    'Command sent and received by Blue Current, without a result from the charge point yet: the state will follow.',
    "Commande envoyée et reçue par Blue Current, sans résultat de la borne pour l'instant : l'état suivra.",
  ),
  timedOut: both(
    'Command sent and received, without a result from the charge point: the state will follow.',
    "Commande envoyée et reçue, sans résultat de la borne : l'état suivra.",
  ),
  sentNoConfirmation: both(
    'Command sent, without confirmation from Blue Current: the state will follow.',
    "Commande envoyée, sans confirmation de Blue Current : l'état suivra.",
  ),
};
