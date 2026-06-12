"""
=====================================================================
SERVER.PY - OSEA / SignalCitoyen
Architecture événementielle : Routage, Notifications, Escalade
=====================================================================
"""

from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import JWTError, jwt
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import os
import logging
import httpx
from pathlib import Path
from bson import ObjectId

# =====================================================================
# CONFIGURATION
# =====================================================================

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Connexion MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Sécurité JWT
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production-12345678")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 10080  # 7 jours

# Push notifications (Emergent service)
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# Configuration du logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("OSEA")

# Application FastAPI
app = FastAPI(title="OSEA - Plateforme de signalement citoyen")
api_router = APIRouter(prefix="/api")

# Scheduler pour les tâches planifiées (escalade)
scheduler = AsyncIOScheduler(timezone="UTC")

# =====================================================================
# CONSTANTES MÉTIER (Routage et types critiques)
# =====================================================================

class ReportStatus:
    """Statuts possibles d'un ticket."""
    RECEIVED = "received"        # En attente (juste créé)
    ASSIGNED = "assigned"        # Assigné à une équipe
    PROCESSING = "processing"    # En cours de traitement par l'équipe
    RESOLVED = "resolved"        # Résolu

class Priority:
    """Niveaux de priorité."""
    NORMAL = "normal"
    URGENT_CRITIQUE = "urgent_critique"

class UserRole:
    CITIZEN = "citizen"
    AGENT = "agent"
    ADMIN = "admin"

# Mapping type d'incident → service technique
TYPE_TO_SERVICE = {
    "water": "EAU",
    "drainage": "ASSAINISSEMENT",
    "waste": "DECHETS",
    "street": "VOIRIE",
    "other": "GENERAL",
}

# Liste des zones connues d'Abidjan (extraction depuis l'adresse)
ZONES_CONNUES = [
    "Cocody", "Yopougon", "Plateau", "Adjamé", "Adjame",
    "Marcory", "Treichville", "Abobo", "Attécoubé", "Attecoube",
    "Port-Bouët", "Port-Bouet", "Koumassi", "Bingerville", "Anyama",
]

# Types critiques nécessitant une escalade rapide
TYPES_CRITIQUES = {"water", "drainage"}

# Seuil d'escalade (heures)
ESCALATION_THRESHOLD_HOURS = 4

# =====================================================================
# MODÈLES PYDANTIC
# =====================================================================

class Location(BaseModel):
    latitude: float
    longitude: float
    address: Optional[str] = None

class User(BaseModel):
    id: str
    email: str
    name: str
    role: str = UserRole.CITIZEN
    team_id: Optional[str] = None  # Pour les agents : ID de leur équipe
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Optional[str] = UserRole.CITIZEN
    team_id: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: User

class Report(BaseModel):
    id: str
    user_id: str
    user_name: str
    type: str
    description: str
    location: Location
    photos: List[str] = []
    proof_photos: List[str] = []  # Photos de preuve de l'agent à la résolution
    status: str = ReportStatus.RECEIVED
    priority: str = Priority.NORMAL
    team_id: Optional[str] = None
    zone: Optional[str] = None
    admin_notes: Optional[str] = None
    agent_notes: Optional[str] = None  # Note de l'agent à la résolution
    resolved_by: Optional[str] = None  # Nom de l'agent qui a résolu
    escalated: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ReportCreate(BaseModel):
    type: str
    description: str
    location: Location
    photos: List[str] = []

class ReportUpdate(BaseModel):
    status: Optional[str] = None
    admin_notes: Optional[str] = None
    priority: Optional[str] = None

class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str

# =====================================================================
# HELPERS AUTHENTIFICATION
# =====================================================================

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict) -> str:
    """Crée un token JWT avec expiration."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> User:
    """Récupère l'utilisateur courant à partir du token JWT."""
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Identifiants invalides",
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if user is None:
        raise credentials_exception

    return User(
        id=str(user["_id"]),
        email=user["email"],
        name=user["name"],
        role=user["role"],
        team_id=user.get("team_id"),
        created_at=user["created_at"],
    )

# =====================================================================
# 🔔 SYSTÈME DE NOTIFICATIONS (Push + simulation SMS/Email)
# =====================================================================

