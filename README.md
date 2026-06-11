# 🇨🇮 SignalCitoyen / OSEA

> **Application mobile de signalement citoyen** pour la gestion de la salubrité, de l'eau et de l'assainissement en Côte d'Ivoire.

---

## 📋 Sommaire

- [Aperçu](#-aperçu)
- [Architecture](#-architecture)
- [Prérequis](#-prérequis)
- [Installation locale](#-installation-locale)
- [Lancement](#-lancement)
- [Comptes de test](#-comptes-de-test)
- [Structure du projet](#-structure-du-projet)
- [API Endpoints](#-api-endpoints)
- [Déploiement](#-déploiement)

---

## 🎯 Aperçu

### Fonctionnalités côté citoyen

| Fonctionnalité | Description |
|---|---|
| 📝 **Signalement** | Création de tickets avec type, description, photos, GPS |
| 🗺️ **Carte interactive** | Visualisation de tous les signalements avec pins colorés |
| 📜 **Historique** | Liste filtrée de mes signalements (statut + type) |
| 🔔 **Notifications** | Inbox avec badges + push système natif |
| 📍 **Géolocalisation** | GPS auto + reverse geocoding (adresse) |

### Fonctionnalités côté admin/agent

| Fonctionnalité | Description |
|---|---|
| 📊 **Dashboard** | 7 KPI (total, en attente, assignés, résolus, urgents, escaladés) |
| 📋 **Table responsive** | ID, Date, Type, Lieu, Statut, Actions (Détails) |
| ✏️ **Notes admin** | Édition de notes internes par ticket |
| 🔄 **Changement de statut** | Mise à jour avec notification auto au citoyen |
| 🤖 **Routage automatique** | Assignation auto par zone + type |

### Architecture événementielle

1. **Routage auto** (Background Task) : Création → Zone détectée → Équipe assignée
2. **Notifications sync** : SMS simulé à l'équipe + Email au citoyen
3. **Escalade auto** (Cron 15 min) : Tickets critiques > 4h → URGENT CRITIQUE

---

## 🏗️ Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│  Expo Frontend  │  HTTPS  │  FastAPI Backend │         │   MongoDB    │
│  (React Native) │ ──────► │   (Python 3.11)  │ ──────► │              │
│  Port: 3000     │         │   Port: 8001     │         │  Port: 27017 │
└─────────────────┘         └──────────────────┘         └──────────────┘
                                     │
                                     ├──► APScheduler (cron escalade 15min)
                                     ├──► httpx → Emergent Push Service
                                     └──► Background Tasks (routage auto)
```

**Stack technique :**
- **Frontend** : Expo SDK 54, React Native, Expo Router, axios
- **Backend** : FastAPI, motor (MongoDB async), APScheduler, bcrypt, JWT
- **Base de données** : MongoDB 4.4+

---

## 📦 Prérequis

Installer les versions suivantes sur votre machine :

| Outil | Version | Installation |
|---|---|---|
| **Node.js** | ≥ 18.x | https://nodejs.org/ |
| **Yarn** | ≥ 1.22 | `npm install -g yarn` |
| **Python** | 3.11+ | https://www.python.org/downloads/ |
| **pip** | latest | `python -m ensurepip --upgrade` |
| **MongoDB** | 4.4+ | https://www.mongodb.com/try/download/community |
| **Expo Go** (mobile) | latest | Play Store / App Store |

### Vérifier les installations
```bash
node --version    # v18.x.x ou plus
yarn --version    # 1.22.x
python --version  # 3.11.x
mongod --version  # 4.4+
```

---

## 🚀 Installation locale

### 1. Cloner le projet
```bash
git clone <votre-repo-url>
cd signalcitoyen
```

### 2. Configurer le Backend

```bash
cd backend

# Créer un environnement virtuel Python (recommandé)
python -m venv venv

# Activer l'environnement
# Sur Linux/Mac :
source venv/bin/activate
# Sur Windows :
venv\Scripts\activate

# Installer les dépendances
pip install -r requirements.txt
```

#### Créer le fichier `.env` du backend

```bash
# /app/backend/.env
MONGO_URL="mongodb://localhost:27017"
DB_NAME="signalcitoyen"
EMERGENT_PUSH_KEY=placeholder
SECRET_KEY=changer-en-production-utiliser-une-cle-securisee-aleatoire-64char
```

> ⚠️ En production, générer une `SECRET_KEY` avec : `python -c "import secrets; print(secrets.token_urlsafe(64))"`

### 3. Configurer le Frontend

```bash
cd ../frontend

# Installer les dépendances
yarn install
```

#### Créer le fichier `.env` du frontend

```bash
# /app/frontend/.env
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
EXPO_PACKAGER_HOSTNAME=localhost
EXPO_PACKAGER_PROXY_URL=http://localhost:3000
```

> 💡 Pour tester sur appareil physique : remplacer `localhost` par l'IP locale de votre machine (ex: `192.168.1.10`).

### 4. Démarrer MongoDB

```bash
# Linux/Mac (si installé via brew/apt)
mongod --dbpath /path/to/data

# Ou avec Docker (plus simple)
docker run -d -p 27017:27017 --name mongo mongo:7
```

---

## ▶️ Lancement

### Terminal 1 — Backend
```bash
cd backend
source venv/bin/activate  # ou venv\Scripts\activate sur Windows
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Le backend démarre sur `http://localhost:8001`. Vérifier dans le navigateur :
- Documentation API : http://localhost:8001/docs
- API root : http://localhost:8001/api/reports/stats/summary (401 attendu sans token)

### Terminal 2 — Frontend
```bash
cd frontend
yarn expo start
```

Une fois Metro lancé, vous verrez :
- 📱 **QR code** : à scanner avec **Expo Go** (mobile)
- 🌐 **Web** : taper `w` dans le terminal → ouvre http://localhost:8081
- 🍏 **iOS Simulator** : taper `i` (macOS uniquement)
- 🤖 **Android Emulator** : taper `a`

### Première utilisation : créer les comptes

Aller sur l'app → écran inscription, créer deux comptes :
- **Citoyen** : `citoyen@test.com` / `password123` / nom: Jean Dupont
- **Admin** : nécessite création manuelle (voir ci-dessous)

#### Créer un compte admin
Comme les inscriptions créent par défaut un rôle `citizen`, créer un admin via MongoDB :

```bash
# Option 1 : Inscription via l'app puis promotion manuelle dans MongoDB
mongosh
use signalcitoyen
db.users.updateOne(
  { email: "admin@test.com" },
  { $set: { role: "admin" } }
)
```

Ou via curl directement à l'API :
```bash
curl -X POST http://localhost:8001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"admin123","name":"Admin Test","role":"admin"}'
```

---

## 🔐 Comptes de test

| Rôle | Email | Mot de passe |
|---|---|---|
| 👤 Citoyen | `citoyen@test.com` | `password123` |
| 👨‍💼 Admin | `admin@test.com` | `admin123` |

---

## 📁 Structure du projet

```
signalcitoyen/
├── backend/
│   ├── server.py              # FastAPI app + routes + scheduler
│   ├── tests/                 # Tests pytest
│   ├── requirements.txt       # Dépendances Python
│   └── .env                   # Config (gitignored)
│
├── frontend/
│   ├── app/                   # Routes Expo Router
│   │   ├── _layout.tsx        # Layout racine + AuthProvider
│   │   ├── index.tsx          # Splash + redirection
│   │   ├── auth/
│   │   │   ├── login.tsx
│   │   │   └── register.tsx
│   │   ├── (tabs)/            # Navigation par onglets
│   │   │   ├── _layout.tsx    # Tabs + badge notifications
│   │   │   ├── home.tsx       # Accueil
│   │   │   ├── new-report.tsx # Création signalement
│   │   │   ├── map.tsx        # Carte Leaflet
│   │   │   ├── history.tsx    # Historique + filtres
│   │   │   ├── notifications.tsx # Inbox citoyen
│   │   │   ├── admin.tsx      # Dashboard admin (table)
│   │   │   └── profile.tsx
│   │   └── report-detail/
│   │       └── [id].tsx       # Détail + notes admin
│   ├── src/
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx # Gestion auth + push register
│   │   └── utils/storage/      # Storage abstraction
│   ├── assets/                 # Images, icônes
│   ├── google-services.json    # Firebase (Android push)
│   ├── app.json                # Config Expo
│   ├── package.json
│   └── .env                    # Config (gitignored)
│
└── README.md                   # Ce fichier
```

---

## 🔌 API Endpoints

### Authentification
| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Inscription |
| POST | `/api/auth/login` | Connexion |
| GET | `/api/auth/me` | Profil utilisateur courant |

### Signalements
| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/api/reports` | Créer (déclenche routage auto) |
| GET | `/api/reports` | Liste (filtres : status, type, priority) |
| GET | `/api/reports/{id}` | Détails |
| PUT | `/api/reports/{id}` | Maj statut + notes (admin) |

### Notifications utilisateur
| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/api/notifications` | Mes notifications |
| GET | `/api/notifications/unread-count` | Compteur non lues |
| POST | `/api/notifications/{id}/read` | Marquer comme lue |
| POST | `/api/notifications/read-all` | Tout marquer comme lu |

### Push notifications
| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/api/register-push` | Enregistrement device |

### Admin
| Méthode | Endpoint | Description |
|---|---|---|
| GET | `/api/reports/stats/summary` | Statistiques globales |
| GET | `/api/admin/notification-events` | Audit log notifications |

**Documentation interactive Swagger** : http://localhost:8001/docs

---

## 🧪 Lancer les tests backend

```bash
cd backend
pytest tests/ -v
```

22 tests couvrent : auth, routage auto, notifications, scheduler, filtres, RBAC.

---

## 🚢 Déploiement

### Via la plateforme Emergent (recommandé)
1. Cliquer sur **"Publish"** dans l'interface Emergent
2. La plateforme :
   - Déploie le backend FastAPI
   - Configure `EMERGENT_PUSH_KEY` automatiquement
   - Génère l'URL publique HTTPS
3. Générer les builds Android/iOS via le portail
4. Les notifications push activées dans les builds (pas dans Expo Go)

### Manuel
- **Backend** : Déployer sur Railway/Render/Heroku avec MongoDB Atlas
- **Frontend** : `eas build --platform all` pour générer APK/IPA
- **Variables d'env** à configurer : `MONGO_URL`, `DB_NAME`, `SECRET_KEY`, `EMERGENT_PUSH_KEY`

---

## 🛠️ Troubleshooting

### Le backend ne démarre pas
```bash
# Vérifier MongoDB
mongosh --eval "db.runCommand({ping:1})"

# Réinstaller les dépendances
pip install -r requirements.txt --force-reinstall
```

### Le frontend ne se connecte pas au backend
- Vérifier que `EXPO_PUBLIC_BACKEND_URL` dans `frontend/.env` pointe vers la bonne IP
- Sur mobile physique, utiliser l'IP LAN de votre machine (pas `localhost`)
- Vérifier le pare-feu sur le port 8001

### Les notifications push ne fonctionnent pas
- Normal en développement avec `EMERGENT_PUSH_KEY=placeholder`
- Normal dans Expo Go (les push Android ne sont plus supportés dans Expo Go SDK 53+)
- Nécessite un build natif (EAS Build ou Emergent Publish)

### Erreur "Could not parse Expo config: google-services.json"
- Le fichier est requis pour les notifications push Android
- Télécharger depuis Firebase Console → Project Settings → Apps
- Placer dans `/app/frontend/google-services.json`

---

## 📞 Support

- 📧 Email : support@signalcitoyen.ci
- 📖 Documentation API : http://localhost:8001/docs
- 🐛 Issues : Ouvrir un ticket sur le dépôt Git

---

## 📜 Licence

© 2026 SignalCitoyen / OSEA - Tous droits réservés.
