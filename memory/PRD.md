# SignalCitoyen - Product Requirement Document

## Vue d'ensemble

SignalCitoyen est une application mobile de signalement citoyen pour la gestion de la salubrité, de l'eau et de l'assainissement en Côte d'Ivoire. L'application permet aux citoyens de signaler des problèmes et aux administrateurs du ministère de suivre et traiter ces signalements.

## Fonctionnalités MVP

### 1. Authentification
- ✅ Inscription utilisateur (email/mot de passe)
- ✅ Connexion sécurisée avec JWT
- ✅ Rôles : Citoyen et Administrateur
- ✅ Gestion de session persistante

### 2. Signalement (Fonctionnalité principale)
- ✅ Formulaire de signalement avec :
  - Type de problème (déchets, eau, assainissement, propreté de rue, autre)
  - Description détaillée
  - Localisation GPS automatique
  - Adresse reverse-geocodée
  - Photos multiples (caméra ou galerie)
- ✅ Stockage des photos en base64
- ✅ Validation des champs obligatoires

### 3. Géolocalisation
- ✅ Capture automatique de la position GPS
- ✅ Affichage des coordonnées et de l'adresse
- ✅ Demande de permissions utilisateur
- ✅ Gestion des erreurs de localisation

### 4. Suivi du signalement
- ✅ 3 statuts : Reçu → En traitement → Résolu
- ✅ Mise à jour en temps réel du statut
- ✅ Historique des signalements
- ✅ Filtrage par rôle (citoyen voit ses signalements, admin voit tout)

### 5. Historique citoyen
- ✅ Liste de tous les signalements de l'utilisateur
- ✅ Badges de statut colorés
- ✅ Aperçu des photos
- ✅ Pull-to-refresh

### 6. Tableau de bord admin
- ✅ Statistiques en temps réel :
  - Total des signalements
  - Signalements reçus
  - Signalements en traitement
  - Signalements résolus
- ✅ Vue de tous les signalements
- ✅ Capacité de mise à jour du statut
- ✅ Accès restreint aux administrateurs

## Architecture technique

### Backend (FastAPI + MongoDB)
- **Serveur**: FastAPI avec Uvicorn
- **Base de données**: MongoDB
- **Authentification**: JWT avec bcrypt
- **API**: RESTful avec préfixe /api
- **Stockage images**: Base64 en MongoDB

### Frontend (Expo + React Native)
- **Framework**: Expo SDK 54
- **Navigation**: Expo Router (file-based routing)
- **State Management**: React Context API
- **UI**: React Native components natifs
- **Permissions**: Camera, Location, Media Library

### Endpoints API

#### Authentification
- `POST /api/auth/register` - Inscription
- `POST /api/auth/login` - Connexion
- `GET /api/auth/me` - Profil utilisateur

#### Signalements
- `POST /api/reports` - Créer un signalement
- `GET /api/reports` - Lister les signalements
- `GET /api/reports/{id}` - Détails d'un signalement
- `PUT /api/reports/{id}` - Mettre à jour un signalement (admin)
- `GET /api/reports/stats/summary` - Statistiques (admin)

## Modèles de données

### User
```
{
  _id: ObjectId,
  email: string,
  password: string (hashed),
  name: string,
  role: "citizen" | "admin",
  created_at: datetime
}
```

### Report
```
{
  _id: ObjectId,
  user_id: string,
  user_name: string,
  type: "waste" | "water" | "drainage" | "street" | "other",
  description: string,
  location: {
    latitude: float,
    longitude: float,
    address: string (optional)
  },
  photos: [base64_string],
  status: "received" | "processing" | "resolved",
  admin_notes: string (optional),
  created_at: datetime,
  updated_at: datetime
}
```

## Permissions requises

### iOS (infoPlist)
- NSCameraUsageDescription: "Prendre des photos des problèmes à signaler"
- NSPhotoLibraryUsageDescription: "Sélectionner des photos depuis votre galerie"
- NSLocationWhenInUseUsageDescription: "Localiser le problème signalé"

### Android
- CAMERA
- READ_MEDIA_IMAGES
- WRITE_EXTERNAL_STORAGE
- ACCESS_FINE_LOCATION
- ACCESS_COARSE_LOCATION

## Écrans de l'application

1. **Connexion/Inscription** - Authentification
2. **Accueil** - Dashboard avec actions rapides (+ stats admin)
3. **Nouveau signalement** - Formulaire complet de signalement
4. **Historique** - Liste des signalements
5. **Détail signalement** - Vue complète avec possibilité de mise à jour (admin)
6. **Profil** - Informations utilisateur et déconnexion

## Comptes de test

### Compte Citoyen
- Email: citoyen@test.com
- Password: password123

### Compte Administrateur
- Email: admin@test.com
- Password: admin123

## Améliorations futures possibles

- Notifications push pour les mises à jour de statut
- Carte interactive avec MapView pour visualiser tous les signalements
- Filtres avancés (par type, par statut, par date)
- Export des données en CSV pour les admins
- Système de commentaires entre citoyens et admins
- Notes de l'administrateur visibles par le citoyen
- Statistiques détaillées par région
- Upload de vidéos en plus des photos
- Mode hors ligne avec synchronisation
- Multi-langue (Français, Anglais, langues locales)

## Notes de développement

- Les images sont stockées en base64 pour simplifier le MVP
- L'authentification utilise des tokens JWT avec expiration de 7 jours
- Les permissions sont vérifiées côté backend via décorateurs
- L'interface suit les guidelines Material Design et iOS Human Interface
- L'application est responsive et fonctionne sur iOS et Android
