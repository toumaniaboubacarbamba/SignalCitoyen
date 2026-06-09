#!/usr/bin/env python3
"""
Backend API Testing Script for Citizen Reporting System
Tests all authentication and report endpoints with proper role-based access control
"""

import requests
import json
import sys
from typing import Dict, Optional

# Backend URL from environment
BACKEND_URL = "https://water-alert-ci.preview.emergentagent.com/api"

# Test credentials
CITIZEN_EMAIL = "citoyen@test.com"
CITIZEN_PASSWORD = "password123"
CITIZEN_NAME = "Jean Dupont"

ADMIN_EMAIL = "admin@test.com"
ADMIN_PASSWORD = "admin123"
ADMIN_NAME = "Admin Test"

# Global variables to store tokens and IDs
citizen_token = None
admin_token = None
citizen_user_id = None
admin_user_id = None
report_id = None

# Test results tracking
tests_passed = 0
tests_failed = 0
test_results = []


def log_test(test_name: str, passed: bool, message: str = ""):
    """Log test result"""
    global tests_passed, tests_failed
    
    status = "✅ PASS" if passed else "❌ FAIL"
    result = {
        "test": test_name,
        "passed": passed,
        "message": message
    }
    test_results.append(result)
    
    if passed:
        tests_passed += 1
        print(f"{status}: {test_name}")
    else:
        tests_failed += 1
        print(f"{status}: {test_name}")
        if message:
            print(f"   Error: {message}")


