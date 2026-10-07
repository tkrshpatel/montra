import asyncio
import importlib
import os
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('MONGO_URL', 'mongodb://localhost:27017')
os.environ.setdefault('DB_NAME', 'montra_unit_only')
import server
from google_auth import challenge, create_google_router, digest
from ledger import allocations, friend_effect


@pytest.fixture
async def client(monkeypatch):
    db = AsyncMongoMockClient()['montra_unit_only']
    monkeypatch.setattr(server, 'db', db)
    async def identity():
        return {'user_id': 'u1', 'email': 'a@example.com', 'name': 'A', 'currency': 'USD'}
    server.app.dependency_overrides[server.get_current_user] = identity
    async def convert(amount, src, dst):
        return amount
    monkeypatch.setattr(server, 'convert_amount', convert)
    await db.friends.insert_one({'friend_id': 'bob', 'user_id': 'u1', 'name': 'Bob', 'created_at': '2026-01-01'})
    await db.friends.insert_one({'friend_id': 'eve', 'user_id': 'u2', 'name': 'Eve', 'created_at': '2026-01-01'})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url='http://test') as c:
        yield c, db
    server.app.dependency_overrides.clear()


def test_allocation_preserves_every_cent():
    for cur, total in [('USD', '10.00'), ('JPY', '10')]:
        exp = {'amount': total, 'currency': cur, 'split_with': ['a', 'b']}
        parts = allocations(exp)
        assert sum(parts.values()) == Decimal(total)
        assert max(parts.values()) - min(parts.values()) <= (Decimal(1) if cur == 'JPY' else Decimal('.01'))


def test_payer_changes_only_own_bilateral_debt():
    exp = {'amount': 90, 'currency': 'USD', 'split_with': ['bob', 'carol'], 'paid_by': 'bob'}
    assert friend_effect(exp, 'bob') == -30
    assert friend_effect(exp, 'carol') == 0
    exp['paid_by'] = 'self'
    assert friend_effect(exp, 'bob') == 30


@pytest.mark.asyncio
async def test_friend_paid_then_i_repay(client):
    c, db = client
    expense = await c.post('/api/expenses', json={'amount': 100, 'paid_by': 'bob', 'split_with': ['bob']})
    assert expense.status_code == 200, expense.text
    balance = (await c.get('/api/balances')).json()
    assert balance['net_balance'] == -50
    assert balance['total_i_owe'] == 50
    history = (await c.get('/api/friends/bob/history')).json()
    assert history['net_home'] == -50
    paid = await c.post('/api/settlements', json={'friend_id': 'bob', 'amount': 20, 'direction': 'paid'})
    assert paid.status_code == 200
    assert (await c.get('/api/balances')).json()['net_balance'] == -30
    await c.post('/api/settlements', json={'friend_id': 'bob', 'amount': 30, 'direction': 'paid'})
    assert (await c.get('/api/balances')).json()['net_balance'] == 0
    assert (await c.get('/api/friends/bob/history')).json()['net_home'] == 0


@pytest.mark.asyncio
async def test_legacy_expense_and_received_payment(client):
    c, db = client
    await c.post('/api/expenses', json={'amount': 100, 'split_with': ['bob']})
    await c.post('/api/settlements', json={'friend_id': 'bob', 'amount': 15})
    assert (await c.get('/api/balances')).json()['net_balance'] == 35


@pytest.mark.asyncio
@pytest.mark.parametrize('body', [
    {'amount': 1, 'split_with': ['eve']},
    {'amount': 1, 'group_id': 'unknown'},
    {'amount': 1, 'paid_by': 'bob'},
    {'amount': 1, 'shares': [{'participant_id':'self','share':1}, {'participant_id':'self','share':2}]},
    {'amount': 1, 'shares': [{'participant_id':'self','share':'inf'}]},
    {'amount': 0}, {'amount': -1},
])
async def test_invalid_expenses_not_persisted(client, body):
    c, db = client
    response = await c.post('/api/expenses', json=body)
    assert response.status_code in (400, 422), response.text
    assert await db.expenses.count_documents({}) == 0


