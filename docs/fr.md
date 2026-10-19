# Blue Current

Affiche vos bornes **Blue Current** (Pays-Bas, Belgique) dans Gladys, en
temps réel, par l'API officielle que Blue Current propose pour la domotique
(celle de son intégration Home Assistant).

**Jamais testée avec un vrai compte** : cette intégration a été écrite à
partir de la bibliothèque que Blue Current publie pour Home Assistant, et
testée seulement sur des réponses simulées. Sans lien avec Blue Current.

## Ce que vous obtenez

Un appareil Gladys par borne, avec :

- **État** : disponible, en charge, bloquée, erreur, hors ligne ;
- **Connecteur** et **état de charge** (les fonctionnalités « borne de
  recharge » de Gladys) ;
- **Véhicule** : aucun véhicule, véhicule branché, prêt à charger, erreur ;
- **Puissance** (W), **courant** et **tension** par phase (L1, L2, L3) ;
- **Énergie de la session** (kWh), **durée de la session** (minutes),
  **coût de la session** (€, quand Blue Current le donne : il documente
  cette valeur comme désactivée pour l'instant), **courant maximal** (A).

Et, seulement si vous les autorisez (voir plus bas) :

- **Démarrer une session** et **Arrêter la session** (boutons) ;
- **Disponibilité** (une liste : disponible / bloquée), pour bloquer ou
  débloquer la borne ;
- **Redémarrer la borne** (un bouton), derrière son option à part.

Les commandes sont des boutons et une liste, jamais des interrupteurs : un
« éteins tout » d'un assistant vocal ou d'une scène ne peut pas les atteindre.

## Créer le jeton d'API

1. Connectez-vous au portail conducteur de Blue Current,
   [my.bluecurrent.nl](https://my.bluecurrent.nl), avec le compte de votre
   borne.
2. Ouvrez les paramètres, puis **Avancé** (« Advanced »), et créez le
   **jeton d'API Home Assistant** (« Home Assistant API token »).
   (L'application Blue Current le propose peut-être aussi ; non vérifié.)
3. Copiez le jeton.

## Configuration

1. Dans Gladys, ouvrez l'intégration, collez le jeton dans **Jeton d'API
   Blue Current**, enregistrez. Le jeton est gardé par Gladys dans sa base,
   jamais réaffiché, et envoyé seulement à Blue Current.
2. Le statut indique combien de bornes Blue Current liste. Ouvrez l'onglet
   **Découverte** et ajoutez-les.
3. Pour utiliser les commandes, activez **Autoriser les commandes**
   (démarrer, arrêter, bloquer, débloquer) et, à part, **Autoriser le
   redémarrage de la borne**. Les deux sont désactivées par défaut.

## Bon à savoir

- **Une seule connexion** : Blue Current envoie les changements, rien n'est
  interrogé en boucle. Une connexion perdue revient seule, après quelques
  secondes puis de plus en plus espacé (jusqu'à 10 minutes).
- **Limite quotidienne de requêtes** : Blue Current limite les requêtes par
  jour. Une fois atteinte, l'intégration attend minuit (heure d'Amsterdam)
  avant de se reconnecter, même après un redémarrage.
- **« Déjà ouverte ailleurs »** : Blue Current peut refuser une deuxième
  connexion (un autre Gladys, un Home Assistant sur le même compte).
  L'intégration attend alors au moins deux minutes entre deux essais.
- **« Ralentissez » (HTTP 429)** : l'intégration attend le temps que Blue
  Current demande (entre 1 minute et 6 heures, 15 minutes s'il ne dit rien),
  même après un redémarrage.
- **Jeton refusé** : quand Blue Current refuse le jeton, ou refuse la
  connexion moins de 30 minutes après l'avoir accepté, l'intégration s'arrête
  et réessaie au bout de 6 heures, puis toutes les 24 heures. Enregistrez un
  nouveau jeton, ou cliquez sur **Tester la connexion**, pour réessayer tout
  de suite.
- **Comment l'intégration se présente** : l'API Blue Current demande à
  chaque client son type dans son premier message (`HELLO`). L'intégration
  envoie `homeassistant`, la seule valeur que Blue Current documente (celle
  de la bibliothèque qu'il publie pour Home Assistant), et n'en essaie jamais
  d'autre ; son propre nom, `gladys-blue-current` et sa version, figure dans
  le User-Agent de la connexion.
- **Commandes** : avant chacune, l'état de la borne est relu ; la commande
  est refusée s'il ne peut pas être lu ou si la borne est hors ligne. Rien
  n'est envoyé s'il n'y a rien à faire (démarrer pendant une charge, arrêter
  sans véhicule, bloquer une borne déjà bloquée) : Gladys affiche alors un
  succès. Une session n'est démarrée qu'avec un véhicule branché (sinon
  « branchez d'abord le véhicule »), avec la carte de recharge par défaut de
  la borne, telle que Blue Current la donne. Une commande à la fois, sauf
  **Arrêter la session**, qui n'attend jamais. Gladys attend 5 secondes : si
  Blue Current n'a pas confirmé d'ici là, Gladys affiche « Commande envoyée,
  sans confirmation » (ou « envoyée et reçue, sans résultat de la borne ») :
  la commande a pu être exécutée, l'état suivra.
- **Redémarrage** : la borne redémarre et une session en cours est coupée.
- La puissance est la somme, sur les phases, de la tension par le courant
  (l'intégration Home Assistant affiche une estimation un peu différente).
- **Pas encore géré** : charge intelligente, « plug and charge », cartes
  liées seulement, choix de la carte de recharge, état du réseau (charge du
  bâtiment).

## Confidentialité

L'intégration ne parle qu'à Blue Current (`wss://motown.bluecurrent.nl`).
Elle n'écrit jamais le jeton dans les journaux. Dans `/data`, elle garde
seulement la fin d'une pause pour limite de requêtes et, après un refus, une
empreinte du jeton refusé avec l'heure du prochain essai.
