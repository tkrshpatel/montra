from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import httpx
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ========================= Models =========================
class SessionExchangeRequest(BaseModel):
    session_id: str


class UserPublic(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    currency: str = "USD"


class SessionResponse(BaseModel):
    session_token: str
    user: UserPublic


class ExpenseCreate(BaseModel):
    amount: float
    currency: str = "USD"
    category: str = "Other"
    merchant: Optional[str] = None
    notes: Optional[str] = None
    date: Optional[str] = None
    split_with: List[str] = []
    shares: Optional[List[Dict[str, Any]]] = None  # [{"participant_id": "self"|friend_id, "share": number}]
    group_id: Optional[str] = None
    receipt_image_base64: Optional[str] = None


class Expense(BaseModel):
    expense_id: str
    user_id: str
    amount: float
    currency: str
    category: str
    merchant: Optional[str] = None
    notes: Optional[str] = None
    date: str
    split_with: List[str] = []
    shares: Optional[List[Dict[str, Any]]] = None
    group_id: Optional[str] = None
    created_at: str
    is_split: bool = False
    has_receipt: bool = False


class FriendCreate(BaseModel):
    name: str
    email: Optional[str] = None


class Friend(BaseModel):
    friend_id: str
    user_id: str
    name: str
    email: Optional[str] = None
    created_at: str


class ScanRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"


class ScanResult(BaseModel):
    amount: Optional[float] = None
    currency: Optional[str] = None
    merchant: Optional[str] = None
    date: Optional[str] = None
    category: Optional[str] = None
    raw: Optional[str] = None


class CurrencyUpdate(BaseModel):
    currency: str


class SettlementCreate(BaseModel):
    friend_id: str
    amount: float
    currency: str = "USD"
    note: Optional[str] = None


class Settlement(BaseModel):
    settlement_id: str
    user_id: str
    friend_id: str
    amount: float
    currency: str
    note: Optional[str] = None
    created_at: str


class GroupCreate(BaseModel):
    name: str
    member_ids: List[str] = []


class Group(BaseModel):
    group_id: str
    user_id: str
    name: str
    member_ids: List[str] = []
    created_at: str


class RecurringCreate(BaseModel):
    amount: float
    currency: str = "USD"
    category: str = "Other"
    merchant: Optional[str] = None
    notes: Optional[str] = None
    cadence: str = "monthly"
    start_date: Optional[str] = None
    split_with: List[str] = []
    group_id: Optional[str] = None


class Recurring(BaseModel):
    recurring_id: str
    user_id: str
    amount: float
    currency: str
    category: str
    merchant: Optional[str] = None
    notes: Optional[str] = None
    cadence: str
    next_run: str
    active: bool = True
    split_with: List[str] = []
    group_id: Optional[str] = None
    created_at: str


# ========================= Auth =========================
async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@api_router.post("/auth/session", response_model=SessionResponse)
async def auth_session(payload: SessionExchangeRequest):
    session_id = payload.session_id
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    try:
        async with httpx.AsyncClient(timeout=15.0) as http_client:
            resp = await http_client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": session_id},
            )
    except Exception:
        logger.exception("Emergent session-data call failed")
        raise HTTPException(status_code=401, detail="Auth exchange failed")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session_id")
    data = resp.json()
    email = data.get("email")
    name = data.get("name") or (email.split("@")[0] if email else "User")
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not (email and session_token):
        raise HTTPException(status_code=401, detail="Malformed auth response")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
        currency = existing.get("currency", "USD")
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        currency = "USD"
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": name,
            "picture": picture, "currency": currency,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    return SessionResponse(
        session_token=session_token,
        user=UserPublic(user_id=user_id, email=email, name=name, picture=picture, currency=currency),
    )


@api_router.get("/auth/me", response_model=UserPublic)
async def auth_me(user=Depends(get_current_user)):
    return UserPublic(
        user_id=user["user_id"], email=user["email"], name=user["name"],
        picture=user.get("picture"), currency=user.get("currency", "USD"),
    )


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


SUPPORTED_CURRENCIES = ("USD", "INR", "EUR", "GBP", "JPY")


@api_router.post("/auth/currency", response_model=UserPublic)
async def update_currency(payload: CurrencyUpdate, user=Depends(get_current_user)):
    cur = (payload.currency or "").upper()
    if cur not in SUPPORTED_CURRENCIES:
        raise HTTPException(status_code=400, detail=f"Currency must be one of {SUPPORTED_CURRENCIES}")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"currency": cur}})
    return UserPublic(
        user_id=user["user_id"], email=user["email"], name=user["name"],
        picture=user.get("picture"), currency=cur,
    )