@pytest.mark.asyncio
async def test_invalid_settlement_currency(client):
    c, db = client
    r = await c.post('/api/settlements', json={'friend_id': 'bob', 'amount': 10, 'currency': 'XYZ'})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_recurring_concurrent_refresh_is_idempotent(client):
    c, db = client
    await db.expenses.create_index('expense_id', unique=True)
    now = datetime.now(timezone.utc)
    await db.recurring.insert_one({'recurring_id': 'r1','user_id':'u1','active':True,'amount':10,
                                  'currency':'USD','cadence':'weekly','next_run':(now-timedelta(days=8)).isoformat()})
    await asyncio.gather(*[server.materialize_recurring('u1') for _ in range(5)])
    assert await db.expenses.count_documents({}) == 2


@pytest.mark.asyncio
async def test_session_is_hashed_and_revocable(client):
    _, db = client
    result = await server.issue_session({'user_id':'u1','email':'a@example.com','name':'A'})
    token = result['session_token']
    record = await db.user_sessions.find_one({})
    assert token not in str(record)
    await db.users.insert_one({'user_id':'u1','email':'a@example.com','name':'A'})
    assert (await server.get_current_user('Bearer '+token))['user_id'] == 'u1'
    await server.auth_logout('Bearer '+token)
    assert await db.user_sessions.count_documents({}) == 0


@pytest.mark.asyncio
async def test_google_handoff_rejects_wrong_verifier_replay_and_expiry(monkeypatch):
    from fastapi import FastAPI
    db = AsyncMongoMockClient()['oauth_test']
    app = FastAPI()
    async def issue(user): return {'user_id': user['user_id']}
    app.include_router(create_google_router(db, issue))
    await db.users.insert_one({'user_id':'u1'})
    verifier, code = 'a'*64, 'b'*43
    await db.oauth_codes.insert_one({'_id':digest(code),'user_id':'u1','challenge':challenge(verifier),
                                    'expires_at':datetime.now(timezone.utc)+timedelta(minutes=1)})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as c:
        assert (await c.post('/auth/google/exchange',json={'code':code,'code_verifier':'c'*64})).status_code == 401
        assert (await c.post('/auth/google/exchange',json={'code':code,'code_verifier':verifier})).status_code == 200
        assert (await c.post('/auth/google/exchange',json={'code':code,'code_verifier':verifier})).status_code == 401
        await db.oauth_codes.insert_one({'_id':digest(code),'user_id':'u1','challenge':challenge(verifier),
                                        'expires_at':datetime.now(timezone.utc)-timedelta(seconds=1)})
        assert (await c.post('/auth/google/exchange',json={'code':code,'code_verifier':verifier})).status_code == 401


@pytest.mark.asyncio
async def test_google_redirect_allowlist(monkeypatch):
    from fastapi import FastAPI
    monkeypatch.setenv('GOOGLE_CLIENT_ID','client')
    monkeypatch.setenv('GOOGLE_CLIENT_SECRET','secret')
    monkeypatch.setenv('GOOGLE_CALLBACK_URL','https://api.example.com/api/auth/google/callback')
    monkeypatch.setenv('AUTH_REDIRECT_URIS','montra://')
    app=FastAPI();db=AsyncMongoMockClient()['oauth_redirect_test']
    app.include_router(create_google_router(db, None))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as c:
        bad=await c.post('/auth/google/start',json={'redirect_uri':'https://evil.example','code_challenge':challenge('a'*64)})
        assert bad.status_code == 400
        good=await c.post('/auth/google/start',json={'redirect_uri':'montra://','code_challenge':challenge('a'*64)})
        assert good.status_code == 200
        assert good.json()['url'].startswith('https://accounts.google.com/')


@pytest.mark.asyncio
async def test_receipt_requires_configuration(client, monkeypatch):
    c,_=client
    monkeypatch.setattr(server,'GEMINI_API_KEY','')
    assert (await c.post('/api/scan',json={'image_base64':'abc'})).status_code == 503


def test_monthly_keeps_original_day_after_short_month():
    january = datetime(2026, 1, 31, tzinfo=timezone.utc)
    february = server._advance(january, 'monthly', 31)
    march = server._advance(february, 'monthly', 31)
    assert february.day == 28
    assert march.day == 31


@pytest.mark.asyncio
async def test_stored_hash_cannot_be_used_as_bearer(client):
    _, db = client
    await server.issue_session({'user_id':'u1','email':'a@example.com','name':'A'})
    record=await db.user_sessions.find_one({})
    await db.users.insert_one({'user_id':'u1','email':'a@example.com','name':'A'})
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        await server.get_current_user('Bearer '+record['session_token'])


