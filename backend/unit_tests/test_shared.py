import asyncio
from datetime import timedelta

import httpx
import pytest
from fastapi import FastAPI, Header
from mongomock_motor import AsyncMongoMockClient
from shared import create_shared_router, delete_shared_identity, now


@pytest.fixture
async def shared_client():
    db = AsyncMongoMockClient()['shared_test']
    async def identity(x_user: str = Header('alice')):
        return {'user_id': x_user, 'name': x_user.title()}
    app = FastAPI()
    app.include_router(create_shared_router(lambda: db, identity))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as c:
        group = (await c.post('/shared/groups', json={'name': 'Trip', 'currency': 'INR'})).json()
        path = '/shared/groups/' + group['group_id']
        code = (await c.post(path+'/invitation')).json()['code']
        for uid in ['bob', 'carol']:
            assert (await c.post('/shared/join', headers={'x-user': uid}, json={'code': code})).status_code == 200
        yield c, db, path, code


def expense(**changes):
    return dict(request_id='expense-request-0001', description='Dinner', amount='100', paid_by='alice',
                participants=['alice', 'bob', 'carol'], **changes)


async def test_shared_balances_retries_and_repayment(shared_client):
    c, db, path, _ = shared_client
    results = await asyncio.gather(*[c.post(path+'/expenses', json=expense()) for _ in range(4)])
    assert all(r.status_code == 200 for r in results)
    assert await db.shared_entries.count_documents({}) == 1
    balance = (await c.get(path+'/balances')).json()
    assert balance['net'] == {'alice': 6666, 'bob': -3333, 'carol': -3333}
    assert (await c.get(path+'/balances', headers={'x-user': 'bob'})).json() == balance
    changed = expense(); changed['amount'] = '101'
    assert (await c.post(path+'/expenses', json=changed)).status_code == 409
    settlement = {'request_id': 'settlement-request-1', 'amount': '33.33', 'paid_by': 'bob', 'paid_to': 'alice'}
    assert (await c.post(path+'/settlements', headers={'x-user':'carol'}, json=settlement)).status_code == 403
    assert (await c.post(path+'/settlements', headers={'x-user':'bob'}, json=settlement)).status_code == 200
    net = (await c.get(path+'/balances')).json()['net']
    assert net == {'alice':3333, 'bob':0, 'carol':-3333}
    assert sum(net.values()) == 0
    assert await db.expenses.count_documents({}) == 0


async def test_permissions_invites_and_revocation(shared_client):
    c, db, path, code = shared_client
    for suffix in ['', '/entries', '/balances']:
        assert (await c.get(path+suffix, headers={'x-user':'outsider'})).status_code == 404
    assert (await c.post(path+'/expenses',headers={'x-user':'outsider'},json=expense())).status_code == 404
    assert (await c.post(path+'/invitation',headers={'x-user':'bob'})).status_code == 403
    assert (await c.delete(path+'/invitation',headers={'x-user':'bob'})).status_code == 403
    repeated = await c.post('/shared/join',headers={'x-user':'bob'},json={'code':code})
    assert len(repeated.json()['members']) == 3
    assert 'invite_hash' not in (await c.get(path)).text
    await c.delete(path+'/invitation')
    assert (await c.post('/shared/join',headers={'x-user':'outsider'},json={'code':code})).status_code == 404
    code = (await c.post(path+'/invitation')).json()['code']
    await db.shared_groups.update_one({}, {'$set':{'invite_expires':now()-timedelta(seconds=1)}})
    assert (await c.post('/shared/join',headers={'x-user':'outsider'},json={'code':code})).status_code == 404


