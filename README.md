# Coach Sportif

App de séance d'entraînement pour iPhone, utilisable hors ligne : exercices avec photos, perf passée, objectif, saisie des séries, minuteurs de repos et d'effort.

- **App** : ce dépôt, publié avec GitHub Pages. Il ne contient aucune donnée personnelle.
- **Données** : le dépôt privé `coach-sportif-data` (`sessions/` écrites par Claude, `results/` écrites par l'app). L'app y accède avec une clé GitHub limitée à ce dépôt, gardée sur le téléphone.
- **Hors ligne** : un service worker garde l'app, les polices et les images. Les séances et résultats sont copiés sur le téléphone et synchronisés au retour du réseau.
- **Images** : [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense), servies par jsDelivr.

À chaque modification de l'app, changer `VERSION` dans `sw.js`.
