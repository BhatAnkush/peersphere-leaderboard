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
├── index.html       # Markup & layout
├── styles.css       # All styling & animations
├── script.js        # Data fetching, caching, rendering logic
├── config.json      # Teams, repos & members — the only file you edit regularly
├── peersphere.png   # Logo shown in the header
└── README.md        # You are here
```

---

## ⚡ Quick Start

> No build step required. Just serve the files from any static host or open locally.

### 1. Clone / download

```bash
git clone https://github.com/BhatAnkush/peersphere-leaderboard.git
cd peersphere-leaderboard
```

### 2. Edit `config.json`

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
        {
          "name": "Jane Doe",
          "githubUsername": "janedoe",
          "email": "jane@example.com"
        }
      ]
    }
  ]
}
```

### 3. Serve locally

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

### Option A — Add a Personal Access Token (recommended)

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Create a token with **read-only access to public repositories** (no extra scopes needed for public repos)
3. Open `script.js` and paste it into the constant at the top:

```js
const GH_TOKEN = 'ghp_your_token_here';
```

> This raises your limit to **5 000 requests per hour** — more than enough for any team size.

### Option B — Rely on the built-in cache (no token required)

The leaderboard caches each day's results in `localStorage` with a **5-minute TTL** (configurable via `cacheTTLMinutes` in `config.json`).

- On page load or auto-refresh → served from cache if fresh ✅
- After 5 minutes → fetches live data from GitHub 🔄
- ↻ Refresh button → **always** fetches live and resets the cache 🔃

This means even without a token you can have the page open all day without ever hitting 60 requests, as long as you don't hammer the manual refresh button.

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

### `script.js` constants

| Constant | Default | Description |
|---|---|---|
| `CONFIG_PATH` | `'config.json'` | Path/URL to the config file |
| `REFRESH_INTERVAL_SEC` | `60` | Fallback refresh interval if not set in config |
| `GH_TOKEN` | `''` | Optional GitHub PAT — leave empty for unauthenticated mode |
| `CACHE_TTL_MS` | `5 * 60 * 1000` | Fallback cache TTL if not set in config |

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

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