@pytest.mark.parametrize('mode,values,expected', [
    ('exact', {'alice':'20','bob':'30','carol':'50'}, {'alice':2000,'bob':3000,'carol':5000}),
    ('percentage', {'alice':'20','bob':'30','carol':'50'}, {'alice':2000,'bob':3000,'carol':5000}),
    ('ratio', {'alice':'1','bob':'1','carol':'2'}, {'alice':2500,'bob':2500,'carol':5000}),
])
async def test_split_modes(shared_client,mode,values,expected):
    c,_,path,_ = shared_client
    r = await c.post(path+'/expenses',json=expense(split_mode=mode,values=values))
    assert r.status_code == 200, r.text
    assert r.json()['allocations'] == expected


@pytest.mark.parametrize('changes', [
    {'amount':'NaN'}, {'amount':'Infinity'}, {'amount':'1.001'}, {'paid_by':'outsider'},
    {'participants':['alice','alice']}, {'participants':['outsider']},
    {'split_mode':'percentage','values':{'alice':'20','bob':'20','carol':'20'}},
    {'split_mode':'exact','values':{'alice':'20','bob':'20','carol':'20'}},
    {'split_mode':'ratio','values':{'alice':'-1','bob':'1','carol':'1'}},
    {'expense_date':'2999-01-01'},
])
async def test_invalid_entries_never_persist(shared_client,changes):
    c,db,path,_ = shared_client
    body=expense(); body.update(changes)
    assert (await c.post(path+'/expenses',json=body)).status_code in (400,422)
    assert await db.shared_entries.count_documents({}) == 0


async def test_correction_preserves_audit_and_paging(shared_client):
    c,db,path,_ = shared_client
    first=(await c.post(path+'/expenses',json=expense())).json()
    body=expense(); body['request_id']='expense-request-0002'
    second=(await c.post(path+'/expenses',headers={'x-user':'bob'},json=body)).json()
    url=path+'/entries/'+first['entry_id']+'/void'
    assert (await c.post(url,headers={'x-user':'bob'},json={'reason':'Mistake'})).status_code == 404
    assert (await c.post(url,json={'reason':'Duplicate'})).status_code == 200
    await c.post(url,json={'reason':'Changed reason'})
    row=await db.shared_entries.find_one({'entry_id':first['entry_id']})
    assert row['void_reason'] == 'Duplicate'
    assert (await c.get(path+'/balances')).json()['total_expenses_minor'] == 10000
    page=(await c.get(path+'/entries?limit=1')).json()
    assert page['items'][0]['entry_id'] == second['entry_id']
    older=(await c.get(path+'/entries',params={'before':page['next_cursor']})).json()
    assert older['items'][0]['voided'] is True
    assert older['next_cursor'] is None
    assert (await c.get(path+'/entries?before=foreign')).status_code == 400


async def test_deleted_owner_loses_access_and_history_remains(shared_client):
    c,db,path,code = shared_client
    await c.post(path+'/expenses',json=expense())
    await delete_shared_identity(db,'alice')
    assert (await c.get(path)).status_code == 404
    group=(await c.get(path,headers={'x-user':'bob'})).json()
    assert group['members'][0] == {'user_id':'alice','name':'Deleted member','role':'former','active':False}
    assert group['members'][1]['role'] == 'owner'
    assert (await c.post('/shared/join',headers={'x-user':'outsider'},json={'code':code})).status_code == 404
    assert (await c.get(path+'/balances',headers={'x-user':'bob'})).json()['net']['bob'] == -3333
    await delete_shared_identity(db,'bob')
    await delete_shared_identity(db,'carol')
    assert await db.shared_groups.count_documents({}) == 0
    assert await db.shared_entries.count_documents({}) == 0


async def test_jpy_uses_whole_yen(shared_client):
    c,_,_,_=shared_client
    group=(await c.post('/shared/groups',json={'name':'Japan','currency':'JPY'})).json()
    path='/shared/groups/'+group['group_id']
    body=expense(); body.update(amount='10',participants=['alice'])
    assert (await c.post(path+'/expenses',json=body)).json()['amount_minor'] == 10
    body.update(amount='10.5',request_id='another-request-0001')
    assert (await c.post(path+'/expenses',json=body)).status_code == 400
