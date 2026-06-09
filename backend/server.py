from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt
import os
import logging
import httpx
from pathlib import Path
from bson import ObjectId

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Security
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production-12345678")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 10080  # 7 days

# Push notifications
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

_push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# ==================== MODELS ====================

class UserRole:
    CITIZEN = "citizen"
    ADMIN = "admin"

class ReportStatus:
    RECEIVED = "received"
    PROCESSING = "processing"
    RESOLVED = "resolved"

class Location(BaseModel):
    latitude: float
    longitude: float
    address: Optional[str] = None

class User(BaseModel):
    id: str
    email: str
    name: str
    role: str = UserRole.CITIZEN
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Optional[str] = UserRole.CITIZEN

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
    status: str = ReportStatus.RECEIVED
    admin_notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class ReportCreate(BaseModel):
    type: str
    description: str
    location: Location
    photos: List[str] = []

class ReportUpdate(BaseModel):
    status: Optional[str] = None
    admin_notes: Optional[str] = None

class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str

# ==================== PUSH NOTIFICATIONS ====================

async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    """Send push notification via Emergent push service."""
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _push_client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()

# ==================== HELPER FUNCTIONS ====================

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
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
        created_at=user["created_at"]
    )

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register", response_model=Token)
async def register(user_data: UserCreate):
    # Check if user exists
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email déjà enregistré")
    
    # Create user
    hashed_password = get_password_hash(user_data.password)
    user_doc = {
        "email": user_data.email,
        "password": hashed_password,
        "name": user_data.name,
        "role": user_data.role,
        "created_at": datetime.utcnow()
    }
    
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    # Create token
    access_token = create_access_token(data={"sub": user_id})
    
    user = User(
        id=user_id,
        email=user_data.email,
        name=user_data.name,
        role=user_data.role
    )
    
    return Token(access_token=access_token, token_type="bearer", user=user)

@api_router.post("/auth/login", response_model=Token)
async def login(user_data: UserLogin):
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
        created_at=user["created_at"]
    )
    
    return Token(access_token=access_token, token_type="bearer", user=user_obj)

@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

# ==================== PUSH REGISTRATION ====================

@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
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
        logger = logging.getLogger(__name__)
        logger.warning(f"Push registration failed: {e}")
        return {"status": "failed", "reason": str(e)}

# ==================== REPORT ENDPOINTS ====================

@api_router.post("/reports", response_model=Report)
async def create_report(report_data: ReportCreate, current_user: User = Depends(get_current_user)):
    report_doc = {
        "user_id": current_user.id,
        "user_name": current_user.name,
        "type": report_data.type,
        "description": report_data.description,
        "location": report_data.location.dict(),
        "photos": report_data.photos,
        "status": ReportStatus.RECEIVED,
        "admin_notes": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    result = await db.reports.insert_one(report_doc)
    report_id = str(result.inserted_id)
    
    return Report(
        id=report_id,
        user_id=current_user.id,
        user_name=current_user.name,
        type=report_data.type,
        description=report_data.description,
        location=report_data.location,
        photos=report_data.photos,
        status=ReportStatus.RECEIVED
    )

@api_router.get("/reports", response_model=List[Report])
async def get_reports(current_user: User = Depends(get_current_user)):
    # If admin, show all reports; otherwise show only user's reports
    query = {} if current_user.role == UserRole.ADMIN else {"user_id": current_user.id}
    
    reports = await db.reports.find(query).sort("created_at", -1).to_list(1000)
    
    return [
        Report(
            id=str(r["_id"]),
            user_id=r["user_id"],
            user_name=r["user_name"],
            type=r["type"],
            description=r["description"],
            location=Location(**r["location"]),
            photos=r["photos"],
            status=r["status"],
            admin_notes=r.get("admin_notes"),
            created_at=r["created_at"],
            updated_at=r["updated_at"]
        )
        for r in reports
    ]

@api_router.get("/reports/{report_id}", response_model=Report)
async def get_report(report_id: str, current_user: User = Depends(get_current_user)):
    try:
        report = await db.reports.find_one({"_id": ObjectId(report_id)})
    except:
        raise HTTPException(status_code=400, detail="ID de signalement invalide")
    
    if not report:
        raise HTTPException(status_code=404, detail="Signalement non trouvé")
    
    # Check permissions
    if current_user.role != UserRole.ADMIN and report["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    
    return Report(
        id=str(report["_id"]),
        user_id=report["user_id"],
        user_name=report["user_name"],
        type=report["type"],
        description=report["description"],
        location=Location(**report["location"]),
        photos=report["photos"],
        status=report["status"],
        admin_notes=report.get("admin_notes"),
        created_at=report["created_at"],
        updated_at=report["updated_at"]
    )

@api_router.put("/reports/{report_id}", response_model=Report)
async def update_report(
    report_id: str,
    update_data: ReportUpdate,
    current_user: User = Depends(get_current_user)
):
    # Only admins can update reports
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Accès réservé aux administrateurs")
    
    try:
        report = await db.reports.find_one({"_id": ObjectId(report_id)})
    except:
        raise HTTPException(status_code=400, detail="ID de signalement invalide")
    
    if not report:
        raise HTTPException(status_code=404, detail="Signalement non trouvé")
    
    # Update fields
    update_fields = {"updated_at": datetime.utcnow()}
    if update_data.status:
        update_fields["status"] = update_data.status
    if update_data.admin_notes:
        update_fields["admin_notes"] = update_data.admin_notes
    
    await db.reports.update_one(
        {"_id": ObjectId(report_id)},
        {"$set": update_fields}
    )
    
    # Send push notification to user if status changed
    if update_data.status and update_data.status != report["status"]:
        try:
            status_messages = {
                "received": "Votre signalement a été reçu",
                "processing": "Votre signalement est en cours de traitement",
                "resolved": "Votre signalement a été résolu",
            }
            message = status_messages.get(update_data.status, "Statut du signalement mis à jour")
            await send_push(
                recipients=[report["user_id"]],
                data={
                    "title": "SignalCitoyen",
                    "message": message,
                    "action_url": f"/report-detail/{report_id}",
                },
            )
        except Exception as e:
            logger = logging.getLogger(__name__)
            logger.warning(f"Push notification failed (non-blocking): {e}")
    
    # Get updated report
    updated_report = await db.reports.find_one({"_id": ObjectId(report_id)})
    
    return Report(
        id=str(updated_report["_id"]),
        user_id=updated_report["user_id"],
        user_name=updated_report["user_name"],
        type=updated_report["type"],
        description=updated_report["description"],
        location=Location(**updated_report["location"]),
        photos=updated_report["photos"],
        status=updated_report["status"],
        admin_notes=updated_report.get("admin_notes"),
        created_at=updated_report["created_at"],
        updated_at=updated_report["updated_at"]
    )

@api_router.get("/reports/stats/summary")
async def get_stats(current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Accès réservé aux administrateurs")
    
    total = await db.reports.count_documents({})
    received = await db.reports.count_documents({"status": ReportStatus.RECEIVED})
    processing = await db.reports.count_documents({"status": ReportStatus.PROCESSING})
    resolved = await db.reports.count_documents({"status": ReportStatus.RESOLVED})
    
    return {
        "total": total,
        "received": received,
        "processing": processing,
        "resolved": resolved
    }

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
