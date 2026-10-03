# Floutons

Masquage des visages dans les vidéos, entièrement dans le navigateur. Aucun fichier vidéo n’est envoyé à un serveur.

## Hébergement Cloudflare Pages

- Branche de production : `main`
- Framework : aucun
- Commande de build : laisser vide
- Dossier de sortie : `dist`
- Domaine : `floutons.com`

## Développement local

`python -m http.server 8765 --directory dist`

Ouvrir http://localhost:8765 dans Chrome ou Edge récent.

## Fonctionnement

CenterFace via ONNX Runtime détecte les visages. Le suivi conserve les masques pendant les brèves pertes de détection. Les corrections manuelles peuvent suivre plusieurs positions dans le temps. Mediabunny traite chaque image à l’export puis conserve les timestamps et la cadence de la source. Le son est facultatif ; la résolution d’origine est proposée par défaut.

Limites : 3 minutes et 200 Mo. Vérifier la vidéo exportée avant de la partager : la détection automatique peut manquer des visages. Les dépendances, le modèle et leurs licences sont dans `dist/assets`; voir `dist/licenses.txt`.
