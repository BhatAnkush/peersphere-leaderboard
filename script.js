const state = {
  view: 'team',
  config: null,
  teamStats: [],
  userStats: [],
  timer: null,
};

const $ = sel => document.querySelector(sel);

const CONFIG_PATH = 'config.json';
const REFRESH_INTERVAL_SEC = 60;
const CACHE_TTL_MS = 5 * 60 * 1000;
const GH_TOKEN = (window.__ENV__ && window.__ENV__.GH_TOKEN) || '';

/* ---------- cache helpers ---------- */
function cacheKey(){
  const d = new Date();
  return `ps_lb_cache_${d.getFullYear()}_${d.getMonth()}_${d.getDate()}`;
}
function readCache(){
  try{
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const { ts, teamStats, userStats } = JSON.parse(raw);
    const ttl = (state.config && state.config.settings && state.config.settings.cacheTTLMinutes)
      ? state.config.settings.cacheTTLMinutes * 60 * 1000
      : CACHE_TTL_MS;
    if (Date.now() - ts > ttl) return null;
    return { teamStats, userStats };
  }catch(e){ return null; }
}
function writeCache(teamStats, userStats){
  try{
    localStorage.setItem(cacheKey(), JSON.stringify({ ts: Date.now(), teamStats, userStats }));
  }catch(e){}
}
function clearCache(){
  localStorage.removeItem(cacheKey());
}

function toast(msg, isErr){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(t._to);
  t._to = setTimeout(()=>t.classList.remove('show'), 3200);
}

function ownerRepoFromUrl(url){
  try{
    const u = new URL(url);
    const parts = u.pathname.replace(/^\/|\/$/g,'').split('/');
    return { owner: parts[0], repo: parts[1].replace(/\.git$/,'') };
  }catch(e){ return null; }
}

function startOfTodayISO(){
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0);
  return start.toISOString();
}

