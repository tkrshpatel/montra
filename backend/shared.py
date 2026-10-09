"""Shared group ledger. Membership never grants access to personal collections."""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone, date
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

CURRENCIES = {'USD', 'INR', 'EUR', 'GBP', 'JPY'}


def now():
    return datetime.now(timezone.utc)


def minor_units(value, currency):
    try:
        number = Decimal(str(value))
        scale = 1 if currency == 'JPY' else 100
        scaled = number * scale
        if not number.is_finite() or number <= 0 or number > Decimal('1000000000') or scaled != scaled.to_integral_value():
            raise ValueError()
        return int(scaled)
    except (InvalidOperation, ValueError):
        raise HTTPException(400, 'Enter a positive amount with the correct currency precision')


def allocate(total, participants, mode, values):
    if len(participants) != len(set(participants)):
        raise HTTPException(400, 'Each participant must appear once')
    if mode != 'equal' and set(values) != set(participants):
        raise HTTPException(400, 'Enter a split value for every selected participant')
    try:
        weights = {uid: Decimal(str(values[uid])) if mode != 'equal' else Decimal(1) for uid in participants}
        if any(not w.is_finite() or w <= 0 or w > Decimal('1000000000') for w in weights.values()):
            raise ValueError()
    except (InvalidOperation, ValueError):
        raise HTTPException(400, 'Split values must be positive numbers')
    weight_sum = sum(weights.values())
    if mode == 'percentage' and weight_sum != 100:
        raise HTTPException(400, 'Percentages must add up to 100')
    exact = {uid: Decimal(total) * w / weight_sum for uid, w in weights.items()}
    result = {uid: int(v.to_integral_value(rounding=ROUND_DOWN)) for uid, v in exact.items()}
    for uid in sorted(result, key=lambda uid: (-(exact[uid] - result[uid]), uid))[:total-sum(result.values())]:
        result[uid] += 1
    return result


