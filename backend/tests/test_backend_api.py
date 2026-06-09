"""Backend API regression tests for SignalCitoyen.

Covers:
- Auth (login)
- Reports CRUD
- Role-based access
- Status update (with push notification side-effect)
- Stats
- Push registration endpoint (new)
"""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
CITIZEN = {"email": "citoyen@test.com", "password": "password123"}
ADMIN = {"email": "admin@test.com", "password": "admin123"}


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def citizen_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json=CITIZEN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


# ---------------- AUTH ----------------
class TestAuth:
    def test_login_citizen(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json=CITIZEN, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data and data["token_type"] == "bearer"
        assert data["user"]["role"] == "citizen"
        assert data["user"]["email"] == CITIZEN["email"]

    def test_login_admin(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "admin"

    def test_login_invalid(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json={"email": "x@y.z", "password": "bad"}, timeout=15)
        assert r.status_code == 400


# ---------------- PUSH REGISTRATION ----------------
class TestRegisterPush:
    def test_register_push_no_auth_required(self, api):
        """Endpoint should be callable without auth. Upstream EMERGENT_PUSH_KEY is placeholder -> 401 mapped to 500.
        Acceptable outcomes: 201 (success), 500 (key invalid), 502 (upstream), 200 with status=failed."""
        body = {"user_id": "test-user-id", "platform": "android", "device_token": "test-token-123"}
        r = api.post(f"{BASE_URL}/api/register-push", json=body, timeout=20)
        assert r.status_code in (200, 201, 500, 502), f"Unexpected status {r.status_code}: {r.text}"
        # Must NOT 404 (endpoint must exist) and not crash 5xx outside expected
        assert r.status_code != 404

    def test_register_push_validation(self, api):
        # Missing required fields -> 422
        r = api.post(f"{BASE_URL}/api/register-push", json={"user_id": "x"}, timeout=15)
        assert r.status_code == 422


# ---------------- REPORTS ----------------
class TestReports:
    def test_list_reports_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/reports", timeout=15)
        assert r.status_code in (401, 403)

    def test_create_report_citizen(self, api, citizen_token):
        payload = {
            "type": "water",
            "description": "TEST_ test report from backend tests",
            "location": {"latitude": 5.36, "longitude": -4.0, "address": "Abidjan"},
            "photos": [],
        }
        r = api.post(
            f"{BASE_URL}/api/reports",
            json=payload,
            headers={"Authorization": f"Bearer {citizen_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["type"] == "water"
        assert data["status"] == "received"
        assert data["location"]["address"] == "Abidjan"
        assert "id" in data
        pytest.shared_report_id = data["id"]

    def test_citizen_sees_own_reports(self, api, citizen_token):
        r = api.get(
            f"{BASE_URL}/api/reports",
            headers={"Authorization": f"Bearer {citizen_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        reports = r.json()
        assert isinstance(reports, list)
        assert any(rep["id"] == pytest.shared_report_id for rep in reports)

    def test_admin_sees_all_reports(self, api, admin_token):
        r = api.get(
            f"{BASE_URL}/api/reports",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_citizen_cannot_update_report(self, api, citizen_token):
        r = api.put(
            f"{BASE_URL}/api/reports/{pytest.shared_report_id}",
            json={"status": "resolved"},
            headers={"Authorization": f"Bearer {citizen_token}"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_admin_update_status_triggers_push_non_blocking(self, api, admin_token):
        """Admin updates report status. Push call will fail (placeholder key) but endpoint must return 200."""
        r = api.put(
            f"{BASE_URL}/api/reports/{pytest.shared_report_id}",
            json={"status": "processing", "admin_notes": "TEST_ being looked at"},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "processing"
        assert data["admin_notes"] == "TEST_ being looked at"

    def test_get_single_report(self, api, citizen_token):
        r = api.get(
            f"{BASE_URL}/api/reports/{pytest.shared_report_id}",
            headers={"Authorization": f"Bearer {citizen_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        # Persistence check after update
        assert r.json()["status"] == "processing"

    def test_stats_admin_only(self, api, citizen_token, admin_token):
        r = api.get(
            f"{BASE_URL}/api/reports/stats/summary",
            headers={"Authorization": f"Bearer {citizen_token}"},
            timeout=15,
        )
        assert r.status_code == 403

        r = api.get(
            f"{BASE_URL}/api/reports/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "received", "processing", "resolved"):
            assert k in d and isinstance(d[k], int)
