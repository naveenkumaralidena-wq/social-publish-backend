# OAuth Backend (Node.js + Express)

This repository contains a ready-to-run Node.js + Express OAuth backend that supports the following platforms:

- Facebook / Instagram (Meta)
- YouTube (Google)
- X (Twitter)
- Pinterest
- LinkedIn

It exposes start and callback endpoints for each provider, stores tokens in SQLite (suitable for MVP), and exposes a secure `GET /v1/users/:userId/credentials` endpoint for n8n to fetch user credentials.

The architecture diagram you uploaded is included here for reference: `/mnt/data/bd09a715-875e-4aa0-9ead-72e7355c3f75.png`

---

## Project structure

```
oauth-backend/
├─ package.json
├─ .env.example
├─ server.js
├─ db.js
├─ helpers/requests.js
├─ routes/
│  ├─ meta.js
│  ├─ youtube.js
│  ├─ x.js
│  ├─ pinterest.js
│  ├─ linkedin.js
│  └─ credentials.js
└─ README.md
```

---

## How to open this project in the editor
Open the canvas file created with this backend and copy files to your project folder, or create a new folder called `oauth-backend` and add the files from the canvas.

---

## What I created for you
I put the full runnable code for all files inside this single document. Each file is shown as a markdown section with the filename and code block. Copy each file into your project.

> Note: The diagram asset is referenced above by path: `/mnt/data/bd09a715-875e-4aa0-9ead-72e7355c3f75.png`. Your environment's UI will transform this local path into a previewable resource.

---

Below are the files. Copy each block into the correspondingly named file.


---

## `package.json`
```json
{
  "name": "oauth-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "axios": "^1.5.0",
    "better-sqlite3": "^8.2.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.0",
    "express": "^4.18.2",
    "query-string": "^8.1.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

---

## `.env.example`
```
PORT=4000

# Meta (Facebook / Instagram / Threads)
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
META_REDIRECT=https://yourdomain.com/auth/meta/callback

# YouTube (Google)
YOUTUBE_CLIENT_ID=your_youtube_client_id
YOUTUBE_CLIENT_SECRET=your_youtube_client_secret
YOUTUBE_REDIRECT=https://yourdomain.com/auth/youtube/callback

# X (Twitter)
X_CLIENT_ID=your_x_client_id
X_CLIENT_SECRET=your_x_client_secret
X_REDIRECT=https://yourdomain.com/auth/x/callback

# Pinterest
PINTEREST_CLIENT_ID=your_pinterest_client_id
PINTEREST_CLIENT_SECRET=your_pinterest_client_secret
PINTEREST_REDIRECT=https://yourdomain.com/auth/pinterest/callback

# LinkedIn
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
LINKEDIN_REDIRECT=https://yourdomain.com/auth/linkedin/callback

# Internal service token for n8n to fetch credentials
SERVICE_TOKEN=some-strong-secret-token

# Optional: path to sqlite DB file
DB_FILE=./data/oauth.db
```

---

## `db.js`
```js
// db.js
import Database from 'better-sqlite3';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const DB_FILE = process.env.DB_FILE || './data/oauth.db';
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

const db = new Database(DB_FILE);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  platform TEXT,
  platform_user_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  meta_json TEXT,
  expires_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
`);

export function saveAccount({ userId, platform, platformUserId, accessToken, refreshToken = null, meta = null, expiresAt = null }) {
  const stmt = db.prepare(`
    INSERT INTO social_accounts (user_id, platform, platform_user_id, access_token, refresh_token, meta_json, expires_at)
    VALUES (@userId, @platform, @platformUserId, @accessToken, @refreshToken, @meta, @expiresAt)
    ON CONFLICT(user_id, platform) DO UPDATE SET
      platform_user_id = excluded.platform_user_id,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      meta_json = excluded.meta_json,
      expires_at = excluded.expires_at
  `);
  return stmt.run({ userId, platform, platformUserId, accessToken, refreshToken, meta: meta ? JSON.stringify(meta) : null, expiresAt });
}

export function getAccountsForUser(userId) {
  const stmt = db.prepare(`SELECT * FROM social_accounts WHERE user_id = ?`);
  return stmt.all(userId).map(r => ({ ...r, meta: r.meta_json ? JSON.parse(r.meta_json) : null }));
}

export function getAccount(userId, platform) {
  const stmt = db.prepare(`SELECT * FROM social_accounts WHERE user_id = ? AND platform = ? LIMIT 1`);
  const r = stmt.get(userId, platform);
  return r ? { ...r, meta: r.meta_json ? JSON.parse(r.meta_json) : null } : null;
}

export function deleteAccount(userId, platform) {
  const stmt = db.prepare(`DELETE FROM social_accounts WHERE user_id = ? AND platform = ?`);
  return stmt.run(userId, platform);
}

export default db;
```