async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    """
    Envoie une notification push via le service Emergent.
    Wrapper sécurisé : ne fait jamais planter le caller.
    """
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("Maximum 100 destinataires par appel")
    if "title" not in data or "message" not in data:
        raise ValueError("data doit contenir title et message")

    payload = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key

    resp = await _push_client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY manquante ou invalide")
    if resp.status_code >= 500:
        raise HTTPException(502, "Service push indisponible")
    resp.raise_for_status()


async def log_notification_event(event_type: str, payload: dict) -> None:
    """
    Persiste l'événement de notification dans MongoDB pour audit/historique.
    Permet de tracer toutes les communications sortantes.
    """
    try:
        await db.notification_events.insert_one({
            "event_type": event_type,
            "payload": payload,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception as e:
        logger.warning(f"Échec persistance notification: {e}")


async def simulate_sms_to_agent(team_id: str, report_id: str, message: str) -> None:
    """
    Simulation d'envoi SMS à l'agent de terrain.
    En production, brancher Twilio/Orange SMS API ici.
    """
    sms_payload = {
        "to_team": team_id,
        "report_id": report_id,
        "channel": "SMS",
        "message": message,
        "simulated": True,
    }
    logger.info(f"📱 [SMS SIMULÉ] → Équipe {team_id} | Ticket {report_id} | {message}")
    await log_notification_event("sms_agent_assigned", sms_payload)


async def simulate_email_to_citizen(user_email: str, report: dict) -> None:
    """
    Simulation d'email de confirmation au citoyen lors de la résolution.
    En production, brancher SendGrid/Resend ici.
    """
    recap = (
        f"Bonjour,\n\n"
        f"Votre signalement #{str(report['_id'])[:8]} a été résolu.\n"
        f"Type : {report.get('type', 'N/A')}\n"
        f"Lieu : {report.get('location', {}).get('address', 'N/A')}\n"
        f"Date de création : {report.get('created_at')}\n"
        f"Date de résolution : {datetime.now(timezone.utc).isoformat()}\n\n"
        f"Merci de votre contribution à la salubrité de la Côte d'Ivoire."
    )
    email_payload = {
        "to": user_email,
        "subject": "Votre signalement a été résolu",
        "body": recap,
        "channel": "EMAIL",
        "simulated": True,
    }
    logger.info(f"📧 [EMAIL SIMULÉ] → {user_email} | Ticket {str(report['_id'])[:8]} résolu")
    await log_notification_event("email_citizen_resolved", email_payload)


async def handle_status_change_notifications(report: dict, old_status: str, new_status: str) -> None:
    """
    🔔 ORCHESTRATEUR DE NOTIFICATIONS
    Déclenche les bons canaux selon la transition de statut.
    """
    report_id = str(report["_id"])
    team_id = report.get("team_id")
    user_id = report.get("user_id")

    # Transition vers "Assigné" → SMS à l'équipe terrain
    if new_status == ReportStatus.ASSIGNED and old_status != ReportStatus.ASSIGNED:
        message = (
            f"Nouveau ticket {report_id[:8]} - "
            f"Type: {report.get('type')} - "
            f"Zone: {report.get('zone', 'N/A')}"
        )
        if team_id:
            await simulate_sms_to_agent(team_id, report_id, message)

    # Transition vers "Résolu" → Email au citoyen + Push
    if new_status == ReportStatus.RESOLVED and old_status != ReportStatus.RESOLVED:
        # Récupérer l'email du citoyen
        try:
            user = await db.users.find_one({"_id": ObjectId(user_id)})
            if user and user.get("email"):
                await simulate_email_to_citizen(user["email"], report)
        except Exception as e:
            logger.warning(f"Échec récupération email citoyen: {e}")

    # Notification PUSH au citoyen pour tout changement de statut visible
    status_labels = {
        ReportStatus.RECEIVED: "Votre signalement a été reçu",
        ReportStatus.ASSIGNED: "Votre signalement a été assigné à une équipe",
        ReportStatus.PROCESSING: "Votre signalement est en cours de traitement",
        ReportStatus.RESOLVED: "Votre signalement a été résolu",
    }
    message = status_labels.get(new_status, "Statut mis à jour")

    # 📥 Persister la notification dans la boîte de réception du citoyen
    try:
        type_labels = {
            "waste": "Déchets sauvages",
            "water": "Problème d'eau",
            "drainage": "Assainissement",
            "street": "Propreté de rue",
            "other": "Autre",
        }
        await db.user_notifications.insert_one({
            "user_id": user_id,
            "report_id": report_id,
            "title": f"Mise à jour : {type_labels.get(report.get('type'), report.get('type'))}",
            "message": message,
            "status": new_status,
            "read": False,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception as e:
        logger.warning(f"Échec persistance notification inbox: {e}")

    # 📥 Notifier les admins aux étapes clés (audit/supervision)
    # Les admins sont notifiés uniquement pour :
    # - Résolution par un agent (à valider/auditer)
    # - Réouverture (pour traçabilité)
    # Pas de spam pour les transitions intermédiaires
    if new_status == ReportStatus.RESOLVED and old_status != ReportStatus.RESOLVED:
        try:
            admins = await db.users.find({"role": UserRole.ADMIN}).to_list(50)
            type_labels_admin = {
                "waste": "Déchets", "water": "Eau", "drainage": "Assainissement",
                "street": "Voirie", "other": "Autre",
            }
            resolved_by = report.get("resolved_by") or "Un agent"
            for admin in admins:
                await db.user_notifications.insert_one({
                    "user_id": str(admin["_id"]),
                    "report_id": report_id,
                    "title": f"✓ Ticket résolu par {resolved_by}",
                    "message": (
                        f"{type_labels_admin.get(report.get('type'), report.get('type'))} - "
                        f"Zone: {report.get('zone', 'N/A')} - "
                        f"À valider si nécessaire"
                    ),
                    "status": new_status,
                    "read": False,
                    "created_at": datetime.now(timezone.utc),
                })
            logger.info(f"📥 {len(admins)} admin(s) notifié(s) de la résolution du ticket {report_id[:8]}")
        except Exception as e:
            logger.warning(f"Échec notification admins (résolution): {e}")

    # Push notification (système natif)
    try:
        await send_push(
            recipients=[user_id],
            data={
                "title": "SignalCitoyen",
                "message": message,
                "action_url": f"/report-detail/{report_id}",
            },
        )
    except Exception as e:
        logger.warning(f"Push notification échouée (non-bloquant): {e}")


# =====================================================================
# 🎯 1. ROUTAGE AUTOMATIQUE (Trigger à la création)
# =====================================================================

def extraire_zone_depuis_adresse(address: Optional[str]) -> str:
    """
    Extrait la zone d'Abidjan depuis l'adresse géocodée.
    Retourne "ZONE_INCONNUE" si aucune correspondance.
    """
    if not address:
        return "ZONE_INCONNUE"

    address_lower = address.lower()
    for zone in ZONES_CONNUES:
        if zone.lower() in address_lower:
            # Normaliser (sans accents, en majuscules)
            return zone.upper().replace("É", "E").replace("È", "E").replace("Ê", "E")

    return "ZONE_INCONNUE"


def determiner_equipe(type_incident: str, zone: str) -> str:
    """
    Détermine l'ID de l'équipe technique selon le type d'incident et la zone.
    Format : EQUIPE_<SERVICE>_<ZONE>
    Exemple : EQUIPE_EAU_COCODY
    """
    service = TYPE_TO_SERVICE.get(type_incident, "GENERAL")
    return f"EQUIPE_{service}_{zone}"


async def router_automatiquement(report_id: str) -> None:
    """
    🎯 FONCTION DE ROUTAGE AUTOMATIQUE
    Analyse le ticket, détermine l'équipe responsable, et passe au statut "Assigné".
    Exécutée en background task juste après la création du ticket.
    """
    try:
        report = await db.reports.find_one({"_id": ObjectId(report_id)})
        if not report:
            logger.error(f"Ticket {report_id} introuvable pour routage")
            return

        # Étape 1 : Extraire la zone
        zone = extraire_zone_depuis_adresse(report.get("location", {}).get("address"))

        # Étape 2 : Déterminer l'équipe
        team_id = determiner_equipe(report["type"], zone)

        # Étape 3 : Définir la priorité initiale selon le type
        priority = (
            Priority.URGENT_CRITIQUE
            if report["type"] in TYPES_CRITIQUES
            else Priority.NORMAL
        )

        # Étape 4 : Mise à jour atomique du ticket
        update_result = await db.reports.update_one(
            {"_id": ObjectId(report_id)},
            {"$set": {
                "team_id": team_id,
                "zone": zone,
                "status": ReportStatus.ASSIGNED,
                "priority": priority,
                "updated_at": datetime.now(timezone.utc),
            }}
        )

        if update_result.modified_count > 0:
            logger.info(
                f"✅ ROUTAGE | Ticket {report_id[:8]} → {team_id} "
                f"(Zone: {zone}, Type: {report['type']}, Priorité: {priority})"
            )

            # Récupérer le ticket mis à jour et déclencher les notifications
            updated = await db.reports.find_one({"_id": ObjectId(report_id)})
            if updated:
                await handle_status_change_notifications(
                    updated, ReportStatus.RECEIVED, ReportStatus.ASSIGNED
                )
        else:
            logger.warning(f"Aucune modification lors du routage du ticket {report_id}")

    except Exception as e:
        logger.error(f"❌ Erreur de routage automatique pour {report_id}: {e}")


# =====================================================================
# ⏰ 3. TÂCHE PLANIFIÉE D'ESCALADE
# =====================================================================

async def alerter_superviseur_general(report: dict) -> None:
    """
    Alerte le Superviseur Général qu'un ticket critique a dépassé le SLA.
    En production : envoi email/SMS/Slack au superviseur.
    Ici : log d'erreur + persistance pour audit.
    """
    report_id = str(report["_id"])
    payload = {
        "report_id": report_id,
        "type": report.get("type"),
        "team_id": report.get("team_id"),
        "zone": report.get("zone"),
        "status_actuel": report.get("status"),
        "created_at": report.get("created_at"),
        "age_hours": (datetime.now(timezone.utc) - report.get("created_at").replace(tzinfo=timezone.utc)).total_seconds() / 3600
        if report.get("created_at") else None,
        "alerte": "ESCALADE - SLA dépassé",
    }

    logger.error(
        f"🚨 ESCALADE CRITIQUE | Ticket {report_id[:8]} | "
        f"Type: {report.get('type')} | Équipe: {report.get('team_id')} | "
        f"Statut: {report.get('status')} - DÉPASSEMENT SLA 4h"
    )

    await log_notification_event("supervisor_escalation_alert", payload)


async def task_escalade_tickets_critiques() -> None:
    """
    ⏰ TÂCHE PLANIFIÉE D'ESCALADE
    Scanne périodiquement les tickets critiques au statut "En attente" ou "Assigné"
    depuis plus de 4 heures et déclenche l'escalade automatique.
    """
    try:
        seuil = datetime.now(timezone.utc) - timedelta(hours=ESCALATION_THRESHOLD_HOURS)

        # Critères : type critique + statut non final + non encore escaladé + ancien
        query = {
            "type": {"$in": list(TYPES_CRITIQUES)},
            "status": {"$in": [ReportStatus.RECEIVED, ReportStatus.ASSIGNED]},
            "escalated": {"$ne": True},
            "created_at": {"$lt": seuil},
        }

        tickets_a_escalader = await db.reports.find(query).to_list(100)

        if not tickets_a_escalader:
            logger.debug("Aucun ticket critique à escalader.")
            return

        logger.info(f"⏰ ESCALADE - {len(tickets_a_escalader)} ticket(s) critique(s) à traiter")

        for ticket in tickets_a_escalader:
            ticket_id = ticket["_id"]
            # Mise à jour atomique : priorité URGENT + flag escalated
            await db.reports.update_one(
                {"_id": ticket_id, "escalated": {"$ne": True}},
                {"$set": {
                    "priority": Priority.URGENT_CRITIQUE,
                    "escalated": True,
                    "escalated_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                }}
            )

            # Alerte du superviseur (asynchrone, non-bloquant)
            try:
                await alerter_superviseur_general(ticket)
            except Exception as e:
                logger.warning(f"Échec alerte superviseur pour {ticket_id}: {e}")

    except Exception as e:
        logger.error(f"❌ Erreur dans la tâche d'escalade: {e}")


# =====================================================================
# ENDPOINTS - AUTHENTIFICATION
# =====================================================================

@api_router.post("/auth/register", response_model=Token)
async def register(user_data: UserCreate):
    """Inscription d'un nouvel utilisateur."""
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email déjà enregistré")

    hashed_password = get_password_hash(user_data.password)
    user_doc = {
        "email": user_data.email,
        "password": hashed_password,
        "name": user_data.name,
        "role": user_data.role,
        "team_id": user_data.team_id,
        "created_at": datetime.now(timezone.utc),
    }

    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    access_token = create_access_token(data={"sub": user_id})

    user = User(
        id=user_id,
        email=user_data.email,
        name=user_data.name,
        role=user_data.role,
        team_id=user_data.team_id,
    )
    return Token(access_token=access_token, token_type="bearer", user=user)


@api_router.post("/auth/login", response_model=Token)
async def login(user_data: UserLogin):
    """Connexion d'un utilisateur."""
    user = await db.users.find_one({"email": user_data.email})
    if not user or not verify_password(user_data.password, user["password"]):
        raise HTTPException(status_code=400, detail="Email ou mot de passe incorrect")

    user_id = str(user["_id"])
    access_token = create_access_token(data={"sub": user_id})

    user_obj = User(
        id=user_id,
        email=user["email"],
        name=user["name"],
        role=user["role"],
        team_id=user.get("team_id"),
        created_at=user["created_at"],
    )
    return Token(access_token=access_token, token_type="bearer", user=user_obj)


@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# =====================================================================
# ENDPOINTS - PUSH REGISTRATION
# =====================================================================

@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    """Enregistre le token push d'un appareil."""
    try:
        resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
        if resp.status_code >= 500:
            raise HTTPException(502, "Push provider unavailable")
        resp.raise_for_status()
        return {"status": "registered"}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Push registration failed: {e}")
        return {"status": "failed", "reason": str(e)}


# =====================================================================
# ENDPOINTS - REPORTS (avec architecture événementielle)
# =====================================================================

def report_doc_to_model(doc: dict) -> Report:
    """Convertit un document MongoDB en modèle Pydantic."""
    return Report(
        id=str(doc["_id"]),
        user_id=doc["user_id"],
        user_name=doc["user_name"],
        type=doc["type"],
        description=doc["description"],
        location=Location(**doc["location"]),
        photos=doc.get("photos", []),
        proof_photos=doc.get("proof_photos", []),
        status=doc.get("status", ReportStatus.RECEIVED),
        priority=doc.get("priority", Priority.NORMAL),
        team_id=doc.get("team_id"),
        zone=doc.get("zone"),
        admin_notes=doc.get("admin_notes"),
        agent_notes=doc.get("agent_notes"),
        resolved_by=doc.get("resolved_by"),
        escalated=doc.get("escalated", False),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


@api_router.post("/reports", response_model=Report)
async def create_report(
    report_data: ReportCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """
    🎯 ENDPOINT DE CRÉATION DE TICKET
    Crée le ticket avec statut "En attente" puis déclenche le routage automatique
    en background (pattern event-driven : la création publie un événement implicite).
    """
    report_doc = {
        "user_id": current_user.id,
        "user_name": current_user.name,
        "type": report_data.type,
        "description": report_data.description,
        "location": report_data.location.dict(),
        "photos": report_data.photos,
        "status": ReportStatus.RECEIVED,
        "priority": Priority.NORMAL,
        "team_id": None,
        "zone": None,
        "admin_notes": None,
        "escalated": False,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }

    result = await db.reports.insert_one(report_doc)
    report_id = str(result.inserted_id)

    # 🚀 DÉCLENCHEMENT DU ROUTAGE AUTOMATIQUE EN BACKGROUND
    # Le ticket est créé, on enchaîne le routage sans bloquer la réponse au client
    background_tasks.add_task(router_automatiquement, report_id)

    # Récupérer le doc pour retourner les valeurs initiales
    created = await db.reports.find_one({"_id": result.inserted_id})
    return report_doc_to_model(created)


@api_router.get("/reports", response_model=List[Report])
async def get_reports(
    status_filter: Optional[str] = None,
    type_filter: Optional[str] = None,
    priority_filter: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    """
    Liste les signalements.
    - Citoyen : voit uniquement les siens
    - Admin : voit tous les tickets, avec filtres
    """
    query = {} if current_user.role == UserRole.ADMIN else {"user_id": current_user.id}

    if status_filter:
        query["status"] = status_filter
    if type_filter:
        query["type"] = type_filter
    if priority_filter:
        query["priority"] = priority_filter

    # Optimisation: exclure les photos (base64 volumineux) en vue liste
    # Les photos sont chargées uniquement dans la vue détail
    reports = await db.reports.find(query).sort("created_at", -1).limit(200).to_list(200)
    # Stripper les photos lourdes pour la liste (garde la première en preview)
    for r in reports:
        photos = r.get("photos", [])
        r["photos"] = photos[:1] if photos else []
    return [report_doc_to_model(r) for r in reports]


@api_router.get("/reports/{report_id}", response_model=Report)
async def get_report(report_id: str, current_user: User = Depends(get_current_user)):
    """Détails d'un signalement."""
    try:
        report = await db.reports.find_one({"_id": ObjectId(report_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")

    if not report:
        raise HTTPException(status_code=404, detail="Signalement non trouvé")

    if current_user.role != UserRole.ADMIN and report["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Accès non autorisé")

    return report_doc_to_model(report)


@api_router.put("/reports/{report_id}", response_model=Report)
async def update_report(
    report_id: str,
    update_data: ReportUpdate,
    current_user: User = Depends(get_current_user),
):
    """
    🔔 ENDPOINT DE MISE À JOUR
    Met à jour le ticket et déclenche les notifications appropriées
    en fonction du changement de statut.
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")

    try:
        report = await db.reports.find_one({"_id": ObjectId(report_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")

    if not report:
        raise HTTPException(status_code=404, detail="Signalement non trouvé")

    old_status = report.get("status", ReportStatus.RECEIVED)

    # Construire la mise à jour
    update_fields = {"updated_at": datetime.now(timezone.utc)}
    if update_data.status:
        update_fields["status"] = update_data.status
    if update_data.priority:
        update_fields["priority"] = update_data.priority
    if update_data.admin_notes is not None:
        update_fields["admin_notes"] = update_data.admin_notes

    await db.reports.update_one(
        {"_id": ObjectId(report_id)},
        {"$set": update_fields},
    )

    # 🚀 DÉCLENCHEMENT DES NOTIFICATIONS
    if update_data.status and update_data.status != old_status:
        updated = await db.reports.find_one({"_id": ObjectId(report_id)})
        try:
            await handle_status_change_notifications(updated, old_status, update_data.status)
        except Exception as e:
            logger.warning(f"Notification échouée (non-bloquant): {e}")

    updated = await db.reports.find_one({"_id": ObjectId(report_id)})
    return report_doc_to_model(updated)


@api_router.get("/reports/stats/summary")
async def get_stats(current_user: User = Depends(get_current_user)):
    """Statistiques pour le dashboard admin."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")

    total = await db.reports.count_documents({})
    received = await db.reports.count_documents({"status": ReportStatus.RECEIVED})
    assigned = await db.reports.count_documents({"status": ReportStatus.ASSIGNED})
    processing = await db.reports.count_documents({"status": ReportStatus.PROCESSING})
    resolved = await db.reports.count_documents({"status": ReportStatus.RESOLVED})
    urgent = await db.reports.count_documents({"priority": Priority.URGENT_CRITIQUE})
    escalated = await db.reports.count_documents({"escalated": True})

    return {
        "total": total,
        "received": received,
        "assigned": assigned,
        "processing": processing,
        "resolved": resolved,
        "urgent": urgent,
        "escalated": escalated,
    }


@api_router.get("/admin/notification-events")
async def get_notification_events(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
):
    """Historique des événements de notification (audit log)."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")

    events = await db.notification_events.find(
        {},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)

    # Convertir datetime en string
    for ev in events:
        if "created_at" in ev:
            ev["created_at"] = ev["created_at"].isoformat() if isinstance(ev["created_at"], datetime) else ev["created_at"]

    return {"events": events}


# =====================================================================
# ENDPOINTS - AGENT (équipe terrain)
# =====================================================================

@api_router.get("/agent/reports", response_model=List[Report])
async def get_agent_reports(current_user: User = Depends(get_current_user)):
    """
    Liste les tickets assignés à l'équipe de l'agent connecté.
    L'agent voit uniquement les tickets de son team_id (sauf ceux résolus depuis > 7 jours).
    """
    if current_user.role != UserRole.AGENT:
        raise HTTPException(status_code=403, detail="Réservé aux agents")

    if not current_user.team_id:
        raise HTTPException(status_code=400, detail="Aucune équipe assignée à cet agent")

    # Tickets de mon équipe, non résolus OU résolus récemment (< 7 jours)
    seuil_anciens = datetime.now(timezone.utc) - timedelta(days=7)
    query = {
        "team_id": current_user.team_id,
        "$or": [
            {"status": {"$in": [
                ReportStatus.RECEIVED,
                ReportStatus.ASSIGNED,
                ReportStatus.PROCESSING,
            ]}},
            {"status": ReportStatus.RESOLVED, "updated_at": {"$gte": seuil_anciens}},
        ],
    }

    reports = await db.reports.find(query).sort("created_at", -1).limit(100).to_list(100)
    # Stripper les photos lourdes pour la liste
    for r in reports:
        photos = r.get("photos", [])
        r["photos"] = photos[:1] if photos else []
        # Garder les proof_photos pour pouvoir afficher un badge "résolu avec preuve"
    return [report_doc_to_model(r) for r in reports]


@api_router.post("/reports/{report_id}/start-intervention", response_model=Report)
async def start_intervention(
    report_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    🛠️ L'agent démarre son intervention sur le terrain.
    Transitions autorisées : assigned → processing
    """
    if current_user.role != UserRole.AGENT:
        raise HTTPException(status_code=403, detail="Réservé aux agents")

    try:
        report = await db.reports.find_one({"_id": ObjectId(report_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")

    if not report:
        raise HTTPException(status_code=404, detail="Ticket non trouvé")

    # Vérifier que l'agent appartient à l'équipe assignée
    if report.get("team_id") != current_user.team_id:
        raise HTTPException(status_code=403, detail="Ticket non assigné à votre équipe")

    if report.get("status") != ReportStatus.ASSIGNED:
        raise HTTPException(
            status_code=400,
            detail=f"Le ticket doit être au statut 'Assigné' (actuellement: {report.get('status')})"
        )

    old_status = report.get("status")
    await db.reports.update_one(
        {"_id": ObjectId(report_id)},
        {"$set": {
            "status": ReportStatus.PROCESSING,
            "updated_at": datetime.now(timezone.utc),
        }},
    )

    updated = await db.reports.find_one({"_id": ObjectId(report_id)})
    logger.info(f"🛠️ INTERVENTION DÉMARRÉE | Ticket {report_id[:8]} par {current_user.name}")

    # Notifier le citoyen
    try:
        await handle_status_change_notifications(updated, old_status, ReportStatus.PROCESSING)
    except Exception as e:
        logger.warning(f"Notification échouée: {e}")

    return report_doc_to_model(updated)


class ResolveBody(BaseModel):
    proof_photos: List[str] = []
    agent_notes: Optional[str] = None


@api_router.post("/reports/{report_id}/resolve", response_model=Report)
async def resolve_report(
    report_id: str,
    body: ResolveBody,
    current_user: User = Depends(get_current_user),
):
    """
    ✅ L'agent marque le ticket comme résolu avec photos de preuve.
    Transitions autorisées : assigned/processing → resolved
    """
    if current_user.role != UserRole.AGENT:
        raise HTTPException(status_code=403, detail="Réservé aux agents")

    try:
        report = await db.reports.find_one({"_id": ObjectId(report_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")

    if not report:
        raise HTTPException(status_code=404, detail="Ticket non trouvé")

    if report.get("team_id") != current_user.team_id:
        raise HTTPException(status_code=403, detail="Ticket non assigné à votre équipe")

    if report.get("status") not in [ReportStatus.ASSIGNED, ReportStatus.PROCESSING]:
        raise HTTPException(
            status_code=400,
            detail=f"Le ticket ne peut être résolu depuis le statut {report.get('status')}"
        )

    # Au moins 1 photo de preuve OBLIGATOIRE pour clore
    if not body.proof_photos or len(body.proof_photos) == 0:
        raise HTTPException(
            status_code=400,
            detail="Au moins une photo de preuve est requise pour clore le ticket"
        )

    old_status = report.get("status")
    update_fields = {
        "status": ReportStatus.RESOLVED,
        "proof_photos": body.proof_photos,
        "resolved_by": current_user.name,
        "updated_at": datetime.now(timezone.utc),
    }
    if body.agent_notes:
        update_fields["agent_notes"] = body.agent_notes.strip()

    await db.reports.update_one(
        {"_id": ObjectId(report_id)},
        {"$set": update_fields},
    )

    updated = await db.reports.find_one({"_id": ObjectId(report_id)})
    logger.info(
        f"✅ TICKET RÉSOLU | {report_id[:8]} par {current_user.name} "
        f"({len(body.proof_photos)} photo(s) de preuve)"
    )

    # Notifier le citoyen
    try:
        await handle_status_change_notifications(updated, old_status, ReportStatus.RESOLVED)
    except Exception as e:
        logger.warning(f"Notification échouée: {e}")

    return report_doc_to_model(updated)


class ReopenBody(BaseModel):
    reason: str


@api_router.post("/reports/{report_id}/reopen", response_model=Report)
async def reopen_report(
    report_id: str,
    body: ReopenBody,
    current_user: User = Depends(get_current_user),
):
    """
    🔄 L'admin rouvre un ticket résolu (en cas de litige ou résolution non satisfaisante).
    Transitions autorisées : resolved → assigned
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")

    try:
        report = await db.reports.find_one({"_id": ObjectId(report_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")

    if not report:
        raise HTTPException(status_code=404, detail="Ticket non trouvé")

    if report.get("status") != ReportStatus.RESOLVED:
        raise HTTPException(
            status_code=400,
            detail="Seul un ticket résolu peut être rouvert"
        )

    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="Une raison est obligatoire pour rouvrir un ticket")

    # Notes d'admin: ajouter la raison de réouverture (préfixé)
    existing_notes = report.get("admin_notes") or ""
    timestamp = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M")
    new_note = f"[{timestamp}] RÉOUVERTURE: {body.reason.strip()}"
    combined_notes = (existing_notes + "\n\n" + new_note) if existing_notes else new_note

    old_status = report.get("status")
    await db.reports.update_one(
        {"_id": ObjectId(report_id)},
        {"$set": {
            "status": ReportStatus.ASSIGNED,
            "admin_notes": combined_notes,
            "updated_at": datetime.now(timezone.utc),
        }},
    )

    updated = await db.reports.find_one({"_id": ObjectId(report_id)})
    logger.warning(
        f"🔄 RÉOUVERTURE | Ticket {report_id[:8]} par admin {current_user.name} | Raison: {body.reason.strip()}"
    )

    # Notifier l'équipe (re-SMS) et le citoyen
    try:
        await handle_status_change_notifications(updated, old_status, ReportStatus.ASSIGNED)
    except Exception as e:
        logger.warning(f"Notification échouée: {e}")

    return report_doc_to_model(updated)


# =====================================================================
# ENDPOINTS - NOTIFICATIONS UTILISATEUR (Inbox citoyen)
# =====================================================================

@api_router.get("/notifications")
async def get_my_notifications(current_user: User = Depends(get_current_user)):
    """Liste les notifications du citoyen connecté (les plus récentes en premier)."""
    notifs = await db.user_notifications.find(
        {"user_id": current_user.id}
    ).sort("created_at", -1).limit(100).to_list(100)

    return [
        {
            "id": str(n["_id"]),
            "report_id": n.get("report_id"),
            "title": n.get("title"),
            "message": n.get("message"),
            "status": n.get("status"),
            "read": n.get("read", False),
            "created_at": n["created_at"].isoformat() if isinstance(n.get("created_at"), datetime) else n.get("created_at"),
        }
        for n in notifs
    ]


@api_router.get("/notifications/unread-count")
async def get_unread_count(current_user: User = Depends(get_current_user)):
    """Compte des notifications non lues (pour badge)."""
    count = await db.user_notifications.count_documents({
        "user_id": current_user.id,
        "read": False,
    })
    return {"unread": count}


@api_router.post("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, current_user: User = Depends(get_current_user)):
    """Marque une notification comme lue."""
    try:
        result = await db.user_notifications.update_one(
            {"_id": ObjectId(notif_id), "user_id": current_user.id},
            {"$set": {"read": True}}
        )
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification non trouvée")

    return {"status": "ok"}


@api_router.post("/notifications/read-all")
async def mark_all_read(current_user: User = Depends(get_current_user)):
    """Marque toutes les notifications du citoyen comme lues."""
    result = await db.user_notifications.update_many(
        {"user_id": current_user.id, "read": False},
        {"$set": {"read": True}}
    )
    return {"updated": result.modified_count}


# =====================================================================
# CYCLE DE VIE DE L'APPLICATION
# =====================================================================

@app.on_event("startup")
async def startup_event():
    """Initialise le scheduler à l'allumage du serveur."""
    # Job d'escalade : exécution toutes les 15 minutes
    scheduler.add_job(
        task_escalade_tickets_critiques,
        'interval',
        minutes=15,
        id='escalade_critique',
        replace_existing=True,
    )
    scheduler.start()
    logger.info("⏰ Scheduler démarré - Tâche d'escalade toutes les 15min")


@app.on_event("shutdown")
async def shutdown_db_client():
    """Arrêt propre du serveur."""
    scheduler.shutdown()
    await _push_client.aclose()
    client.close()
    logger.info("Serveur arrêté proprement")


# Inclusion du router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