# ========================= Friends =========================
@api_router.post("/friends", response_model=Friend)
async def create_friend(payload: FriendCreate, user=Depends(get_current_user)):
    friend_id = f"frd_{uuid.uuid4().hex[:12]}"
    doc = {
        "friend_id": friend_id, "user_id": user["user_id"],
        "name": payload.name.strip(),
        "email": (payload.email or "").strip() or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.friends.insert_one(doc)
    doc.pop("_id", None)
    return Friend(**doc)


@api_router.get("/friends", response_model=List[Friend])
async def list_friends(user=Depends(get_current_user)):
    cursor = db.friends.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(1000)
    return [Friend(**item) for item in items]


@api_router.delete("/friends/{friend_id}")
async def delete_friend(friend_id: str, user=Depends(get_current_user)):
    res = await db.friends.delete_one({"friend_id": friend_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Friend not found")
    return {"ok": True}


# ========================= Groups =========================
@api_router.post("/groups", response_model=Group)
async def create_group(payload: GroupCreate, user=Depends(get_current_user)):
    group_id = f"grp_{uuid.uuid4().hex[:12]}"
    doc = {
        "group_id": group_id, "user_id": user["user_id"],
        "name": payload.name.strip(),
        "member_ids": payload.member_ids or [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.groups.insert_one(doc)
    doc.pop("_id", None)
    return Group(**doc)


@api_router.get("/groups", response_model=List[Group])
async def list_groups(user=Depends(get_current_user)):
    cursor = db.groups.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(1000)
    return [Group(**item) for item in items]


@api_router.delete("/groups/{group_id}")
async def delete_group(group_id: str, user=Depends(get_current_user)):
    res = await db.groups.delete_one({"group_id": group_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"ok": True}


# ========================= Recurring =========================
def _advance(dt: datetime, cadence: str) -> datetime:
    if cadence == "weekly":
        return dt + timedelta(days=7)
    year = dt.year + (1 if dt.month == 12 else 0)
    month = 1 if dt.month == 12 else dt.month + 1
    day = min(dt.day, 28)
    return dt.replace(year=year, month=month, day=day)


async def materialize_recurring(user_id: str) -> int:
    now = datetime.now(timezone.utc)
    created = 0
    cursor = db.recurring.find({"user_id": user_id, "active": True}, {"_id": 0})
    async for r in cursor:
        try:
            nr = datetime.fromisoformat(r["next_run"])
            if nr.tzinfo is None:
                nr = nr.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        while nr <= now:
            exp_id = f"exp_{uuid.uuid4().hex[:12]}"
            split_with = r.get("split_with") or []
            exp_doc = {
                "expense_id": exp_id, "user_id": user_id,
                "amount": float(r["amount"]), "currency": r["currency"],
                "category": r.get("category", "Other"),
                "merchant": r.get("merchant"),
                "notes": (r.get("notes") or "Recurring"),
                "date": nr.isoformat(),
                "split_with": split_with,
                "group_id": r.get("group_id"),
                "is_split": bool(split_with),
                "recurring_id": r["recurring_id"],
                "created_at": now.isoformat(),
            }
            try:
                await db.expenses.insert_one(exp_doc)
                created += 1
            except Exception as e:
                logger.warning(f"materialize insert failed: {e}")
            nr = _advance(nr, r.get("cadence", "monthly"))
        await db.recurring.update_one(
            {"recurring_id": r["recurring_id"], "user_id": user_id},
            {"$set": {"next_run": nr.isoformat()}},
        )
    return created


@api_router.post("/recurring", response_model=Recurring)
async def create_recurring(payload: RecurringCreate, user=Depends(get_current_user)):
    rid = f"rec_{uuid.uuid4().hex[:12]}"
    if payload.cadence not in ("monthly", "weekly"):
        raise HTTPException(status_code=400, detail="cadence must be monthly or weekly")
    if payload.start_date:
        try:
            start_dt = datetime.fromisoformat(payload.start_date)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid start_date")
    else:
        start_dt = datetime.now(timezone.utc)
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)
    doc = {
        "recurring_id": rid, "user_id": user["user_id"],
        "amount": float(payload.amount), "currency": payload.currency,
        "category": payload.category, "merchant": payload.merchant,
        "notes": payload.notes, "cadence": payload.cadence,
        "next_run": start_dt.isoformat(), "active": True,
        "split_with": payload.split_with or [],
        "group_id": payload.group_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.recurring.insert_one(doc)
    await materialize_recurring(user["user_id"])
    updated = await db.recurring.find_one({"recurring_id": rid}, {"_id": 0})
    return Recurring(**updated)


@api_router.get("/recurring", response_model=List[Recurring])
async def list_recurring(user=Depends(get_current_user)):
    cursor = db.recurring.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(1000)
    return [Recurring(**item) for item in items]


@api_router.delete("/recurring/{recurring_id}")
async def delete_recurring(recurring_id: str, user=Depends(get_current_user)):
    res = await db.recurring.delete_one({"recurring_id": recurring_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Recurring not found")
    return {"ok": True}


# ========================= Expenses =========================
@api_router.post("/expenses", response_model=Expense)
async def create_expense(payload: ExpenseCreate, user=Depends(get_current_user)):
    expense_id = f"exp_{uuid.uuid4().hex[:12]}"
    date_str = payload.date or datetime.now(timezone.utc).isoformat()
    split_with = payload.split_with or []
    if payload.group_id and not split_with and not payload.shares:
        grp = await db.groups.find_one({"group_id": payload.group_id, "user_id": user["user_id"]}, {"_id": 0})
        if grp:
            split_with = grp.get("member_ids", [])

    shares = None
    if payload.shares:
        # sanitize: keep only valid positive shares; ensure participant_id string
        cleaned = []
        friend_ids = set()
        for s in payload.shares:
            pid = str(s.get("participant_id") or "").strip()
            try:
                w = float(s.get("share"))
            except Exception:
                continue
            if pid and w > 0:
                cleaned.append({"participant_id": pid, "share": w})
                if pid != "self":
                    friend_ids.add(pid)
        shares = cleaned if cleaned else None
        # derive split_with from shares for compatibility
        if shares:
            split_with = [pid for pid in friend_ids]

    doc = {
        "expense_id": expense_id, "user_id": user["user_id"],
        "amount": float(payload.amount), "currency": payload.currency,
        "category": payload.category, "merchant": payload.merchant,
        "notes": payload.notes, "date": date_str,
        "split_with": split_with,
        "shares": shares,
        "group_id": payload.group_id,
        "is_split": bool(split_with) or bool(shares and len(shares) > 1),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "receipt_image_base64": payload.receipt_image_base64,
        "has_receipt": bool(payload.receipt_image_base64),
    }
    await db.expenses.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("receipt_image_base64", None)
    return Expense(**{k: v for k, v in doc.items() if k in Expense.model_fields})


@api_router.get("/expenses", response_model=List[Expense])
async def list_expenses(user=Depends(get_current_user)):
    try:
        await materialize_recurring(user["user_id"])
    except Exception as e:
        logger.warning(f"materialize failed: {e}")
    cursor = db.expenses.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "receipt_image_base64": 0},
    ).sort("date", -1)
    items = await cursor.to_list(1000)
    return [Expense(**{k: v for k, v in item.items() if k in Expense.model_fields}) for item in items]


@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(get_current_user)):
    res = await db.expenses.delete_one({"expense_id": expense_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"ok": True}


@api_router.get("/expenses/{expense_id}/receipt")
async def get_expense_receipt(expense_id: str, user=Depends(get_current_user)):
    exp = await db.expenses.find_one(
        {"expense_id": expense_id, "user_id": user["user_id"]},
        {"_id": 0, "receipt_image_base64": 1},
    )
    if not exp:
        raise HTTPException(status_code=404, detail="Expense not found")
    b64 = exp.get("receipt_image_base64")
    if not b64:
        raise HTTPException(status_code=404, detail="No receipt attached")
    return {"image_base64": b64, "mime_type": "image/jpeg"}


@api_router.get("/insights")
async def insights(month: Optional[str] = None, user=Depends(get_current_user)):
    """Monthly category breakdown in user's home currency.
    month: YYYY-MM (defaults to current month)
    """
    home = user.get("currency", "USD")
    now = datetime.now(timezone.utc)
    if month:
        try:
            y, m = month.split("-")
            year, mo = int(y), int(m)
            if not (1 <= mo <= 12):
                raise ValueError()
        except Exception:
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    else:
        year, mo = now.year, now.month

    cursor = db.expenses.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "receipt_image_base64": 0},
    )
    totals: Dict[str, float] = {}
    total = 0.0
    count = 0
    async for e in cursor:
        try:
            d = datetime.fromisoformat(e.get("date"))
        except Exception:
            continue
        if d.year != year or d.month != mo:
            continue
        amt = await convert_amount(float(e.get("amount", 0)), e.get("currency", home), home)
        cat = e.get("category") or "Other"
        totals[cat] = round(totals.get(cat, 0.0) + amt, 2)
        total += amt
        count += 1

    breakdown = sorted(
        [{"category": k, "amount": round(v, 2), "pct": (v / total * 100) if total > 0 else 0}
         for k, v in totals.items()],
        key=lambda x: -x["amount"],
    )
    return {
        "month": f"{year:04d}-{mo:02d}",
        "currency": home,
        "total": round(total, 2),
        "count": count,
        "breakdown": breakdown,
    }


# ========================= Settlements =========================
@api_router.post("/settlements", response_model=Settlement)
async def create_settlement(payload: SettlementCreate, user=Depends(get_current_user)):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")
    f = await db.friends.find_one({"friend_id": payload.friend_id, "user_id": user["user_id"]}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Friend not found")
    sid = f"stl_{uuid.uuid4().hex[:12]}"
    doc = {
        "settlement_id": sid, "user_id": user["user_id"],
        "friend_id": payload.friend_id, "amount": float(payload.amount),
        "currency": payload.currency, "note": payload.note,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.settlements.insert_one(doc)
    doc.pop("_id", None)
    return Settlement(**doc)


@api_router.get("/settlements", response_model=List[Settlement])
async def list_settlements(user=Depends(get_current_user)):
    cursor = db.settlements.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(1000)
    return [Settlement(**item) for item in items]


@api_router.delete("/settlements/{settlement_id}")
async def delete_settlement(settlement_id: str, user=Depends(get_current_user)):
    res = await db.settlements.delete_one({"settlement_id": settlement_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Settlement not found")
    return {"ok": True}


# ========================= FX =========================
_FX_CACHE: Dict[str, Any] = {"rates": None, "updated_at": None}
_FX_LOCK = asyncio.Lock()
_FX_TTL_SECONDS = 30 * 60


async def _fetch_fx() -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as hc:
        r = await hc.get("https://open.er-api.com/v6/latest/USD")
    r.raise_for_status()
    j = r.json()
    rates = j.get("rates") or {}
    return {
        "USD": 1.0,
        "INR": float(rates.get("INR", 83.0)),
        "EUR": float(rates.get("EUR", 0.92)),
        "GBP": float(rates.get("GBP", 0.79)),
        "JPY": float(rates.get("JPY", 150.0)),
    }


async def get_rates() -> Dict[str, float]:
    now = datetime.now(timezone.utc)
    async with _FX_LOCK:
        ts = _FX_CACHE.get("updated_at")
        if _FX_CACHE.get("rates") and ts and (now - ts).total_seconds() < _FX_TTL_SECONDS:
            return _FX_CACHE["rates"]
        try:
            rates = await _fetch_fx()
            _FX_CACHE["rates"] = rates
            _FX_CACHE["updated_at"] = now
            return rates
        except Exception as e:
            logger.warning(f"FX fetch failed, using fallback: {e}")
            if _FX_CACHE.get("rates"):
                return _FX_CACHE["rates"]
            fallback = {"USD": 1.0, "INR": 83.0, "EUR": 0.92, "GBP": 0.79, "JPY": 150.0}
            _FX_CACHE["rates"] = fallback
            _FX_CACHE["updated_at"] = now
            return fallback


async def convert_amount(amount: float, src: str, dst: str) -> float:
    src = (src or "USD").upper()
    dst = (dst or "USD").upper()
    if src == dst:
        return amount
    rates = await get_rates()
    if src not in rates or dst not in rates:
        return amount
    usd = amount / rates[src]
    return usd * rates[dst]


@api_router.get("/fx")
async def fx(user=Depends(get_current_user)):
    rates = await get_rates()
    ts = _FX_CACHE.get("updated_at")
    return {
        "base": "USD",
        "rates": rates,
        "updated_at": ts.isoformat() if ts else None,
    }


# ========================= Balances =========================
@api_router.get("/balances")
async def get_balances(user=Depends(get_current_user)):
    home = user.get("currency", "USD")
    friends_cursor = db.friends.find({"user_id": user["user_id"]}, {"_id": 0})
    friends = await friends_cursor.to_list(1000)
    friend_map = {f["friend_id"]: f for f in friends}

    balances: Dict[str, float] = {fid: 0.0 for fid in friend_map.keys()}
    exp_cursor = db.expenses.find(
        {"user_id": user["user_id"], "is_split": True},
        {"_id": 0, "receipt_image_base64": 0},
    )
    async for exp in exp_cursor:
        shares = exp.get("shares")
        if shares:
            total_w = sum(float(s.get("share", 0)) for s in shares)
            if total_w <= 0:
                continue
            for s in shares:
                pid = s.get("participant_id")
                if pid == "self" or not pid:
                    continue
                w = float(s.get("share", 0))
                if w <= 0:
                    continue
                share_amt = float(exp["amount"]) * (w / total_w)
                share_home = await convert_amount(share_amt, exp.get("currency", home), home)
                if pid in balances:
                    balances[pid] += share_home
            continue
        split_with = exp.get("split_with") or []
        if not split_with:
            continue
        share = float(exp["amount"]) / (1 + len(split_with))
        share_home = await convert_amount(share, exp.get("currency", home), home)
        for fid in split_with:
            if fid in balances:
                balances[fid] += share_home

    st_cursor = db.settlements.find({"user_id": user["user_id"]}, {"_id": 0})
    async for s in st_cursor:
        fid = s["friend_id"]
        if fid in balances:
            amt_home = await convert_amount(float(s["amount"]), s.get("currency", home), home)
            balances[fid] -= amt_home

    total_owed_to_me = 0.0
    per_friend = []
    for fid, amt in balances.items():
        rounded = round(amt, 2)
        f = friend_map[fid]
        per_friend.append({
            "friend_id": fid,
            "name": f["name"],
            "email": f.get("email"),
            "amount": rounded,
        })
        if rounded > 0:
            total_owed_to_me += rounded
    per_friend.sort(key=lambda x: -x["amount"])

    return {
        "total_owed_to_me": round(total_owed_to_me, 2),
        "currency": home,
        "friends": per_friend,
    }


# ========================= OCR =========================
@api_router.post("/scan", response_model=ScanResult)
async def scan_receipt(payload: ScanRequest, user=Depends(get_current_user)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")
    if not payload.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 required")

    system_msg = (
        "You are a receipt/invoice OCR extractor. Given an image of a receipt or invoice, "
        "extract structured data and return STRICT JSON with these keys: "
        "amount (number, the final total paid), currency (ISO code like USD, INR, EUR), "
        "merchant (string), date (YYYY-MM-DD if available), "
        "category (one of: Food, Groceries, Transport, Shopping, Bills, Entertainment, Travel, Health, Other). "
        "If a field is unknown use null. Return ONLY the JSON object, no markdown, no commentary."
    )
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"scan_{uuid.uuid4().hex[:8]}",
            system_message=system_msg,
        ).with_model("gemini", "gemini-3-flash-preview")
        image = ImageContent(image_base64=payload.image_base64)
        response_text = await chat.send_message(UserMessage(
            text="Extract the receipt data as strict JSON as specified.",
            file_contents=[image],
        ))
    except Exception as e:
        logger.exception("LLM scan failed")
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {str(e)}")

    import json, re
    text = (response_text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    parsed: Dict[str, Any] = {}
    try:
        parsed = json.loads(text)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except Exception:
                parsed = {}

    def _num(v):
        try:
            return None if v is None else float(v)
        except Exception:
            return None

    return ScanResult(
        amount=_num(parsed.get("amount")),
        currency=(parsed.get("currency") or None),
        merchant=(parsed.get("merchant") or None),
        date=(parsed.get("date") or None),
        category=(parsed.get("category") or None),
        raw=text[:2000] if text else None,
    )


# ========================= Misc =========================
@api_router.get("/")
async def root():
    return {"message": "SplitSync API", "ok": True}


@app.on_event("startup")
async def on_startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.expenses.create_index("user_id")
        await db.expenses.create_index("expense_id", unique=True)
        await db.friends.create_index("user_id")
        await db.friends.create_index("friend_id", unique=True)
        await db.groups.create_index("user_id")
        await db.groups.create_index("group_id", unique=True)
        await db.recurring.create_index("user_id")
        await db.recurring.create_index("recurring_id", unique=True)
        await db.settlements.create_index("user_id")
        await db.settlements.create_index("settlement_id", unique=True)
        logger.info("MongoDB indexes ready")
    except Exception as e:
        logger.warning(f"Index creation issue: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
