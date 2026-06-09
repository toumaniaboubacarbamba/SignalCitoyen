# SignalCitoyen / OSEA - Product Requirement Document

## Architecture Événementielle Implémentée

### 🎯 1. ROUTAGE AUTOMATIQUE (Background Task)
**Déclencheur** : Création d'un ticket via `POST /api/reports`

**Logique** :
1. Extraction de la zone depuis l'adresse (Cocody, Yopougon, Plateau, etc.)
2. Mapping type → service technique (water → EAU, drainage → ASSAINISSEMENT, etc.)
3. Génération de l'ID équipe : `EQUIPE_{SERVICE}_{ZONE}` (ex: `EQUIPE_EAU_COCODY`)
4. Détection priorité : water/drainage → `urgent_critique`, sinon `normal`
5. Transition statut : `received` → `assigned`
6. Notification SMS simulée à l'équipe terrain

**Code** : `router_automatiquement()` dans `/app/backend/server.py`

### 🔔 2. SYSTÈME DE NOTIFICATIONS SYNC
**Déclencheur** : Changement de statut via `PUT /api/reports/{id}`

**Logique** :
- `→ assigned` : SMS simulé à l'équipe terrain (log + audit)
- `→ resolved` : Email simulé au citoyen avec récapitulatif complet
- `→ tout` : Push notification au citoyen via Emergent Push Service

**Audit log** : Tous les événements sont persistés dans `notification_events` MongoDB

**Endpoint admin** : `GET /api/admin/notification-events` pour visualiser l'historique

### ⏰ 3. ESCALADE AUTOMATIQUE (APScheduler)
**Déclencheur** : Cron job toutes les 15 minutes (AsyncIOScheduler)

**Logique** :
1. Scan des tickets `type in [water, drainage]`
2. Filtre `status in [received, assigned]`
3. Âge > 4 heures
4. Pas encore escaladé (`escalated != true`)
5. Mise à jour atomique : `priority = urgent_critique`, `escalated = true`
6. Alerte au Superviseur Général (log d'erreur + persistance)

**Code** : `task_escalade_tickets_critiques()` lancée automatiquement au startup

## Architecture Backend

```
FastAPI + MongoDB + APScheduler
├── BackgroundTasks (pattern event-driven)
├── AsyncIOScheduler (cron jobs)
├── httpx AsyncClient (push notifications)
└── motor (async MongoDB)
```

## Endpoints API

### Auth
- `POST /api/auth/register` - Inscription
- `POST /api/auth/login` - Connexion
- `GET /api/auth/me` - Profil

### Signalements
- `POST /api/reports` - Créer + routage auto en background
- `GET /api/reports` - Liste (avec filtres status/type/priority)
- `GET /api/reports/{id}` - Détails
- `PUT /api/reports/{id}` - Maj statut + notifications

### Admin
- `GET /api/reports/stats/summary` - Stats complètes
- `GET /api/admin/notification-events` - Audit log

### Push
- `POST /api/register-push` - Enregistrement device

## Statuts du Cycle de Vie

| Statut | Label FR | Trigger |
|--------|----------|---------|
| `received` | En attente | Création |
| `assigned` | Assigné | Auto-routage |
| `processing` | En cours | Manuel admin |
| `resolved` | Résolu | Manuel admin → Email citoyen |

## Priorités

| Priorité | Label | Source |
|----------|-------|--------|
| `normal` | Normale | Par défaut |
| `urgent_critique` | URGENT CRITIQUE | Auto (water/drainage) ou Escalade |

## Frontend - Écrans

1. **Connexion/Inscription** - Auth
2. **Accueil** - Dashboard avec stats (admin) + actions rapides
3. **Nouveau signalement** - Formulaire complet GPS + photos
4. **Carte** - Leaflet OpenStreetMap avec pins colorés par statut
5. **Historique** - Liste filtrée par statut/type
6. **🆕 Admin** - Tableau de bord avec :
   - Stats détaillées (7 KPI dont urgents/escaladés)
   - Filtres avancés (statut + urgent uniquement)
   - **Vraie table responsive** (ID, Date, Type, Lieu, Statut, Actions) sur écran large
   - Cartes compactes sur mobile
   - Bouton "Détails" pour ouvrir le ticket complet
   - Visualisation des escalades (badge URGENT rouge)
7. **Détail signalement** - Vue complète + maj statut admin
8. **Profil** - Info user + déconnexion

## Tests Backend
- **22/22 tests passent (100%)**
- Couverture : Auth, Reports CRUD, Auto-routage, Notifications, Scheduler, RBAC
- Suite : `/app/backend/tests/test_event_driven.py`

## Comptes de Test
- Citoyen : `citoyen@test.com` / `password123`
- Admin : `admin@test.com` / `admin123`

## Mocks en Développement
- **EMERGENT_PUSH_KEY=placeholder** → Push réelles désactivées (activées au déploiement)
- **SMS/Email** → Logs + persistance audit (intégration Twilio/SendGrid à brancher en prod)
- **Superviseur Général** → Log d'erreur structuré (à brancher Slack/Email réel en prod)

## Améliorations Futures Possibles
- Carte de chaleur des incidents par quartier
- Assignation manuelle d'équipe par l'admin
- Réassignation entre équipes
- SLA dynamique par type d'incident
- Export CSV des tickets/audit log
- Intégration Twilio (SMS réels) + SendGrid (emails réels)
- Webhook Slack pour alertes superviseur
