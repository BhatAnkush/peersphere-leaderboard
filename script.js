const state = {
  view: 'team',
  config: null,
  teamStats: [],
  userStats: [],
  timer: null,
  search: '',
  sort: 'commits',
  loading: true,
  refreshing: false,
};

const $ = sel => document.querySelector(sel);
const SEARCH_DEBOUNCE_MS = 180;

const CONFIG_PATH = 'config.json';
const REFRESH_INTERVAL_SEC = 60;
const CACHE_TTL_MS = 5 * 60 * 1000;
const GH_TOKEN = (window.__ENV__ && window.__ENV__.GH_TOKEN) || '';

const ZAP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
const FLAG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';
const GH_ICON = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

function medalSvg(){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 12.5 17 22l-5-3-5 3 1.5-9.5"/><circle cx="12" cy="8" r="2" fill="currentColor"/></svg>';
}

const CACHE_SCHEMA = 'v2';
function cacheKey(){
  const d = new Date();
  return `ps_lb_cache_${CACHE_SCHEMA}_${d.getFullYear()}_${d.getMonth()}_${d.getDate()}`;
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

function backfillFromConfig(){
  if (!state.config || !Array.isArray(state.config.teams)) return;
  const repoByTeam = new Map(state.config.teams.map(t => [t.teamName, t.repo]));
  state.userStats.forEach(u => {
    if (!u.teamRepo && u.team && repoByTeam.has(u.team)){
      u.teamRepo = repoByTeam.get(u.team);
    }
  });
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
        userMap.set(key, { name:m.name, username:m.githubUsername, email:m.email, team:team.teamName, teamRepo:team.repo, commits:0, avatar:`https://github.com/${m.githubUsername}.png?size=80` });
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

/* ---------- filter + sort ---------- */
function itemMatchesQuery(item, type, query){
  if (!query) return true;
  const q = query.toLowerCase();
  if (type === 'team'){
    if (item.teamName.toLowerCase().includes(q)) return true;
    return item.members.some(m =>
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.githubUsername && m.githubUsername.toLowerCase().includes(q))
    );
  }
  return (item.name && item.name.toLowerCase().includes(q)) ||
    (item.username && item.username.toLowerCase().includes(q)) ||
    (item.team && item.team.toLowerCase().includes(q));
}

function getVisibleItems(){
  const base = state.view === 'team' ? state.teamStats : state.userStats;
  let items = base.filter(it => itemMatchesQuery(it, state.view, state.search.trim()));
  if (state.sort === 'alpha'){
    items = [...items].sort((a,b) => {
      const an = (state.view === 'team' ? a.teamName : a.name) || '';
      const bn = (state.view === 'team' ? b.teamName : b.name) || '';
      return an.localeCompare(bn);
    });
  }
  return items;
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
    const nameHref = type === 'team' ? item.repo : `https://github.com/${item.username}`;
    const sub = type === 'team' ? `${item.members.length} members` : `<a href="https://github.com/${item.username}" target="_blank" rel="noopener" class="gh-link">${GH_ICON}<span>@${item.username}</span></a>`;
    const avatar = type === 'team'
      ? initialAvatarSvg(item.teamName.charAt(0).toUpperCase(), rank===1?'#e8b84b':rank===2?'#8a94a6':'#c97a4a')
      : item.avatar;

    slot.innerHTML = `
      <div class="podium-card">
        <div class="medal">${medalSvg()}</div>
        <img class="podium-avatar" src="${avatar}" onerror="this.src='${initialAvatarSvg((label||'?').charAt(0).toUpperCase(),'#1f7a49')}'" alt="${label}">
        <div class="podium-name"><a href="${nameHref}" target="_blank" rel="noopener" class="name-link">${label}</a></div>
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

function renderList(items, type, opts){
  const { rest, startRank, max, isFiltered, hasAnyData } = opts;
  const body = $('#listBody');
  body.innerHTML = '';
  $('#colLabel').textContent = type === 'team' ? 'Team' : 'Contributor';

  if (!hasAnyData){
    body.innerHTML = `<div class="empty-state"><span class="g">${ZAP_SVG}</span><p>No commits found for today yet. Check back soon.</p></div>`;
    return;
  }
  if (isFiltered && !items.length){
    body.innerHTML = `<div class="empty-state"><span class="g">${ZAP_SVG}</span><p>No match for &ldquo;${escapeHtml(state.search.trim())}&rdquo;. Try a different name or team.</p></div>`;
    return;
  }
  if (!rest.length){
    body.innerHTML = `<div class="empty-state"><span class="g">${FLAG_SVG}</span><p>Only the podium today &mdash; everyone else is still warming up.</p></div>`;
    return;
  }

  rest.forEach((item, i)=>{
    const rank = startRank + i;
    const row = document.createElement('div');
    row.className = 'row';
    row.style.animationDelay = (i*50)+'ms';
    const label = type === 'team' ? item.teamName : item.name;
    const nameHref = type === 'team' ? item.repo : `https://github.com/${item.username}`;
    const meta = type === 'team' ? `${item.members.length} members` : `<a href="https://github.com/${item.username}" target="_blank" rel="noopener" class="gh-link">${GH_ICON}<span>@${item.username}</span></a>`;
    const avatar = type === 'team'
      ? initialAvatarSvg(item.teamName.charAt(0).toUpperCase(), '#1a6b42')
      : item.avatar;
    const teamCell = type === 'user'
      ? (item.teamRepo
          ? `<div class="team-cell"><a href="${item.teamRepo}" target="_blank" rel="noopener" class="team-link" title="Open ${item.team} repo">${item.team}</a></div>`
          : `<div class="team-cell"><span class="team-link team-link-plain">${item.team || '\u2014'}</span></div>`)
      : '';
    row.innerHTML = `
      <div class="rank">#${rank}</div>
      <div class="who">
        <img src="${avatar}" onerror="this.src='${initialAvatarSvg((label||'?').charAt(0).toUpperCase(),'#1a6b42')}'" alt="${label}">
        <div>
          <div class="name"><a href="${nameHref}" target="_blank" rel="noopener" class="name-link">${label}</a></div>
          <div class="meta">${meta}</div>
        </div>
      </div>
      ${teamCell}
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

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function render(){
  const type = state.view;
  const baseItems = type === 'team' ? state.teamStats : state.userStats;
  const isFiltered = !!state.search.trim();
  const showPodium = !isFiltered && state.sort === 'commits';
  const items = getVisibleItems();

  document.querySelector('.board-panel').classList.toggle('mode-user', type === 'user');

  if (showPodium){
    // items is the full roster sorted by commits desc. Only nonzero entries
    // earn a podium spot; everyone else (including 0-commit teams/people)
    // still shows up in the list below so the full roster stays visible.
    const podiumItems = items.slice(0, 3).filter(it => it.commits > 0);
    renderPodium(podiumItems, type);
    const rest = items.slice(podiumItems.length);
    const max = items.length ? (items[0].commits || 1) : 1;
    renderList(items, type, {
      rest,
      startRank: podiumItems.length + 1,
      max,
      isFiltered: false,
      hasAnyData: items.length > 0,
    });
  } else {
    $('#podium').style.display = 'none';
    $('#podium').innerHTML = '';
    const max = items.length ? (items[0].commits || 1) : 1;
    renderList(items, type, {
      rest: items,
      startRank: 1,
      max,
      isFiltered,
      hasAnyData: isFiltered ? baseItems.length > 0 : items.length > 0,
    });
  }

  updateResultsCount(items.length, baseItems.length, isFiltered);
}

function updateResultsCount(shown, total, isFiltered){
  const el = $('#resultsCount');
  if (!el) return;
  if (!isFiltered){
    el.textContent = '';
    return;
  }
  el.textContent = `${shown} of ${total} match`;
}

function setSyncing(isSyncing){
  state.refreshing = isSyncing;
  const btn = $('#refreshBtn');
  const dot = $('#pulseDot');
  btn.classList.toggle('is-spinning', isSyncing);
  btn.disabled = isSyncing;
  if (dot) dot.classList.toggle('is-error', false);
}

function setLoadingSkeleton(isLoading){
  state.loading = isLoading;
  document.body.classList.toggle('is-loading', isLoading);
}

async function refreshAll(manual = false){
  $('#lastUpdated').textContent = 'syncing\u2026';
  setSyncing(true);

  if (!manual){
    const cached = readCache();
    if (cached){
      state.teamStats = cached.teamStats;
      state.userStats = cached.userStats;
      backfillFromConfig();
      setLoadingSkeleton(false);
      render();
      updateStatsBar();
      $('#lastUpdated').textContent = 'from cache \u00b7 ' + new Date().toLocaleTimeString();
      setSyncing(false);
      return;
    }
  } else {
    clearCache();
  }

  try{
    await buildStats();
    setLoadingSkeleton(false);
    render();
    updateStatsBar();
    $('#lastUpdated').textContent = 'updated ' + new Date().toLocaleTimeString();
  }catch(e){
    setLoadingSkeleton(false);
    $('#lastUpdated').textContent = 'sync failed';
    const dot = $('#pulseDot');
    if (dot) dot.classList.add('is-error');
    toast('Sync failed: ' + e.message + ' \u2014 tap Refresh to retry', true);
  }finally{
    setSyncing(false);
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
    document.querySelectorAll('.tab-btn').forEach(b=>{
      b.classList.remove('active');
      b.setAttribute('aria-selected','false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected','true');
    state.view = btn.dataset.view;
    const search = $('#searchInput');
    search.placeholder = state.view === 'team'
      ? 'Search teams or contributors\u2026'
      : 'Search contributors or teams\u2026';
    render();
  });
});

$('#refreshBtn').addEventListener('click', () => refreshAll(true));

let searchDebounce;
const searchInput = $('#searchInput');
const searchClear = $('#searchClear');
searchInput.addEventListener('input', ()=>{
  clearTimeout(searchDebounce);
  const val = searchInput.value;
  searchClear.hidden = !val;
  searchDebounce = setTimeout(()=>{
    state.search = val;
    if (!state.loading) render();
  }, SEARCH_DEBOUNCE_MS);
});
searchClear.addEventListener('click', ()=>{
  searchInput.value = '';
  searchClear.hidden = true;
  state.search = '';
  searchInput.focus();
  if (!state.loading) render();
});

$('#sortSelect').addEventListener('change', (e)=>{
  state.sort = e.target.value;
  if (!state.loading) render();
});

setLoadingSkeleton(true);
loadConfigAndStart();