class CreateGroup(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    currency: Literal['USD', 'INR', 'EUR', 'GBP', 'JPY'] = 'USD'


class JoinGroup(BaseModel):
    code: str = Field(min_length=20, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')


class ExpenseInput(BaseModel):
    request_id: str = Field(min_length=16, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')
    description: str = Field(min_length=1, max_length=200)
    amount: str = Field(min_length=1, max_length=40)
    paid_by: str
    participants: list[str] = Field(min_length=1, max_length=50)
    split_mode: Literal['equal', 'ratio', 'percentage', 'exact'] = 'equal'
    values: dict[str, str] = Field(default_factory=dict)
    expense_date: date | None = None


class SettlementInput(BaseModel):
    request_id: str = Field(min_length=16, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')
    amount: str = Field(min_length=1, max_length=40)
    paid_by: str
    paid_to: str
    note: str = Field(default='', max_length=200)


class VoidInput(BaseModel):
    reason: str = Field(min_length=1, max_length=200)


def public_group(group):
    return {k: group[k] for k in ('group_id', 'name', 'currency', 'members', 'created_at')}


def create_shared_router(get_db, identity):
    router = APIRouter(prefix='/shared')

    async def member(group_id, user):
        group = await get_db().shared_groups.find_one({
            'group_id': group_id,
            'members': {'$elemMatch': {'user_id': user['user_id'], 'active': True}},
        })
        if not group:
            raise HTTPException(404, 'Group not found')
        return group

    def is_owner(group, uid):
        return any(m['user_id'] == uid and m['role'] == 'owner' and m['active'] for m in group['members'])

    async def save_entry(group, user, payload, fields):
        uid = user['user_id']
        entry_id = hashlib.sha256(f"{group['group_id']}:{uid}:{payload.request_id}".encode()).hexdigest()
        fingerprint = hashlib.sha256(json.dumps(payload.model_dump(mode='json'), sort_keys=True).encode()).hexdigest()
        document = {'_id': entry_id, 'entry_id': entry_id, 'group_id': group['group_id'],
                    'created_by': uid, 'created_at': now().isoformat(), 'fingerprint': fingerprint,
                    'currency': group['currency'], 'voided': False, **fields}
        try:
            await get_db().shared_entries.insert_one(document)
        except DuplicateKeyError:
            existing = await get_db().shared_entries.find_one({'_id': entry_id})
            if existing['fingerprint'] != fingerprint:
                raise HTTPException(409, 'This request was already used for different details. Refresh and try again.')
            document = existing
        return {k: v for k, v in document.items() if k not in ('_id', 'fingerprint')}

    @router.post('/groups')
    async def create(payload: CreateGroup, user=Depends(identity)):
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, 'Enter a group name')
        group = {'group_id': 'grp_' + secrets.token_hex(12), 'name': name, 'currency': payload.currency,
                 'created_at': now().isoformat(),
                 'members': [{'user_id': user['user_id'], 'name': user['name'], 'role': 'owner', 'active': True}]}
        await get_db().shared_groups.insert_one(group)
        return public_group(group)

    @router.get('/groups')
    async def groups(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), user=Depends(identity)):
        cursor = get_db().shared_groups.find({'members': {'$elemMatch': {'user_id': user['user_id'], 'active': True}}})
        items = await cursor.sort([('created_at', -1), ('group_id', -1)]).skip(offset).limit(limit+1).to_list(limit+1)
        return {'items': [public_group(g) for g in items[:limit]], 'has_more': len(items)>limit}

    @router.get('/groups/{group_id}')
    async def detail(group_id: str, user=Depends(identity)):
        return public_group(await member(group_id, user))

    @router.post('/groups/{group_id}/invitation')
    async def invite(group_id: str, user=Depends(identity)):
        group = await member(group_id, user)
        if not is_owner(group, user['user_id']):
            raise HTTPException(403, 'Only the group owner can invite members')
        code = secrets.token_urlsafe(24)
        expiry = now() + timedelta(days=7)
        await get_db().shared_groups.update_one({'group_id': group_id}, {'$set': {
            'invite_hash': hashlib.sha256(code.encode()).hexdigest(), 'invite_expires': expiry}})
        return {'code': code, 'expires_at': expiry.isoformat()}

    @router.delete('/groups/{group_id}/invitation')
    async def revoke(group_id: str, user=Depends(identity)):
        group = await member(group_id, user)
        if not is_owner(group, user['user_id']):
            raise HTTPException(403, 'Only the group owner can revoke invitations')
        await get_db().shared_groups.update_one({'group_id': group_id}, {'$unset': {'invite_hash': '', 'invite_expires': ''}})
        return {'ok': True}

    @router.post('/join')
    async def join(payload: JoinGroup, user=Depends(identity)):
        query = {'invite_hash': hashlib.sha256(payload.code.encode()).hexdigest(), 'invite_expires': {'$gt': now()}}
        group = await get_db().shared_groups.find_one(query)
        if not group:
            raise HTTPException(404, 'This invitation is invalid, expired or revoked')
        if any(m['user_id'] == user['user_id'] for m in group['members']):
            return public_group(await member(group['group_id'], user))
        query.update({'group_id': group['group_id'], 'members.user_id': {'$ne': user['user_id']},
                      '$expr': {'$lt': [{'$size': '$members'}, 50]}})
        result = await get_db().shared_groups.update_one(query, {'$push': {'members': {
            'user_id': user['user_id'], 'name': user['name'], 'role': 'member', 'active': True}}})
        if not result.modified_count:
            refreshed = await get_db().shared_groups.find_one({'group_id': group['group_id'], 'members.user_id': user['user_id']})
            if not refreshed:
                raise HTTPException(409, 'Invitation changed or this group is full')
        return public_group(await member(group['group_id'], user))

    @router.post('/groups/{group_id}/expenses')
    async def expense(group_id: str, payload: ExpenseInput, user=Depends(identity)):
        group = await member(group_id, user)
        active = {m['user_id'] for m in group['members'] if m['active']}
        if payload.paid_by not in active or not set(payload.participants) <= active:
            raise HTTPException(400, 'Select current group members')
        if not payload.description.strip():
            raise HTTPException(400, 'Enter a description')
        if payload.expense_date and payload.expense_date > now().date():
            raise HTTPException(400, 'Expense date cannot be in the future')
        amount = minor_units(payload.amount, group['currency'])
        if payload.split_mode == 'exact':
            if set(payload.values) != set(payload.participants) or len(set(payload.participants)) != len(payload.participants):
                raise HTTPException(400, 'Enter one amount for each participant')
            parts = {uid: minor_units(payload.values[uid], group['currency']) for uid in payload.participants}
            if sum(parts.values()) != amount:
                raise HTTPException(400, 'Exact shares must add up to the expense total')
        else:
            parts = allocate(amount, payload.participants, payload.split_mode, payload.values)
        return await save_entry(group, user, payload, {
            'kind': 'expense', 'description': payload.description.strip(), 'amount_minor': amount,
            'paid_by': payload.paid_by, 'allocations': parts, 'split_mode': payload.split_mode,
            'expense_date': (payload.expense_date or now().date()).isoformat(),
        })

    @router.post('/groups/{group_id}/settlements')
    async def settlement(group_id: str, payload: SettlementInput, user=Depends(identity)):
        group = await member(group_id, user)
        active = {m['user_id'] for m in group['members'] if m['active']}
        if payload.paid_by == payload.paid_to or not {payload.paid_by, payload.paid_to} <= active:
            raise HTTPException(400, 'Choose two different current members')
        if user['user_id'] not in (payload.paid_by, payload.paid_to):
            raise HTTPException(403, 'You can only record payments you sent or received')
        return await save_entry(group, user, payload, {
            'kind': 'settlement', 'amount_minor': minor_units(payload.amount, group['currency']),
            'paid_by': payload.paid_by, 'paid_to': payload.paid_to, 'description': payload.note.strip() or 'Payment recorded',
        })

    @router.post('/groups/{group_id}/entries/{entry_id}/void')
    async def void(group_id: str, entry_id: str, payload: VoidInput, user=Depends(identity)):
        group = await member(group_id, user)
        query = {'entry_id': entry_id, 'group_id': group_id}
        if not is_owner(group, user['user_id']):
            query['created_by'] = user['user_id']
        entry = await get_db().shared_entries.find_one(query)
        if not entry:
            raise HTTPException(404, 'Entry not found or you cannot change it')
        if not payload.reason.strip():
            raise HTTPException(400, 'Enter a reason for the correction')
        await get_db().shared_entries.update_one({**query, 'voided': False}, {'$set': {
            'voided': True, 'voided_by': user['user_id'], 'voided_at': now().isoformat(), 'void_reason': payload.reason.strip()}})
        return {'ok': True}

    @router.get('/groups/{group_id}/entries')
    async def entries(group_id: str, before: str | None = None, limit: int = Query(30, ge=1, le=100), user=Depends(identity)):
        await member(group_id, user)
        query = {'group_id': group_id}
        if before:
            # A cursor is an entry ID, not a client-provided database query.
            anchor = await get_db().shared_entries.find_one({'entry_id': before, 'group_id': group_id})
            if not anchor:
                raise HTTPException(400, 'Invalid page cursor')
            query['$or'] = [{'created_at': {'$lt': anchor['created_at']}},
                            {'created_at': anchor['created_at'], 'entry_id': {'$lt': before}}]
        rows = await get_db().shared_entries.find(query, {'_id': 0, 'fingerprint': 0}).sort([
            ('created_at', -1), ('entry_id', -1)]).limit(limit+1).to_list(limit+1)
        return {'items': rows[:limit], 'next_cursor': rows[limit-1]['entry_id'] if len(rows)>limit else None}

    @router.get('/groups/{group_id}/balances')
    async def balances(group_id: str, user=Depends(identity)):
        group = await member(group_id, user)
        net = {m['user_id']: 0 for m in group['members']}
        total = 0
        async for row in get_db().shared_entries.find({'group_id': group_id, 'voided': False}):
            if row['kind'] == 'expense':
                total += row['amount_minor']
                net[row['paid_by']] += row['amount_minor']
                for uid, share in row['allocations'].items():
                    net[uid] -= share
            else:
                net[row['paid_by']] += row['amount_minor']
                net[row['paid_to']] -= row['amount_minor']
        debtors = [[uid, -amount] for uid, amount in sorted(net.items()) if amount < 0]
        creditors = [[uid, amount] for uid, amount in sorted(net.items()) if amount > 0]
        suggestions = []
        i = j = 0
        while i < len(debtors) and j < len(creditors):
            amount = min(debtors[i][1], creditors[j][1])
            suggestions.append({'paid_by': debtors[i][0], 'paid_to': creditors[j][0], 'amount_minor': amount})
            debtors[i][1] -= amount; creditors[j][1] -= amount
            if debtors[i][1] == 0: i += 1
            if creditors[j][1] == 0: j += 1
        return {'currency': group['currency'], 'total_expenses_minor': total, 'net': net, 'suggestions': suggestions}

    return router


async def delete_shared_identity(db, user_id):
    """Do not leave private profile names or access behind after account deletion."""
    async for group in db.shared_groups.find({'members.user_id': user_id}):
        remaining = [m for m in group['members'] if m['active'] and m['user_id'] != user_id]
        if not remaining:
            await db.shared_entries.delete_many({'group_id': group['group_id']})
            await db.shared_groups.delete_one({'group_id': group['group_id']})
            continue
        was_owner = any(m['user_id'] == user_id and m['role'] == 'owner' for m in group['members'])
        await db.shared_groups.update_one({'group_id': group['group_id'], 'members.user_id': user_id}, {'$set': {
            'members.$.active': False, 'members.$.name': 'Deleted member', 'members.$.role': 'former'},
            '$unset': {'invite_hash': '', 'invite_expires': ''}})
        if was_owner:
            await db.shared_groups.update_one({'group_id': group['group_id'], 'members.user_id': remaining[0]['user_id']},
                                             {'$set': {'members.$.role': 'owner'}})