---

## `helpers/requests.js`
```js
// helpers/requests.js
import axios from 'axios';
export const http = axios.create({ timeout: 30_000 });
export default http;
```

---

## `routes/credentials.js`
```js
// routes/credentials.js
import express from 'express';
import { getAccountsForUser } from '../db.js';
const router = express.Router();

router.get('/v1/users/:userId/credentials', (req, res) => {
  const serviceToken = req.get('Authorization')?.replace('Bearer ', '');
  if (!serviceToken || serviceToken !== process.env.SERVICE_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { userId } = req.params;
  const accounts = getAccountsForUser(userId);
  const tokens = {};
  for (const a of accounts) {
    tokens[a.platform] = {
      access_token: a.access_token,
      refresh_token: a.refresh_token,
      platform_user_id: a.platform_user_id,
      meta: a.meta
    };
  }
  res.json({ userId, tokens });
});

export default router;
```

---

## `routes/meta.js` (Facebook / Instagram)
```js
// routes/meta.js
import express from 'express';
import queryString from 'query-string';
import { http } from '../helpers/requests.js';
import { saveAccount } from '../db.js';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT; // example: https://yourdomain.com/auth/meta/callback

router.get('/auth/meta/start', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).send('Missing user_id');
  const state = encodeURIComponent(JSON.stringify({ user_id }));
  const url = `https://www.facebook.com/v17.0/dialog/oauth?` + queryString.stringify({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'pages_show_list,instagram_basic,instagram_content_publish,pages_read_engagement,pages_manage_posts',
    state
  });
  res.redirect(url);
});

router.get('/auth/meta/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const parsedState = state ? JSON.parse(decodeURIComponent(state)) : {};
    const userId = parsedState.user_id || 'unknown';
    if (!code) return res.send('No code provided');

    const tokenRes = await http.get('https://graph.facebook.com/v17.0/oauth/access_token', {
      params: {
        client_id: APP_ID,
        redirect_uri: REDIRECT_URI,
        client_secret: APP_SECRET,
        code
      }
    });
    const shortToken = tokenRes.data.access_token;

    const longRes = await http.get('https://graph.facebook.com/v17.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortToken
      }
    });
    const longToken = longRes.data.access_token;
    const expiresAt = longRes.data.expires_in ? Math.floor(Date.now()/1000) + Number(longRes.data.expires_in) : null;

    const pagesRes = await http.get('https://graph.facebook.com/v17.0/me/accounts', {
      params: { access_token: longToken }
    });

    const pages = pagesRes.data.data || [];
    if (pages.length === 0) {
      saveAccount({
        userId,
        platform: 'facebook',
        platformUserId: parsedState.user_id || null,
        accessToken: longToken,
        refreshToken: null,
        meta: { note: 'no-pages' },
        expiresAt
      });
      return res.send('Connected to Facebook but no pages found.');
    }

    const page = pages[0];
    const pageAccessToken = page.access_token;
    const pageId = page.id;

    const pageInfo = await http.get(`https://graph.facebook.com/v17.0/${pageId}`, {
      params: { fields: 'connected_instagram_account', access_token: pageAccessToken }
    });
    const instagramAccount = pageInfo.data.connected_instagram_account;
    const instagramUserId = instagramAccount ? instagramAccount.id : null;

    saveAccount({
      userId,
      platform: 'facebook',
      platformUserId: pageId,
      accessToken: pageAccessToken,
      refreshToken: null,
      meta: { page_name: page.name },
      expiresAt: null
    });

    if (instagramUserId) {
      saveAccount({
        userId,
        platform: 'instagram',
        platformUserId: instagramUserId,
        accessToken: pageAccessToken,
        refreshToken: null,
        meta: { linked_page: pageId },
        expiresAt: null
      });
    }

    res.send(`<h3>Connected successfully!</h3><p>User: ${userId}. Instagram ID: ${instagramUserId || 'none'}.</p>`);
  } catch (err) {
    console.error('meta callback err', err.response?.data || err.message);
    res.status(500).send('Error during Facebook OAuth');
  }
});

export default router;
```

---

## `routes/youtube.js`
```js
// routes/youtube.js
import express from 'express';
import queryString from 'query-string';
import { http } from '../helpers/requests.js';
import dotenv from 'dotenv';
import { saveAccount } from '../db.js';
dotenv.config();

