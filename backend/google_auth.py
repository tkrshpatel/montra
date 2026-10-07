"""Direct Google OAuth with single-use state and a PKCE-bound app handoff."""
import base64
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')


class Start(BaseModel):
    redirect_uri: str
    code_challenge: str = Field(pattern=r'^[A-Za-z0-9_-]{43}$')


class Exchange(BaseModel):
    code: str = Field(min_length=32, max_length=256)
    code_verifier: str = Field(pattern=r'^[A-Za-z0-9._~-]{43,128}$')


def create_google_router(db, issue_session):
    router = APIRouter(prefix='/auth/google')

    def configuration():
        values = [os.getenv(k, '') for k in ('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL')]
        if not all(values):
            raise HTTPException(503, 'Google sign-in is not configured yet')
        return values

    @router.post('/start')
    async def start(payload: Start):
        client_id, _, callback = configuration()
        allowed = {s.strip() for s in os.getenv('AUTH_REDIRECT_URIS', 'montra://').split(',') if s.strip()}
        if payload.redirect_uri not in allowed:
            raise HTTPException(400, 'Unregistered sign-in redirect')
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
        await db.oauth_states.insert_one({
            '_id': digest(state), 'redirect_uri': payload.redirect_uri,
            'challenge': payload.code_challenge, 'verifier': verifier,
            'expires_at': datetime.now(timezone.utc) + timedelta(minutes=10),
        })
        return {'url': 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode({
            'client_id': client_id, 'redirect_uri': callback, 'response_type': 'code',
            'scope': 'openid email profile', 'state': state,
            'code_challenge': challenge(verifier), 'code_challenge_method': 'S256',
            'prompt': 'select_account',
        })}

    @router.get('/callback')
    async def callback(state: str = '', code: str = '', error: str = ''):
        client_id, secret, callback_url = configuration()
        transaction = await db.oauth_states.find_one_and_delete({
            '_id': digest(state), 'expires_at': {'$gt': datetime.now(timezone.utc)},
        })
        if not transaction:
            raise HTTPException(400, 'Sign-in expired. Please start again.')
        headers = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}
        def redirect(params):
            return RedirectResponse(transaction['redirect_uri'] + '#' + urlencode(params), headers=headers)
        if error or not code:
            return redirect({'auth_error': 'Sign-in was cancelled. Please try again.'})
        try:
            async with httpx.AsyncClient(timeout=15) as http:
                response = await http.post('https://oauth2.googleapis.com/token', data={
                    'code': code, 'client_id': client_id, 'client_secret': secret,
                    'redirect_uri': callback_url, 'grant_type': 'authorization_code',
                    'code_verifier': transaction['verifier'],
                })
                response.raise_for_status()
                token = response.json()['access_token']
                response = await http.get('https://openidconnect.googleapis.com/v1/userinfo',
                                          headers={'Authorization': f'Bearer {token}'})
                response.raise_for_status()
                profile = response.json()
            if not profile.get('sub') or profile.get('email_verified') is not True or not profile.get('email'):
                return redirect({'auth_error': 'A verified Google email is required.'})
            user = await db.users.find_one({'google_sub': profile['sub']}, {'_id': 0})
            if not user:
                # Never merge accounts merely because a client supplies the same email.
                # Legacy account linking requires an explicit migration before release.
                if await db.users.find_one({'email': profile['email']}):
                    return redirect({'auth_error': 'An existing account needs migration. Contact Montra support.'})
                user = {
                    'user_id': 'user_' + secrets.token_hex(12), 'google_sub': profile['sub'],
                    'email': profile['email'], 'name': profile.get('name') or 'Montra user',
                    'picture': profile.get('picture'), 'currency': 'USD',
                    'created_at': datetime.now(timezone.utc).isoformat(),
                }
                await db.users.update_one({'google_sub': profile['sub']}, {'$setOnInsert': user}, upsert=True)
                user = await db.users.find_one({'google_sub': profile['sub']}, {'_id': 0})
            handoff = secrets.token_urlsafe(32)
            await db.oauth_codes.insert_one({
                '_id': digest(handoff), 'user_id': user['user_id'],
                'challenge': transaction['challenge'],
                'expires_at': datetime.now(timezone.utc) + timedelta(minutes=1),
            })
            return redirect({'auth_code': handoff})
        except (httpx.HTTPError, KeyError, ValueError):
            return redirect({'auth_error': 'Google sign-in failed. Please try again.'})

    @router.post('/exchange')
    async def exchange(payload: Exchange):
        record = await db.oauth_codes.find_one_and_delete({
            '_id': digest(payload.code), 'challenge': challenge(payload.code_verifier),
            'expires_at': {'$gt': datetime.now(timezone.utc)},
        })
        if not record:
            raise HTTPException(401, 'Invalid or expired sign-in code')
        user = await db.users.find_one({'user_id': record['user_id']}, {'_id': 0})
        if not user:
            raise HTTPException(401, 'Account no longer exists')
        return await issue_session(user)

    return router
