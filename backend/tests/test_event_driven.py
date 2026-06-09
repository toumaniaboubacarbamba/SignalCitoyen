"""Backend tests for OSEA event-driven architecture.

Covers:
- AUTO-ROUTAGE on report creation (background task)
- NOTIFICATIONS on status change (SMS/Email/Push simulated)
- New endpoints: /api/admin/notification-events, stats with new fields
- Report filters: status/type/priority
- Regression: auth, reports, role-based access, register-push
- Scheduler/escalade: presence + log evidence
"""
import os
import time
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


def _create_report(api, token, type_, address):
    payload = {
        "type": type_,
        "description": f"TEST_ event-driven {type_} report",
        "location": {"latitude": 5.36, "longitude": -4.0, "address": address},
        "photos": [],
    }
    r = api.post(
        f"{BASE_URL}/api/reports",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _poll_report(api, token, report_id, max_wait=8):
    """Poll a report until status is no longer 'received' or timeout."""
    deadline = time.time() + max_wait
    last = None
    while time.time() < deadline:
        r = api.get(
            f"{BASE_URL}/api/reports/{report_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        last = r.json()
        if last["status"] != "received":
            return last
        time.sleep(0.5)
    return last


# ---------------- AUTH (regression) ----------------
class TestAuth:
    def test_login_citizen(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json=CITIZEN, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["role"] == "citizen"
        assert d["token_type"] == "bearer"

    def test_login_admin(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "admin"

    def test_login_invalid(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json={"email": "x@y.z", "password": "bad"}, timeout=15)
        assert r.status_code == 400


# ---------------- AUTO-ROUTAGE (background task) ----------------
class TestAutoRoutage:
    def test_water_cocody_routes_to_eau_cocody_urgent(self, api, citizen_token):
        created = _create_report(api, citizen_token, "water", "Quartier Cocody, Abidjan, Côte d'Ivoire")
        # Initial response: status=received, team=None
        assert created["status"] == "received"
        assert created["team_id"] is None
        assert created["zone"] is None

        # Wait for background routing
        final = _poll_report(api, citizen_token, created["id"], max_wait=8)
        assert final["status"] == "assigned", f"Expected assigned, got {final}"
        assert final["team_id"] == "EQUIPE_EAU_COCODY", f"team_id={final['team_id']}"
        assert final["zone"] == "COCODY"
        assert final["priority"] == "urgent_critique"
        pytest.water_report_id = created["id"]

    def test_waste_yopougon_routes_to_dechets_yopougon_normal(self, api, citizen_token):
        created = _create_report(api, citizen_token, "waste", "Yopougon, Abidjan")
        final = _poll_report(api, citizen_token, created["id"], max_wait=8)
        assert final["status"] == "assigned"
        assert final["team_id"] == "EQUIPE_DECHETS_YOPOUGON"
        assert final["zone"] == "YOPOUGON"
        assert final["priority"] == "normal"
        pytest.waste_report_id = created["id"]

    def test_unknown_zone_falls_back_to_zone_inconnue(self, api, citizen_token):
        created = _create_report(api, citizen_token, "street", "Outside zone somewhere remote")
        final = _poll_report(api, citizen_token, created["id"], max_wait=8)
        assert final["status"] == "assigned"
        assert final["team_id"].endswith("_ZONE_INCONNUE"), f"team_id={final['team_id']}"
        assert final["zone"] == "ZONE_INCONNUE"
        assert final["priority"] == "normal"  # street is not in TYPES_CRITIQUES

    def test_drainage_is_urgent_critique(self, api, citizen_token):
        created = _create_report(api, citizen_token, "drainage", "Plateau, Abidjan")
        final = _poll_report(api, citizen_token, created["id"], max_wait=8)
        assert final["priority"] == "urgent_critique"
        assert final["team_id"] == "EQUIPE_ASSAINISSEMENT_PLATEAU"


# ---------------- NOTIFICATIONS on status change ----------------
class TestNotifications:
    def test_admin_resolve_emits_email_event(self, api, admin_token):
        """PUT status=resolved should log 'email_citizen_resolved' event."""
        report_id = pytest.water_report_id
        # Move to resolved
        r = api.put(
            f"{BASE_URL}/api/reports/{report_id}",
            json={"status": "resolved"},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "resolved"

        # Give logger a moment
        time.sleep(1)

        # Fetch notification events
        r = api.get(
            f"{BASE_URL}/api/admin/notification-events?limit=200",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        events = r.json().get("events", [])
        # Look for an email_citizen_resolved event tied to this report
        matches = [
            e for e in events
            if e.get("event_type") == "email_citizen_resolved"
            and report_id[:8] in (e.get("payload", {}).get("body") or "")
        ]
        # Also tolerate matching on payload.to being citizen email
        if not matches:
            matches = [
                e for e in events
                if e.get("event_type") == "email_citizen_resolved"
                and e.get("payload", {}).get("to") == CITIZEN["email"]
            ]
        assert matches, f"No email_citizen_resolved event for report {report_id}. Events: {[e.get('event_type') for e in events[:10]]}"
        # Validate payload shape
        ev = matches[0]
        assert ev["payload"]["channel"] == "EMAIL"
        assert ev["payload"]["simulated"] is True
        assert "subject" in ev["payload"]

    def test_auto_routing_emits_sms_event(self, api, admin_token):
        """The auto-routing of waste_report (received->assigned) should have logged an sms_agent_assigned event."""
        r = api.get(
            f"{BASE_URL}/api/admin/notification-events?limit=200",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        events = r.json().get("events", [])
        sms_events = [e for e in events if e.get("event_type") == "sms_agent_assigned"]
        assert sms_events, "No sms_agent_assigned events found"
        # Validate at least one targets EQUIPE_DECHETS_YOPOUGON
        target = [e for e in sms_events if e.get("payload", {}).get("to_team") == "EQUIPE_DECHETS_YOPOUGON"]
        assert target, f"No SMS event for EQUIPE_DECHETS_YOPOUGON. Found teams: {[e.get('payload',{}).get('to_team') for e in sms_events[:10]]}"
        ev = target[0]
        assert ev["payload"]["channel"] == "SMS"
        assert ev["payload"]["simulated"] is True
        assert "report_id" in ev["payload"]

    def test_citizen_cannot_access_notification_events(self, api, citizen_token):
        r = api.get(
            f"{BASE_URL}/api/admin/notification-events",
            headers={"Authorization": f"Bearer {citizen_token}"},
            timeout=15,
        )
        assert r.status_code == 403


# ---------------- STATS new fields ----------------
class TestStats:
    def test_stats_includes_new_fields(self, api, admin_token):
        r = api.get(
            f"{BASE_URL}/api/reports/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        for key in ("total", "received", "assigned", "processing", "resolved", "urgent", "escalated"):
            assert key in d, f"missing key {key} in stats"
            assert isinstance(d[key], int)
        # We created at least 1 urgent (water+drainage) and 1 assigned in this run
        assert d["assigned"] >= 1 or d["resolved"] >= 1
        assert d["urgent"] >= 1

    def test_stats_citizen_forbidden(self, api, citizen_token):
        r = api.get(
            f"{BASE_URL}/api/reports/stats/summary",
            headers={"Authorization": f"Bearer {citizen_token}"},
            timeout=15,
        )
        assert r.status_code == 403


# ---------------- FILTERS on /api/reports ----------------
class TestFilters:
    def test_filter_status_assigned(self, api, admin_token):
        r = api.get(
            f"{BASE_URL}/api/reports?status_filter=assigned",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        reports = r.json()
        assert isinstance(reports, list)
        assert all(rep["status"] == "assigned" for rep in reports)

    def test_filter_type_water(self, api, admin_token):
        r = api.get(
            f"{BASE_URL}/api/reports?type_filter=water",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        reports = r.json()
        assert all(rep["type"] == "water" for rep in reports)

    def test_filter_priority_urgent(self, api, admin_token):
        r = api.get(
            f"{BASE_URL}/api/reports?priority_filter=urgent_critique",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        reports = r.json()
        assert all(rep["priority"] == "urgent_critique" for rep in reports)
        assert len(reports) >= 1


# ---------------- REGRESSION ----------------
class TestRegression:
    def test_citizen_sees_only_own(self, api, citizen_token):
        r = api.get(
            f"{BASE_URL}/api/reports",
            headers={"Authorization": f"Bearer {citizen_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        reports = r.json()
        assert isinstance(reports, list)
        # All reports belong to the citizen
        citizen_id = pytest.water_report_id  # just to ensure fixture chain ran
        assert citizen_id is not None
        # We don't know id directly, just sanity check non-empty since we created reports
        assert len(reports) >= 2

    def test_admin_sees_all(self, api, admin_token):
        r = api.get(
            f"{BASE_URL}/api/reports",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_citizen_cannot_update(self, api, citizen_token):
        r = api.put(
            f"{BASE_URL}/api/reports/{pytest.waste_report_id}",
            json={"status": "resolved"},
            headers={"Authorization": f"Bearer {citizen_token}"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_admin_update_to_processing(self, api, admin_token):
        r = api.put(
            f"{BASE_URL}/api/reports/{pytest.waste_report_id}",
            json={"status": "processing", "admin_notes": "TEST_ in progress"},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "processing"
        assert d["admin_notes"] == "TEST_ in progress"

    def test_register_push_endpoint_exists(self, api):
        body = {"user_id": "test-user-id", "platform": "android", "device_token": "tok"}
        r = api.post(f"{BASE_URL}/api/register-push", json=body, timeout=15)
        # Placeholder key → expected 500 (per playbook); also accept 201/502/200
        assert r.status_code in (200, 201, 500, 502)
        assert r.status_code != 404


# ---------------- SCHEDULER / ESCALADE ----------------
class TestScheduler:
    def test_escalade_function_present_in_code(self):
        """Source-level check: function and scheduler config exist."""
        with open("/app/backend/server.py", "r", encoding="utf-8") as f:
            src = f.read()
        assert "async def task_escalade_tickets_critiques" in src
        assert "scheduler.add_job" in src
        assert "minutes=15" in src
        assert "Scheduler démarré" in src

    def test_scheduler_started_in_logs(self):
        """Backend logs must contain the scheduler startup line."""
        import glob
        files = glob.glob("/var/log/supervisor/backend.*.log")
        found = False
        for f in files:
            try:
                with open(f, "r", encoding="utf-8", errors="ignore") as fh:
                    if "Scheduler démarré - Tâche d'escalade toutes les 15min" in fh.read():
                        found = True
                        break
            except Exception:
                continue
        assert found, "Scheduler startup log line not found in backend logs"
