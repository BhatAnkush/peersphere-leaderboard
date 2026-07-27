# 🏆 PeerSphere Leaderboard

A **real-time, animated GitHub commit leaderboard** for teams and contributors. It fetches today's commits across every branch of each team's repo, deduplicates them, and presents a cinematic podium + ranked list — no backend needed.

---

## ✨ Features

| Feature | Details |
|---|---|
| **Group & User leaderboards** | Toggle between team-level and individual-contributor views |
| **Animated podium reveal** | Bronze → Silver → Gold ceremony-style animation |
| **All-branch coverage** | Scans every branch, deduplicates SHAs so no commit is double-counted |
| **Smart caching** | Results are cached in `localStorage` per day — drastically cuts GitHub API calls |
| **Auto-refresh** | Refreshes on a configurable interval (default 60 s) using the cache |
| **Force refresh** | ↻ Refresh button bypasses the cache and hits the live API |
| **Rate-limit resilient** | Works unauthenticated (60 req/hr) thanks to caching; add a PAT for 5 000 req/hr |
| **Zero dependencies** | Pure HTML + CSS + JS — just open the file or serve it statically |

---

## 📁 File Structure

```
peersphere-leaderboard/
├── index.html        # Markup & layout
├── styles.css        # All styling & animations
├── script.js         # Data fetching, caching, rendering logic
├── config.json       # Teams, repos & members — edit this regularly
├── env.js            # ⚠️  Local secrets file — gitignored, never commit
├── env.example.js    # Template for env.js — committed to git
├── build.js          # Vercel build script — writes env.js from env vars
├── vercel.json       # Vercel config — sets the build command
├── .gitignore        # Keeps env.js out of git
├── peersphere.png    # Logo shown in the header
└── README.md         # You are here
```

---

## ⚡ Quick Start

> No build step required. Just serve the files from any static host or open locally.

### 1. Clone / download

```bash
git clone https://github.com/BhatAnkush/peersphere-leaderboard.git
cd peersphere-leaderboard
```

### 2. Set up your local env file

```bash
cp env.example.js env.js
```

