# Module MTI

Logiciel de gestion des médicaments de thérapies innovantes (MTI) — parcours
chronologique complet, de la réception du matériel de leucaphérèse au suivi
post-administration, avec la traçabilité exigée par les BPP.

Création de la base pas à pas (CapRover et local) :
[docs/deploiement-base.md](docs/deploiement-base.md).

## Démarrage rapide

```bash
# 1. Base de données
docker compose up -d db

# 2. Schéma et référentiels
export DATABASE_URL=postgresql://postgres:mti_dev@localhost:5432/mti
npm --prefix api install
npm --prefix api run migrer
npm --prefix api run seed        # affiche le DEV_UTILISATEUR_ID à reporter

# 3. API
export DEV_UTILISATEUR_ID=<valeur affichée ci-dessus>
npm --prefix api start

# 4. Front (dans un autre terminal)
npm --prefix web install
npm --prefix web run dev         # http://localhost:5173
```

Le front fonctionne aussi sans API : il bascule sur les référentiels embarqués
et affiche un bandeau « Mode hors-ligne ».

## Organisation du dépôt

```
shared/         Référentiels — source unique de vérité (front + seed de la base)
db/             Schéma SQL, rôles, tests d'invariants
api/            API Fastify + PostgreSQL
web/            Front Vue 3
docs/
  architecture.md    Décisions structurantes et arbitrages
  reference/         Maquettes HTML d'origine, conservées à l'identique
```

## Vérifications

```bash
psql -d mti -v ON_ERROR_STOP=1 -f db/tests/test_invariants.sql   # 14 invariants du schéma
npm --prefix api run test:e2e                                    # API de bout en bout
npm --prefix web run test:navigateur                             # parcours en navigateur
```

## Branches

| Branche | Rôle |
|---|---|
| `main` | Code stable et validé |
| `test` | Développement et recette |

## Avant toute mise en service

Trois points bloquants, détaillés dans [docs/architecture.md](docs/architecture.md) :

1. **Hébergement HDS** — les données identifiantes patient relèvent de
   l'article L1111-8 CSP. L'arbitrage conditionne le mode de déploiement.
2. **Authentification** — le double contrôle pharmacien exige deux identités
   authentifiées. L'API refuse de démarrer en production sans SSO.
3. **Persistance hors-ligne** — la réception d'un MTI est un acte sous
   contrainte de temps et ne peut pas dépendre du réseau. La lecture
   hors-ligne fonctionne, l'écriture différée reste à faire.