async function ghFetch(url, token){
  const headers = { 'Accept':'application/vnd.github+json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(url, { headers });
  if (!res.ok){
    if (res.status === 403) throw new Error('RATE_LIMIT');
    if (res.status === 404) throw new Error('NOT_FOUND');
    throw new Error('HTTP_' + res.status);
  }
  return res.json();
}

async function fetchAllBranches(owner, repo, token){
  let page = 1, all = [];
  while(true){
    const data = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100&page=${page}`, token);
    all = all.concat(data);
    if (data.length < 100) break;
    page++;
    if (page > 10) break;
  }
  return all;
}

async function fetchCommitsSince(owner, repo, sha, sinceISO, token){
  let page = 1, all = [];
  while(true){
    let url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(sha)}&since=${sinceISO}&per_page=100&page=${page}`;
    let data;
    try{
      data = await ghFetch(url, token);
    }catch(e){
      if (e.message === 'NOT_FOUND') return all;
      throw e;
    }
    all = all.concat(data);
    if (data.length < 100) break;
    page++;
    if (page > 10) break;
  }
  return all;
}

function matchMember(commit, members){
  const login = commit.author && commit.author.login ? commit.author.login.toLowerCase() : null;
  const email = commit.commit && commit.commit.author && commit.commit.author.email ? commit.commit.author.email.toLowerCase() : null;
  const name = commit.commit && commit.commit.author && commit.commit.author.name ? commit.commit.author.name.toLowerCase() : null;
  for (const m of members){
    if (login && m.githubUsername && m.githubUsername.toLowerCase() === login) return m;
  }
  for (const m of members){
    if (email && m.email && m.email.toLowerCase() === email) return m;
  }
  for (const m of members){
    if (name && m.name && m.name.toLowerCase() === name) return m;
  }
  return null;
}

async function buildStats(){
  const token = GH_TOKEN;
  const since = startOfTodayISO();
  const teamStats = [];
  const userMap = new Map();

  for (const team of state.config.teams){
    const or = ownerRepoFromUrl(team.repo);
    if (!or) continue;
    const seenShas = new Set();
    let teamCommitCount = 0;

    for (const m of team.members){
      const key = m.githubUsername.toLowerCase();
      if (!userMap.has(key)){
        userMap.set(key, { name:m.name, username:m.githubUsername, email:m.email, team:team.teamName, commits:0, avatar:`https://github.com/${m.githubUsername}.png?size=80` });
      }
    }

    try{
      const branches = await fetchAllBranches(or.owner, or.repo, token);
      for (const b of branches){
        const commits = await fetchCommitsSince(or.owner, or.repo, b.name, since, token);
        for (const c of commits){
          if (seenShas.has(c.sha)) continue;
          seenShas.add(c.sha);
          teamCommitCount++;
          const member = matchMember(c, team.members);
          if (member){
            const key = member.githubUsername.toLowerCase();
            const u = userMap.get(key);
            if (u) u.commits++;
          }
        }
      }
    }catch(e){
      toast(`${team.teamName}: ${e.message === 'RATE_LIMIT' ? 'GitHub rate limit — add GH_TOKEN' : 'error fetching ' + or.repo}`, true);
    }

    teamStats.push({
      teamName: team.teamName,
      repo: team.repo,
      commits: teamCommitCount,
      members: team.members,
    });
  }

  teamStats.sort((a,b)=>b.commits-a.commits);
  const userStats = Array.from(userMap.values()).sort((a,b)=>b.commits-a.commits);

  state.teamStats = teamStats;
  state.userStats = userStats;

  writeCache(teamStats, userStats);
}

/* ---------- animated counter ---------- */
function animateValue(el, start, end, duration){
  if (start === end){ el.textContent = end.toLocaleString(); return; }
  const startTime = performance.now();
  function tick(now){
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (end - start) * eased);
    el.textContent = current.toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function updateStatsBar(){
  const totalCommits = state.teamStats.reduce((s,t)=>s+t.commits, 0);
  const activeTeams = state.teamStats.filter(t=>t.commits > 0).length;
  const activeUsers = state.userStats.filter(u=>u.commits > 0).length;
  const topTeam = state.teamStats.length ? state.teamStats[0] : null;

  const prev = {
    commits: parseInt($('#statCommits').dataset.val || '0'),
    teams: parseInt($('#statTeams').dataset.val || '0'),
    users: parseInt($('#statContributors').dataset.val || '0'),
  };

  $('#statCommits').dataset.val = totalCommits;
  $('#statTeams').dataset.val = activeTeams;
  $('#statContributors').dataset.val = activeUsers;

  animateValue($('#statCommits'), prev.commits, totalCommits, 600);
  animateValue($('#statTeams'), prev.teams, activeTeams, 500);
  animateValue($('#statContributors'), prev.users, activeUsers, 500);

  $('#statTopTeam').textContent = topTeam && topTeam.commits > 0 ? topTeam.teamName : '\u2014';
}

/* ---------- render ---------- */
function initialAvatarSvg(letter, bg){
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="${bg}"/><text x="50%" y="55%" font-family="monospace" font-size="32" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`;
}

function renderPodium(items, type){
  const podium = $('#podium');
  podium.innerHTML = '';
  if (!items.length){
    podium.style.display = 'none';
    return;
  }
  podium.style.display = 'flex';
  const top3 = items.slice(0,3);
  const heights = [200,150,110];

  top3.forEach((item, idx)=>{
    const rank = idx+1;
    const slot = document.createElement('div');
    slot.className = `podium-slot rank-${rank}`;
    const label = type === 'team' ? item.teamName : item.name;
    const sub = type === 'team' ? `${item.members.length} members` : '@'+item.username;
    const avatar = type === 'team'
      ? initialAvatarSvg(item.teamName.charAt(0).toUpperCase(), rank===1?'#e8b84b':rank===2?'#8a94a6':'#c97a4a')
      : item.avatar;

    slot.innerHTML = `
      <div class="podium-card">
        <div class="medal">${rank===1?'&#129351;':rank===2?'&#129352;':'&#129353;'}</div>
        <img class="podium-avatar" src="${avatar}" onerror="this.src='${initialAvatarSvg((label||'?').charAt(0).toUpperCase(),'#1f7a49')}'" alt="${label}">
        <div class="podium-name">${label}</div>
        <div class="podium-sub">${sub}</div>
        <div class="podium-score">${item.commits}<span>commits</span></div>
      </div>
      <div class="podium-base"><span class="num">#${rank}</span></div>
    `;
    podium.appendChild(slot);
  });

  const order = [3,2,1];
  order.forEach((rank, i)=>{
    const el = podium.querySelector(`.rank-${rank}`);
    if (!el) return;
    setTimeout(()=>{
      el.classList.add('reveal');
      const base = el.querySelector('.podium-base');
      const h = heights[rank-1];
      requestAnimationFrame(()=> base.style.height = h + 'px');
    }, i*400);
  });
}

function renderList(items, type){
  const body = $('#listBody');
  body.innerHTML = '';
  $('#colLabel').textContent = type === 'team' ? 'Team' : 'Contributor';

  const rest = items.slice(3);
  if (!items.length){
    body.innerHTML = `<div class="empty-state"><span class="g">&#9889;</span><p>No commits found for today yet. Check back soon.</p></div>`;
    return;
  }
  if (!rest.length){
    body.innerHTML = `<div class="empty-state"><span class="g">&#127937;</span><p>Only the podium today &mdash; everyone else is still warming up.</p></div>`;
    return;
  }
  const max = items[0].commits || 1;

  rest.forEach((item, i)=>{
    const rank = i+4;
    const row = document.createElement('div');
    row.className = 'row';
    row.style.animationDelay = (i*50)+'ms';
    const label = type === 'team' ? item.teamName : item.name;
    const meta = type === 'team' ? `${item.members.length} members` : '@'+item.username;
    const avatar = type === 'team'
      ? initialAvatarSvg(item.teamName.charAt(0).toUpperCase(), '#1a6b42')
      : item.avatar;
    row.innerHTML = `
      <div class="rank">#${rank}</div>
      <div class="who">
        <img src="${avatar}" onerror="this.src='${initialAvatarSvg((label||'?').charAt(0).toUpperCase(),'#1a6b42')}'" alt="${label}">
        <div>
          <div class="name">${label}</div>
          <div class="meta">${meta}</div>
        </div>
      </div>
      <div class="bar-wrap"><div class="bar-fill" data-w="${(item.commits/max*100).toFixed(1)}"></div></div>
      <div class="commits">${item.commits}<span> cmts</span></div>
    `;
    body.appendChild(row);
  });

  requestAnimationFrame(()=>{
    body.querySelectorAll('.bar-fill').forEach(b=>{
      setTimeout(()=> b.style.width = b.dataset.w + '%', 200);
    });
  });
}

function render(){
  const items = state.view === 'team' ? state.teamStats : state.userStats;
  renderPodium(items, state.view);
  renderList(items, state.view);
}

async function refreshAll(manual = false){
  $('#lastUpdated').textContent = 'syncing\u2026';

  if (!manual){
    const cached = readCache();
    if (cached){
      state.teamStats = cached.teamStats;
      state.userStats = cached.userStats;
      render();
      updateStatsBar();
      $('#lastUpdated').textContent = 'from cache \u00b7 ' + new Date().toLocaleTimeString();
      return;
    }
  } else {
    clearCache();
  }

  try{
    await buildStats();
    render();
    updateStatsBar();
    $('#lastUpdated').textContent = 'updated ' + new Date().toLocaleTimeString();
  }catch(e){
    $('#lastUpdated').textContent = 'sync failed';
    toast('Sync failed: ' + e.message, true);
  }
}

function scheduleAutoRefresh(){
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(()=>refreshAll(), Math.max(REFRESH_INTERVAL_SEC, 20) * 1000);
}

async function loadConfigAndStart(){
  try{
    const res = await fetch(CONFIG_PATH, { cache: 'no-store' });
    state.config = await res.json();
  }catch(e){
    toast('Could not load config.json', true);
    return;
  }
  const today = new Date();
  $('#todayChip').textContent = today.toLocaleDateString(undefined,{ weekday:'short', year:'numeric', month:'short', day:'numeric' });
  await refreshAll();
  scheduleAutoRefresh();
}

/* ---------- events ---------- */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.view = btn.dataset.view;
    render();
  });
});

$('#refreshBtn').addEventListener('click', () => refreshAll(true));

loadConfigAndStart();