const router = express.Router();
const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT;

router.get('/auth/youtube/start', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).send('Missing user_id');
  const state = encodeURIComponent(JSON.stringify({ user_id }));
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + queryString.stringify({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'openid',
      'email',
      'profile'
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  res.redirect(url);
});

router.get('/auth/youtube/callback', async (req, res) => {
  const { code, state } = req.query;
  const parsedState = state ? JSON.parse(decodeURIComponent(state)) : {};
  const userId = parsedState.user_id || 'unknown';
  if (!code) return res.send('No code provided');

  try {
    const tokenRes = await http.post('https://oauth2.googleapis.com/token', queryString.stringify({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    }), { headers: { 'content-type': 'application/x-www-form-urlencoded' } });

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const me = await http.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'snippet,contentDetails', mine: true, access_token }
    });
    const channel = me.data.items && me.data.items[0];
    const channelId = channel?.id;

    saveAccount({
      userId,
      platform: 'youtube',
      platformUserId: channelId,
      accessToken: access_token,
      refreshToken: refresh_token,
      meta: { snippet: channel?.snippet },
      expiresAt: Math.floor(Date.now()/1000) + Number(expires_in)
    });

    res.send(`<h3>YouTube connected!</h3><p>Channel: ${channelId}</p>`);
  } catch (err) {
    console.error('youtube callback err', err.response?.data || err.message);
    res.status(500).send('Error handling YouTube OAuth');
  }
});

export default router;
```

---

## `routes/x.js`
```js
// routes/x.js
import express from 'express';
import queryString from 'query-string';
import { http } from '../helpers/requests.js';
import dotenv from 'dotenv';
import { saveAccount } from '../db.js';
dotenv.config();

const router = express.Router();
const CLIENT_ID = process.env.X_CLIENT_ID;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const REDIRECT_URI = process.env.X_REDIRECT;

router.get('/auth/x/start', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).send('Missing user_id');
  const state = encodeURIComponent(JSON.stringify({ user_id }));
  const url = 'https://twitter.com/i/oauth2/authorize?' + queryString.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: 'challenge',
    code_challenge_method: 'plain'
  });
  res.redirect(url);
});

router.get('/auth/x/callback', async (req, res) => {
  const { code, state } = req.query;
  const parsedState = state ? JSON.parse(decodeURIComponent(state)) : {};
  const userId = parsedState.user_id || 'unknown';
  if (!code) return res.send('No code');

  try {
    const tokenRes = await http.post('https://api.twitter.com/2/oauth2/token', queryString.stringify({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: 'challenge'
    }), { headers: { 'content-type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}` } });

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const userResp = await http.get('https://api.twitter.com/2/users/me', { headers: { Authorization: `Bearer ${access_token}` }});
    const platformUserId = userResp.data.data?.id;

    saveAccount({
      userId,
      platform: 'x',
      platformUserId,
      accessToken: access_token,
      refreshToken: refresh_token,
      meta: null,
      expiresAt: Math.floor(Date.now()/1000) + Number(expires_in)
    });

    res.send('<h3>X connected!</h3>');
  } catch (err) {
    console.error('x oauth err', err.response?.data || err.message);
    res.status(500).send('Error with X OAuth');
  }
});

export default router;
```

---

## `routes/pinterest.js`
```js
// routes/pinterest.js
import express from 'express';
import queryString from 'query-string';
import { http } from '../helpers/requests.js';
import dotenv from 'dotenv';
import { saveAccount } from '../db.js';
dotenv.config();

const router = express.Router();
const CLIENT_ID = process.env.PINTEREST_CLIENT_ID;
const CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET;
const REDIRECT_URI = process.env.PINTEREST_REDIRECT;

router.get('/auth/pinterest/start', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).send('Missing user_id');
  const state = encodeURIComponent(JSON.stringify({ user_id }));
  const url = 'https://www.pinterest.com/oauth/?' + queryString.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: 'pins:write,boards:read'
  });
  res.redirect(url);
});