Then open `env.js` and optionally paste in a GitHub token (see [Rate Limit](#-beating-the-github-rate-limit)):

```js
window.__ENV__ = {
  GH_TOKEN: 'ghp_your_token_here', // or leave empty for unauthenticated mode
};
```

> `env.js` is gitignored — your token never enters version control.

### 3. Edit `config.json`

```json
{
  "settings": {
    "timezone": "Asia/Kolkata",
    "refreshIntervalSeconds": 60,
    "cacheTTLMinutes": 5
  },
  "teams": [
    {
      "teamName": "Team Alpha",
      "repo": "https://github.com/your-org/your-repo",
      "members": [
        { "name": "Jane Doe", "githubUsername": "janedoe", "email": "jane@example.com" }
      ]
    }
  ]
}
```

### 4. Serve locally

Any static server works:

```bash
# Python 3
python -m http.server 8080

# Node (npx)
npx serve .

# VS Code — use the Live Server extension
```

Then open **http://localhost:8080** in your browser.

---

## 🔑 Beating the GitHub Rate Limit

GitHub allows **60 unauthenticated API requests per hour** per IP. With multiple teams and many branches this can run out quickly.

### Option A — Personal Access Token via `env.js` (recommended)

The token is **never hardcoded in source code**. Instead it lives in a gitignored runtime file:

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Create a token — no extra scopes needed for public repos
3. Paste it into your local `env.js`:

```js
// env.js  (gitignored — safe to put real secrets here)
window.__ENV__ = {
  GH_TOKEN: 'ghp_your_token_here',
};
```

> This raises the limit to **5 000 requests per hour** — more than enough for any team size.

### Option B — Built-in cache (no token required)

The leaderboard caches each day's results in `localStorage` with a configurable TTL.

| Trigger | Behaviour |
|---|---|
| Page load / auto-refresh | Served from cache if fresh — **0 API calls** ✅ |
| Cache older than TTL | Fetches live from GitHub and refreshes cache 🔄 |
| ↻ Refresh button | Always clears cache and pulls live data 🔃 |
| New day | Cache key includes date, so it auto-expires at midnight 🌙 |

Set the TTL in `config.json`:

```json
"settings": { "cacheTTLMinutes": 10 }
```

---

## 🛠 Configuration Reference

### `config.json`

| Field | Type | Description |
|---|---|---|
| `settings.timezone` | string | IANA timezone for "today" calculation (e.g. `"Asia/Kolkata"`) |
| `settings.refreshIntervalSeconds` | number | How often the auto-refresh fires (minimum 20 s) |
| `settings.cacheTTLMinutes` | number | How long cached results are considered fresh (default 5) |
| `teams[].teamName` | string | Display name shown on the leaderboard |
| `teams[].repo` | string | Full GitHub URL of the team's repository |
| `teams[].members[].name` | string | Full display name of the contributor |
| `teams[].members[].githubUsername` | string | GitHub login — primary matching key |
| `teams[].members[].email` | string | Fallback matching key when GitHub login is unavailable |

### `env.js` / `window.__ENV__`

| Key | Description |
|---|---|
| `GH_TOKEN` | GitHub Personal Access Token. Empty = unauthenticated (60 req/hr). Set = 5 000 req/hr. |

### `script.js` constants

| Constant | Default | Description |
|---|---|---|
| `CONFIG_PATH` | `'config.json'` | Path/URL to the config file |
| `REFRESH_INTERVAL_SEC` | `60` | Fallback refresh interval if not set in config |
| `CACHE_TTL_MS` | `5 * 60 * 1000` | Fallback cache TTL (ms) if not set in config |

> `GH_TOKEN` is **no longer a constant in `script.js`** — it is read at runtime from `window.__ENV__.GH_TOKEN` (injected by `env.js`). Never put a real token in `script.js`.

---

## 🧩 Adding More Teams or Members

Just extend the `teams` array in `config.json`:

```json
{
  "teamName": "Team Falcons",
  "repo": "https://github.com/your-org/falcons-repo",
  "members": [
    { "name": "Alice", "githubUsername": "alice-gh", "email": "alice@org.com" },
    { "name": "Bob",   "githubUsername": "bob-gh",   "email": "bob@org.com"   },
    { "name": "Carol", "githubUsername": "carol-gh", "email": "carol@org.com" }
  ]
}
```

There is no limit on the number of teams or members per team.

---

## 🚀 Deployment

### Vercel (recommended)

The project includes a `vercel.json` and `build.js` that handle token injection automatically.

1. Push the repo to GitHub (make sure `env.js` is gitignored ✅)
2. Import the project on [vercel.com](https://vercel.com)
3. Go to **Project → Settings → Environment Variables**
4. Add `GH_TOKEN` = `ghp_your_token_here` (select all environments)
5. Click **Deploy** (or redeploy if already deployed)

At build time Vercel runs `node build.js`, which reads `process.env.GH_TOKEN` and writes `env.js` into the output. The token stays server-side during the build and is baked into the static file — it never touches your git history.

```
Vercel env var (GH_TOKEN)
        │
        ▼
   build.js  (runs at deploy)
        │  writes
        ▼
     env.js  (in the deployed bundle)
        │  sets
        ▼
  window.__ENV__.GH_TOKEN
        │  read by
        ▼
     script.js
```

### GitHub Pages

GitHub Pages has no build step, so `build.js` won't run. Use one of these instead:

- **No token** — rely on the 5-minute cache (60 req/hr shared across users)
- **GitHub Actions** — add a workflow that runs `node build.js` (with `GH_TOKEN` as a repo secret) and pushes the built `env.js` to the `gh-pages` branch

### Netlify

Same as Vercel — set `GH_TOKEN` in **Site settings → Environment variables** and add to `netlify.toml`:

```toml
[build]
  command = "node build.js"
  publish = "."
```

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