@pytest.mark.asyncio
async def test_group_and_recurring_reject_foreign_contacts(client):
    c,db=client
    assert (await c.post('/api/groups',json={'name':'Trip','member_ids':['eve']})).status_code == 400
    assert (await c.post('/api/recurring',json={'amount':10,'split_with':['eve']})).status_code == 400


@pytest.mark.asyncio
async def test_deleting_old_expense_recalculates_clearance(client):
    c,db=client
    expense=(await c.post('/api/expenses',json={'amount':100,'split_with':['bob']})).json()
    await c.post('/api/settlements',json={'friend_id':'bob','amount':50})
    assert (await c.get('/api/balances')).json()['net_balance'] == 0
    await c.delete('/api/expenses/'+expense['expense_id'])
    assert (await c.get('/api/balances')).json()['net_balance'] == -50


@pytest.mark.asyncio
async def test_amount_precision_rejected(client):
    c,_=client
    for amount,currency in [(1.005,'USD'),(1.5,'JPY'),(1e15,'USD')]:
        assert (await c.post('/api/expenses',json={'amount':amount,'currency':currency})).status_code == 400


@pytest.mark.asyncio
async def test_direct_receipt_provider(client, monkeypatch):
    c,_=client
    monkeypatch.setattr(server,'GEMINI_API_KEY','test-secret')
    monkeypatch.setattr(server,'GEMINI_MODEL','test-model')
    server._SCAN_HITS.clear()
    requests=[]
    async def provider(request):
        requests.append(request)
        return httpx.Response(200,json={'candidates':[{'content':{'parts':[{'text':'{"amount":42,"merchant":"Cafe","currency":"USD"}'}]}}]})
    original=httpx.AsyncClient
    monkeypatch.setattr(server.httpx,'AsyncClient',lambda **kw: original(transport=httpx.MockTransport(provider)))
    r=await c.post('/api/scan',json={'image_base64':'aGVsbG8=','mime_type':'image/jpeg'})
    assert r.status_code==200, r.text
    assert r.json()['amount']==42
    assert requests[0].url.host=='generativelanguage.googleapis.com'
    assert requests[0].headers['x-goog-api-key']=='test-secret'
    assert (await c.post('/api/scan',json={'image_base64':'!!!','mime_type':'image/jpeg'})).status_code==400
    assert (await c.post('/api/scan',json={'image_base64':'aGVsbG8=','mime_type':'application/pdf'})).status_code==400


@pytest.mark.asyncio
async def test_google_callback_and_exchange_end_to_end(monkeypatch):
    from fastapi import FastAPI
    from urllib.parse import urlparse, parse_qs
    import google_auth
    monkeypatch.setenv('GOOGLE_CLIENT_ID','client')
    monkeypatch.setenv('GOOGLE_CLIENT_SECRET','secret')
    monkeypatch.setenv('GOOGLE_CALLBACK_URL','https://api.example.com/api/auth/google/callback')
    monkeypatch.setenv('AUTH_REDIRECT_URIS','montra://')
    db=AsyncMongoMockClient()['oauth_flow']
    app=FastAPI()
    async def issue(user): return {'user_id':user['user_id'],'email':user['email']}
    app.include_router(create_google_router(db,issue))
    original=httpx.AsyncClient
    async def provider(request):
        if request.url.path=='/token': return httpx.Response(200,json={'access_token':'provider-token'})
        return httpx.Response(200,json={'sub':'google-user-1','email':'verified@example.com','email_verified':True,'name':'Test'})
    async with original(transport=httpx.ASGITransport(app=app),base_url='http://test') as c:
        monkeypatch.setattr(google_auth.httpx,'AsyncClient',lambda **kw: original(transport=httpx.MockTransport(provider)))
        verifier='v'*64
        started=await c.post('/auth/google/start',json={'redirect_uri':'montra://','code_challenge':challenge(verifier)})
        state=parse_qs(urlparse(started.json()['url']).query)['state'][0]
        callback=await c.get('/auth/google/callback',params={'state':state,'code':'provider-code'})
        assert callback.status_code==307
        assert callback.headers['cache-control']=='no-store'
        code=parse_qs(urlparse(callback.headers['location']).fragment)['auth_code'][0]
        exchanged=await c.post('/auth/google/exchange',json={'code':code,'code_verifier':verifier})
        assert exchanged.json()['email']=='verified@example.com'
        assert (await c.get('/auth/google/callback',params={'state':state,'code':'provider-code'})).status_code==400
        assert await db.users.count_documents({})==1
