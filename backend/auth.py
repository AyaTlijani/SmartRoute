"""
auth.py — Accounts, login sessions and role checks.

Two roles:
    admin   imports orders, dispatches, manages drivers, sees analytics
    driver  sees and updates only the orders assigned to them

Passwords are hashed with PBKDF2-SHA256 (Python standard library, no extra
dependency). A login returns a random session token stored in the sessions
table; the frontend sends it as "Authorization: Bearer <token>".
Logging out deletes the session, so the token stops working immediately.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from db import connect

router = APIRouter(prefix="/auth", tags=["Auth"])

_ITERATIONS = 200_000
SESSION_DAYS = 7


# ============================================================================
# PASSWORDS
# ============================================================================

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, expected = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations))
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, AttributeError):
        return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ============================================================================
# CURRENT USER
# ============================================================================

class CurrentUser(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    driver_id: Optional[int] = None


def current_user(authorization: Optional[str] = Header(None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Please log in.")
    token = authorization.split(" ", 1)[1].strip()
    with connect() as conn:
        row = conn.execute(
            "SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token = ?",
            (token,),
        ).fetchone()
        if not row or row["expires_at"] < _now().isoformat():
            raise HTTPException(401, "Your session has expired. Please log in again.")
        if not row["active"]:
            raise HTTPException(403, "This account is disabled.")
        return CurrentUser(**{k: row[k] for k in CurrentUser.model_fields})


def require_admin(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(403, "Admins only.")
    return user


def require_driver(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role != "driver" or not user.driver_id:
        raise HTTPException(403, "Drivers only.")
    return user


# ============================================================================
# ENDPOINTS
# ============================================================================

class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(req: LoginRequest):
    with connect() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (req.username.strip(),)).fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(401, "Wrong username or password.")
        if not user["active"]:
            raise HTTPException(403, "This account is disabled. Contact your admin.")
        token = secrets.token_urlsafe(32)
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_now().isoformat(),))
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
            (token, user["id"], (_now() + timedelta(days=SESSION_DAYS)).isoformat()),
        )
        return {
            "token": token,
            "user": {k: user[k] for k in ("id", "username", "full_name", "role", "driver_id")},
        }


@router.post("/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and " " in authorization:
        with connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (authorization.split(" ", 1)[1].strip(),))
    return {"ok": True}


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)):
    return user


class ChangePassword(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(req: ChangePassword, user: CurrentUser = Depends(current_user)):
    if len(req.new_password) < 6:
        raise HTTPException(400, "Use at least 6 characters.")
    with connect() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user.id,)).fetchone()
        if not verify_password(req.current_password, row["password_hash"]):
            raise HTTPException(400, "Current password is wrong.")
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(req.new_password), user.id))
    return {"ok": True}