def test_register_citizen():
    """Test 1: Register citizen account"""
    global citizen_token, citizen_user_id
    
    try:
        response = requests.post(
            f"{BACKEND_URL}/auth/register",
            json={
                "email": CITIZEN_EMAIL,
                "password": CITIZEN_PASSWORD,
                "name": CITIZEN_NAME,
                "role": "citizen"
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            if "access_token" in data and "user" in data:
                citizen_token = data["access_token"]
                citizen_user_id = data["user"]["id"]
                if data["user"]["role"] == "citizen":
                    log_test("Register Citizen", True)
                    return True
                else:
                    log_test("Register Citizen", False, f"Wrong role: {data['user']['role']}")
                    return False
            else:
                log_test("Register Citizen", False, "Missing token or user in response")
                return False
        elif response.status_code == 400 and "déjà enregistré" in response.text:
            # User already exists, try to login instead
            log_test("Register Citizen", True, "User already exists (acceptable)")
            return True
        else:
            log_test("Register Citizen", False, f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Register Citizen", False, str(e))
        return False


def test_register_admin():
    """Test 2: Register admin account"""
    global admin_token, admin_user_id
    
    try:
        response = requests.post(
            f"{BACKEND_URL}/auth/register",
            json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD,
                "name": ADMIN_NAME,
                "role": "admin"
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            if "access_token" in data and "user" in data:
                admin_token = data["access_token"]
                admin_user_id = data["user"]["id"]
                if data["user"]["role"] == "admin":
                    log_test("Register Admin", True)
                    return True
                else:
                    log_test("Register Admin", False, f"Wrong role: {data['user']['role']}")
                    return False
            else:
                log_test("Register Admin", False, "Missing token or user in response")
                return False
        elif response.status_code == 400 and "déjà enregistré" in response.text:
            # User already exists, try to login instead
            log_test("Register Admin", True, "User already exists (acceptable)")
            return True
        else:
            log_test("Register Admin", False, f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Register Admin", False, str(e))
        return False


def test_login_citizen():
    """Test 3: Login as citizen"""
    global citizen_token, citizen_user_id
    
    try:
        response = requests.post(
            f"{BACKEND_URL}/auth/login",
            json={
                "email": CITIZEN_EMAIL,
                "password": CITIZEN_PASSWORD
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            if "access_token" in data and "user" in data:
                citizen_token = data["access_token"]
                citizen_user_id = data["user"]["id"]
                log_test("Login Citizen", True)
                return True
            else:
                log_test("Login Citizen", False, "Missing token or user in response")
                return False
        else:
            log_test("Login Citizen", False, f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Login Citizen", False, str(e))
        return False


def test_login_admin():
    """Test 4: Login as admin"""
    global admin_token, admin_user_id
    
    try:
        response = requests.post(
            f"{BACKEND_URL}/auth/login",
            json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            if "access_token" in data and "user" in data:
                admin_token = data["access_token"]
                admin_user_id = data["user"]["id"]
                log_test("Login Admin", True)
                return True
            else:
                log_test("Login Admin", False, "Missing token or user in response")
                return False
        else:
            log_test("Login Admin", False, f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Login Admin", False, str(e))
        return False


def test_create_report():
    """Test 5: Create report as citizen"""
    global report_id
    
    if not citizen_token:
        log_test("Create Report", False, "No citizen token available")
        return False
    
    try:
        response = requests.post(
            f"{BACKEND_URL}/reports",
            headers={"Authorization": f"Bearer {citizen_token}"},
            json={
                "type": "waste",
                "description": "Déchets sauvages rue Principale",
                "location": {
                    "latitude": 5.3599,
                    "longitude": -4.0083,
                    "address": "Abidjan, Côte d'Ivoire"
                },
                "photos": ["data:image/jpeg;base64,/9j/4AAQSkZJRg=="]
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            if "id" in data and data["status"] == "received":
                report_id = data["id"]
                log_test("Create Report", True)
                return True
            else:
                log_test("Create Report", False, f"Invalid response: {data}")
                return False
        else:
            log_test("Create Report", False, f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Create Report", False, str(e))
        return False


def test_get_reports_as_citizen():
    """Test 6: Get reports as citizen (should only see own reports)"""
    if not citizen_token:
        log_test("Get Reports (Citizen)", False, "No citizen token available")
        return False
    
    try:
        response = requests.get(
            f"{BACKEND_URL}/reports",
            headers={"Authorization": f"Bearer {citizen_token}"}
        )
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list):
                # Verify all reports belong to this citizen
                all_own_reports = all(r.get("user_id") == citizen_user_id for r in data)
                if all_own_reports:
                    log_test("Get Reports (Citizen)", True, f"Found {len(data)} own reports")
                    return True
                else:
                    log_test("Get Reports (Citizen)", False, "Citizen can see other users' reports")
                    return False
            else:
                log_test("Get Reports (Citizen)", False, "Response is not a list")
                return False
        else:
            log_test("Get Reports (Citizen)", False, f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Get Reports (Citizen)", False, str(e))
        return False


def test_get_reports_as_admin():
    """Test 7: Get reports as admin (should see all reports)"""
    if not admin_token:
        log_test("Get Reports (Admin)", False, "No admin token available")
        return False
    
    try:
        response = requests.get(
            f"{BACKEND_URL}/reports",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list):
                log_test("Get Reports (Admin)", True, f"Found {len(data)} total reports")
                return True
            else:
                log_test("Get Reports (Admin)", False, "Response is not a list")
                return False
        else:
            log_test("Get Reports (Admin)", False, f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Get Reports (Admin)", False, str(e))
        return False


def test_update_report_as_admin():
    """Test 8: Update report status as admin"""
    if not admin_token or not report_id:
        log_test("Update Report (Admin)", False, "No admin token or report ID available")
        return False
    
    try:
        # Update to processing
        response = requests.put(
            f"{BACKEND_URL}/reports/{report_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"status": "processing"}
        )
        
        if response.status_code == 200:
            data = response.json()
            if data["status"] == "processing":
                # Update to resolved
                response2 = requests.put(
                    f"{BACKEND_URL}/reports/{report_id}",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    json={"status": "resolved"}
                )
                
                if response2.status_code == 200:
                    data2 = response2.json()
                    if data2["status"] == "resolved":
                        log_test("Update Report (Admin)", True)
                        return True
                    else:
                        log_test("Update Report (Admin)", False, f"Status not updated to resolved: {data2['status']}")
                        return False
                else:
                    log_test("Update Report (Admin)", False, f"Second update failed: {response2.status_code}")
                    return False
            else:
                log_test("Update Report (Admin)", False, f"Status not updated to processing: {data['status']}")
                return False
        else:
            log_test("Update Report (Admin)", False, f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Update Report (Admin)", False, str(e))
        return False


def test_update_report_as_citizen():
    """Test 9: Verify citizen cannot update report (should get 403)"""
    if not citizen_token or not report_id:
        log_test("Update Report (Citizen - Should Fail)", False, "No citizen token or report ID available")
        return False
    
    try:
        response = requests.put(
            f"{BACKEND_URL}/reports/{report_id}",
            headers={"Authorization": f"Bearer {citizen_token}"},
            json={"status": "processing"}
        )
        
        if response.status_code == 403:
            log_test("Update Report (Citizen - Should Fail)", True, "Correctly denied with 403")
            return True
        else:
            log_test("Update Report (Citizen - Should Fail)", False, f"Expected 403, got {response.status_code}")
            return False
    except Exception as e:
        log_test("Update Report (Citizen - Should Fail)", False, str(e))
        return False


def test_get_stats_as_admin():
    """Test 10: Get stats as admin"""
    if not admin_token:
        log_test("Get Stats (Admin)", False, "No admin token available")
        return False
    
    try:
        response = requests.get(
            f"{BACKEND_URL}/reports/stats/summary",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        if response.status_code == 200:
            data = response.json()
            required_fields = ["total", "received", "processing", "resolved"]
            if all(field in data for field in required_fields):
                log_test("Get Stats (Admin)", True, f"Stats: {data}")
                return True
            else:
                log_test("Get Stats (Admin)", False, f"Missing required fields: {data}")
                return False
        else:
            log_test("Get Stats (Admin)", False, f"Status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Get Stats (Admin)", False, str(e))
        return False


def test_get_stats_as_citizen():
    """Test 11: Verify citizen cannot access stats (should get 403)"""
    if not citizen_token:
        log_test("Get Stats (Citizen - Should Fail)", False, "No citizen token available")
        return False
    
    try:
        response = requests.get(
            f"{BACKEND_URL}/reports/stats/summary",
            headers={"Authorization": f"Bearer {citizen_token}"}
        )
        
        if response.status_code == 403:
            log_test("Get Stats (Citizen - Should Fail)", True, "Correctly denied with 403")
            return True
        else:
            log_test("Get Stats (Citizen - Should Fail)", False, f"Expected 403, got {response.status_code}")
            return False
    except Exception as e:
        log_test("Get Stats (Citizen - Should Fail)", False, str(e))
        return False


def run_all_tests():
    """Run all tests in sequence"""
    print("=" * 80)
    print("BACKEND API TESTING - CITIZEN REPORTING SYSTEM")
    print("=" * 80)
    print(f"Backend URL: {BACKEND_URL}")
    print()
    
    # Auth tests
    print("--- AUTHENTICATION TESTS ---")
    test_register_citizen()
    test_register_admin()
    test_login_citizen()
    test_login_admin()
    print()
    
    # Report tests
    print("--- REPORT TESTS ---")
    test_create_report()
    test_get_reports_as_citizen()
    test_get_reports_as_admin()
    test_update_report_as_admin()
    test_update_report_as_citizen()
    print()
    
    # Stats tests
    print("--- STATS TESTS ---")
    test_get_stats_as_admin()
    test_get_stats_as_citizen()
    print()
    
    # Summary
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total Tests: {tests_passed + tests_failed}")
    print(f"Passed: {tests_passed}")
    print(f"Failed: {tests_failed}")
    print()
    
    if tests_failed > 0:
        print("FAILED TESTS:")
        for result in test_results:
            if not result["passed"]:
                print(f"  - {result['test']}: {result['message']}")
        print()
        return 1
    else:
        print("✅ ALL TESTS PASSED!")
        return 0


if __name__ == "__main__":
    exit_code = run_all_tests()
    sys.exit(exit_code)