router.get('/auth/pinterest/callback', async (req, res) => {
  const { code, state } = req.query;
  const parsedState = state ? JSON.parse(decodeURIComponent(state)) : {};
  const userId = parsedState.user_id || 'unknown';
  if (!code) return res.send('No code');

  try {
    const tokenRes = await http.post('https://api.pinterest.com/v5/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const me = await http.get('https://api.pinterest.com/v5/user_account', { headers: { Authorization: `Bearer ${access_token}` }});
    const platformUserId = me.data?.id;

    saveAccount({
      userId,
      platform: 'pinterest',
      platformUserId,
      accessToken: access_token,
      refreshToken: refresh_token,
      meta: me.data,
      expiresAt: Math.floor(Date.now()/1000) + Number(expires_in)
    });

    res.send('<h3>Pinterest connected!</h3>');
  } catch (err) {
    console.error('pinterest oauth err', err.response?.data || err.message);
    res.status(500).send('Pinterest OAuth Error');
  }
});

export default router;
```

---

## `routes/linkedin.js`
```js
// routes/linkedin.js
import express from 'express';
import queryString from 'query-string';
import { http } from '../helpers/requests.js';
import dotenv from 'dotenv';
import { saveAccount } from '../db.js';
dotenv.config();

const router = express.Router();
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT;

router.get('/auth/linkedin/start', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).send('Missing user_id');
  const state = encodeURIComponent(JSON.stringify({ user_id }));
  const url = 'https://www.linkedin.com/oauth/v2/authorization?' + queryString.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'w_member_social r_liteprofile',
    state
  });
  res.redirect(url);
});

router.get('/auth/linkedin/callback', async (req, res) => {
  const { code, state } = req.query;
  const parsedState = state ? JSON.parse(decodeURIComponent(state)) : {};
  const userId = parsedState.user_id || 'unknown';
  if (!code) return res.send('No code');

  try {
    const tokenRes = await http.post('https://www.linkedin.com/oauth/v2/accessToken', queryString.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    }), { headers: { 'content-type': 'application/x-www-form-urlencoded' } });

    const { access_token, expires_in } = tokenRes.data;

    // get basic user id
    const profile = await http.get('https://api.linkedin.com/v2/me', { headers: { Authorization: `Bearer ${access_token}` } });
    const platformUserId = profile.data.id;

    saveAccount({
      userId,
      platform: 'linkedin',
      platformUserId,
      accessToken: access_token,
      refreshToken: null,
      meta: profile.data,
      expiresAt: Math.floor(Date.now()/1000) + Number(expires_in)
    });

    res.send('<h3>LinkedIn connected!</h3>');
  } catch (err) {
    console.error('linkedin oauth err', err.response?.data || err.message);
    res.status(500).send('LinkedIn OAuth Error');
  }
});

export default router;
```

---

## `server.js`
```js
// server.js
import express from 'express';
import dotenv from 'dotenv';
dotenv.config();
import cors from 'cors';

import metaRoutes from './routes/meta.js';
import youtubeRoutes from './routes/youtube.js';
import xRoutes from './routes/x.js';
import pinterestRoutes from './routes/pinterest.js';
import linkedinRoutes from './routes/linkedin.js';
import credentialsRoutes from './routes/credentials.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(metaRoutes);
app.use(youtubeRoutes);
app.use(xRoutes);
app.use(pinterestRoutes);
app.use(linkedinRoutes);
app.use(credentialsRoutes);

app.get('/', (req, res) => {
  res.send('OAuth Backend Running. See README for endpoints.');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`OAuth backend listening on port ${PORT}`);
});
```

---

## `README.md` (brief)
```md
# OAuth Backend (Node.js + Express)

This project implements OAuth flows for multiple social platforms and stores user tokens in a local SQLite DB. It is meant for MVP and testing; migrate to a managed DB + secure storage for production.

## Quick start

1. Copy files into a folder
2. `npm install`
3. Create `.env` from `.env.example` and fill in client ids/secrets and redirect URIs
4. `npm run dev`
5. Visit `/auth/<platform>/start?user_id=your_user_id` to begin

Refer to the architecture diagram saved locally: `/mnt/data/bd09a715-875e-4aa0-9ead-72e7355c3f75.png`

## Notes
- Implement PKCE for X (Twitter) in production
- Secure `state` parameter and validate it to prevent CSRF
- Store tokens encrypted in production
```

---

## Final notes
- I included LinkedIn support and unified the endpoints.
- This backend is intentionally simple and easy to run for an MVP. For production you should:
  - Move from SQLite → Postgres
  - Encrypt tokens at rest
  - Use sessions or signed state storage for PKCE and CSRF protection
  - Add retry and refresh cron jobs

If you want, I can now:
- generate a Postgres migration script and update DB helpers,
- create the n8n workflow JSON that fetches credentials from `GET /v1/users/:userId/credentials` and then runs the publish flow for Instagram, Facebook, YouTube, X, Pinterest, LinkedIn,
- or produce deployment instructions (systemd + nginx + certbot) for your VPS.

Which would you like next?
