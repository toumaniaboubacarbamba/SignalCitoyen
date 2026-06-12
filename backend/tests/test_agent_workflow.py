"""
Backend integration tests for the NEW Agent role workflow (OSEA/SignalCitoyen).

Covers:
- Agent login (team_id propagation)
- GET /api/agent/reports
- POST /api/reports/{id}/start-intervention
- POST /api/reports/{id}/resolve
- POST /api/reports/{id}/reopen
- Regression on existing endpoints (auth, CRUD, auto-routing, notifications)
- New Report fields (proof_photos, agent_notes, resolved_by)
"""

import os
import time
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

CITIZEN = {"email": "citoyen@test.com", "password": "password123"}
ADMIN = {"email": "admin@test.com", "password": "admin123"}
AGENT_COCODY = {"email": "agent.cocody@test.com", "password": "agent123"}
AGENT_ADJAME = {"email": "agent.adjame@test.com", "password": "agent123"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()


def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def create_report_as_citizen(citizen_token, address="Cocody, Abidjan", type_="water"):
    body = {
        "type": type_,
        "description": "TEST_agent_workflow - fuite d'eau",
        "location": {"latitude": 5.35, "longitude": -3.99, "address": address},
        "photos": [],
    }
    r = requests.post(f"{API}/reports", json=body, headers=auth_headers(citizen_token), timeout=15)
    assert r.status_code == 200, f"create_report failed: {r.status_code} {r.text}"
    return r.json()


def wait_for_status(report_id, token, expected, attempts=10, delay=0.5):
    """Polls GET /reports/{id} until status == expected (used to wait for background routing)."""
    for _ in range(attempts):
        r = requests.get(f"{API}/reports/{report_id}", headers=auth_headers(token), timeout=10)
        if r.status_code == 200 and r.json().get("status") == expected:
            return r.json()
        time.sleep(delay)
    return r.json() if r.status_code == 200 else None


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def citizen_session():
    return login(CITIZEN)


@pytest.fixture(scope="module")
def admin_session():
    return login(ADMIN)


@pytest.fixture(scope="module")
def agent_cocody_session():
    return login(AGENT_COCODY)


@pytest.fixture(scope="module")
def agent_adjame_session():
    return login(AGENT_ADJAME)


# ---------------------------------------------------------------------------
# 1. Auth - Agent role login returns team_id
# ---------------------------------------------------------------------------

class TestAgentLogin:
    def test_agent_cocody_login_includes_team_id(self, agent_cocody_session):
        user = agent_cocody_session["user"]
        assert user["role"] == "agent"
        assert user["team_id"] == "EQUIPE_EAU_COCODY"
        assert user["email"] == "agent.cocody@test.com"

    def test_agent_adjame_login_includes_team_id(self, agent_adjame_session):
        user = agent_adjame_session["user"]
        assert user["role"] == "agent"
        assert user["team_id"] == "EQUIPE_ASSAINISSEMENT_ADJAME"

    def test_citizen_login_no_team_id(self, citizen_session):
        user = citizen_session["user"]
        assert user["role"] == "citizen"
        assert user.get("team_id") in (None, "")

    def test_admin_login(self, admin_session):
        assert admin_session["user"]["role"] == "admin"

    def test_auth_me_for_agent(self, agent_cocody_session):
        r = requests.get(f"{API}/auth/me", headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["team_id"] == "EQUIPE_EAU_COCODY"


# ---------------------------------------------------------------------------
# 2. Auto-routing (regression) - Cocody/water => EQUIPE_EAU_COCODY
# ---------------------------------------------------------------------------

class TestAutoRouting:
    def test_water_cocody_routes_to_eau_cocody(self, citizen_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        routed = wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        assert routed is not None, "Background routing didn't transition to 'assigned'"
        assert routed["team_id"] == "EQUIPE_EAU_COCODY"
        assert routed["zone"] == "COCODY"
        assert routed["priority"] == "urgent_critique"
        # New fields present
        assert "proof_photos" in routed
        assert "agent_notes" in routed
        assert "resolved_by" in routed
        assert routed["proof_photos"] == []


# ---------------------------------------------------------------------------
# 3. GET /api/agent/reports
# ---------------------------------------------------------------------------

class TestAgentReportsQueue:
    def test_agent_sees_only_his_team_tickets(self, citizen_session, agent_cocody_session, agent_adjame_session):
        # Seed one ticket routed to EAU_COCODY
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")

        r = requests.get(f"{API}/agent/reports", headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r.status_code == 200
        tickets = r.json()
        assert isinstance(tickets, list)
        # All returned tickets must belong to my team
        for t in tickets:
            assert t["team_id"] == "EQUIPE_EAU_COCODY"
        # The newly created ticket must be in the list
        assert any(t["id"] == rep["id"] for t in tickets)

        # Adjame agent must NOT see it
        r2 = requests.get(f"{API}/agent/reports", headers=auth_headers(agent_adjame_session["access_token"]), timeout=10)
        assert r2.status_code == 200
        for t in r2.json():
            assert t["team_id"] == "EQUIPE_ASSAINISSEMENT_ADJAME"
            assert t["id"] != rep["id"]

    def test_citizen_gets_403(self, citizen_session):
        r = requests.get(f"{API}/agent/reports", headers=auth_headers(citizen_session["access_token"]), timeout=10)
        assert r.status_code == 403

    def test_admin_gets_403(self, admin_session):
        r = requests.get(f"{API}/agent/reports", headers=auth_headers(admin_session["access_token"]), timeout=10)
        assert r.status_code == 403

    def test_unauthenticated_gets_401_or_403(self):
        r = requests.get(f"{API}/agent/reports", timeout=10)
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# 4. POST /api/reports/{id}/start-intervention
# ---------------------------------------------------------------------------

class TestStartIntervention:
    def test_agent_starts_intervention(self, citizen_session, agent_cocody_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")

        # Capture citizen notif count before
        before = requests.get(f"{API}/notifications", headers=auth_headers(citizen_session["access_token"]), timeout=10).json()
        before_count = len(before)

        r = requests.post(
            f"{API}/reports/{rep['id']}/start-intervention",
            headers=auth_headers(agent_cocody_session["access_token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "processing"

        # Verify persistence (GET as admin)
        time.sleep(0.5)
        after = requests.get(f"{API}/notifications", headers=auth_headers(citizen_session["access_token"]), timeout=10).json()
        assert len(after) > before_count, "Citizen did not receive a notification on intervention start"
        latest = after[0]
        assert latest["status"] == "processing"
        assert latest["report_id"] == rep["id"]

    def test_already_processing_returns_400(self, citizen_session, agent_cocody_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        # First call OK
        r1 = requests.post(f"{API}/reports/{rep['id']}/start-intervention",
                           headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r1.status_code == 200
        # Second call should fail
        r2 = requests.post(f"{API}/reports/{rep['id']}/start-intervention",
                           headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r2.status_code == 400

    def test_different_team_agent_gets_403(self, citizen_session, agent_adjame_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        r = requests.post(f"{API}/reports/{rep['id']}/start-intervention",
                          headers=auth_headers(agent_adjame_session["access_token"]), timeout=10)
        assert r.status_code == 403

    def test_non_existent_ticket_returns_404(self, agent_cocody_session):
        fake_id = "507f1f77bcf86cd799439011"
        r = requests.post(f"{API}/reports/{fake_id}/start-intervention",
                          headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r.status_code == 404

    def test_citizen_gets_403(self, citizen_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        r = requests.post(f"{API}/reports/{rep['id']}/start-intervention",
                          headers=auth_headers(citizen_session["access_token"]), timeout=10)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 5. POST /api/reports/{id}/resolve
# ---------------------------------------------------------------------------

class TestResolveReport:
    def test_agent_resolves_with_proof(self, citizen_session, agent_cocody_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        # start intervention
        requests.post(f"{API}/reports/{rep['id']}/start-intervention",
                      headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        body = {
            "proof_photos": ["data:image/jpeg;base64,abc"],
            "agent_notes": "Intervention terminée - TEST",
        }
        r = requests.post(f"{API}/reports/{rep['id']}/resolve", json=body,
                          headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "resolved"
        assert data["proof_photos"] == ["data:image/jpeg;base64,abc"]
        assert data["agent_notes"] == "Intervention terminée - TEST"
        assert data["resolved_by"] is not None and len(data["resolved_by"]) > 0

        # Citizen notification
        time.sleep(0.5)
        notifs = requests.get(f"{API}/notifications", headers=auth_headers(citizen_session["access_token"]), timeout=10).json()
        assert any(n["report_id"] == rep["id"] and n["status"] == "resolved" for n in notifs)

    def test_empty_proof_photos_returns_400(self, citizen_session, agent_cocody_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        r = requests.post(f"{API}/reports/{rep['id']}/resolve", json={"proof_photos": []},
                          headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r.status_code == 400

    def test_resolve_from_received_status_fails(self, citizen_session, agent_cocody_session):
        # Force a ticket to remain in 'received' state is hard since routing runs in background.
        # Instead: resolve twice - second time status will be 'resolved' (not assigned/processing) → 400.
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        body = {"proof_photos": ["data:image/jpeg;base64,xyz"]}
        r1 = requests.post(f"{API}/reports/{rep['id']}/resolve", json=body,
                           headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/reports/{rep['id']}/resolve", json=body,
                           headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r2.status_code == 400

    def test_different_team_agent_gets_403(self, citizen_session, agent_adjame_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        r = requests.post(f"{API}/reports/{rep['id']}/resolve",
                          json={"proof_photos": ["data:image/jpeg;base64,abc"]},
                          headers=auth_headers(agent_adjame_session["access_token"]), timeout=10)
        assert r.status_code == 403

    def test_citizen_gets_403(self, citizen_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        r = requests.post(f"{API}/reports/{rep['id']}/resolve",
                          json={"proof_photos": ["data:image/jpeg;base64,abc"]},
                          headers=auth_headers(citizen_session["access_token"]), timeout=10)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 6. POST /api/reports/{id}/reopen (admin)
# ---------------------------------------------------------------------------

class TestReopenReport:
    def _create_and_resolve(self, citizen_session, agent_cocody_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        requests.post(f"{API}/reports/{rep['id']}/start-intervention",
                      headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        body = {"proof_photos": ["data:image/jpeg;base64,abc"], "agent_notes": "init"}
        rr = requests.post(f"{API}/reports/{rep['id']}/resolve", json=body,
                           headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert rr.status_code == 200
        return rep["id"]

    def test_admin_reopens_resolved_ticket(self, citizen_session, agent_cocody_session, admin_session):
        rid = self._create_and_resolve(citizen_session, agent_cocody_session)
        reason = "Photos floues, intervention non vérifiable"
        r = requests.post(f"{API}/reports/{rid}/reopen", json={"reason": reason},
                          headers=auth_headers(admin_session["access_token"]), timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "assigned"
        assert data["admin_notes"] is not None
        assert "RÉOUVERTURE" in data["admin_notes"]
        assert reason in data["admin_notes"]

        # Citizen notified
        time.sleep(0.5)
        notifs = requests.get(f"{API}/notifications", headers=auth_headers(citizen_session["access_token"]), timeout=10).json()
        assert any(n["report_id"] == rid and n["status"] == "assigned" for n in notifs)

    def test_reopen_non_resolved_returns_400(self, citizen_session, admin_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        r = requests.post(f"{API}/reports/{rep['id']}/reopen", json={"reason": "test"},
                          headers=auth_headers(admin_session["access_token"]), timeout=10)
        assert r.status_code == 400

    def test_reopen_empty_reason_returns_400(self, citizen_session, agent_cocody_session, admin_session):
        rid = self._create_and_resolve(citizen_session, agent_cocody_session)
        r = requests.post(f"{API}/reports/{rid}/reopen", json={"reason": "   "},
                          headers=auth_headers(admin_session["access_token"]), timeout=10)
        assert r.status_code == 400

    def test_agent_cannot_reopen(self, citizen_session, agent_cocody_session):
        rid = self._create_and_resolve(citizen_session, agent_cocody_session)
        r = requests.post(f"{API}/reports/{rid}/reopen", json={"reason": "agent attempt"},
                          headers=auth_headers(agent_cocody_session["access_token"]), timeout=10)
        assert r.status_code == 403

    def test_citizen_cannot_reopen(self, citizen_session, agent_cocody_session):
        rid = self._create_and_resolve(citizen_session, agent_cocody_session)
        r = requests.post(f"{API}/reports/{rid}/reopen", json={"reason": "citizen attempt"},
                          headers=auth_headers(citizen_session["access_token"]), timeout=10)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 7. Regression: existing endpoints
# ---------------------------------------------------------------------------

class TestRegression:
    def test_citizen_reports_list(self, citizen_session):
        r = requests.get(f"{API}/reports", headers=auth_headers(citizen_session["access_token"]), timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # New fields present in serialization
        if data:
            assert "proof_photos" in data[0]
            assert "agent_notes" in data[0]
            assert "resolved_by" in data[0]

    def test_admin_reports_list(self, admin_session):
        r = requests.get(f"{API}/reports", headers=auth_headers(admin_session["access_token"]), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_stats(self, admin_session):
        r = requests.get(f"{API}/reports/stats/summary", headers=auth_headers(admin_session["access_token"]), timeout=10)
        assert r.status_code == 200
        data = r.json()
        for key in ("total", "received", "assigned", "processing", "resolved", "urgent", "escalated"):
            assert key in data, f"missing stat key: {key}"

    def test_admin_put_report_still_works(self, citizen_session, admin_session):
        rep = create_report_as_citizen(citizen_session["access_token"], "Cocody, Abidjan", "water")
        wait_for_status(rep["id"], citizen_session["access_token"], "assigned")
        r = requests.put(f"{API}/reports/{rep['id']}",
                         json={"admin_notes": "TEST admin note via PUT"},
                         headers=auth_headers(admin_session["access_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["admin_notes"] == "TEST admin note via PUT"

    def test_notifications_inbox(self, citizen_session):
        r = requests.get(f"{API}/notifications", headers=auth_headers(citizen_session["access_token"]), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_unread_count(self, citizen_session):
        r = requests.get(f"{API}/notifications/unread-count",
                         headers=auth_headers(citizen_session["access_token"]), timeout=10)
        assert r.status_code == 200
        assert "unread" in r.json()
