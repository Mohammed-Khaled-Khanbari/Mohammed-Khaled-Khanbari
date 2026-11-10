// Generates the profile's stat cards as SVG files in ./assets.
//
//   GITHUB_TOKEN=... node scripts/generate-cards.mjs            (live data)
//   FIXTURE=fixture.json node scripts/generate-cards.mjs        (offline preview)
//
// No dependencies. Runs daily from .github/workflows/profile-cards.yml.

import { readFile, writeFile, mkdir } from "node:fs/promises";

const LOGIN = process.env.PROFILE_LOGIN || "Mohammed-Khaled-Khanbari";
const OUT = new URL("../assets/", import.meta.url);

// Palette taken from the avatar.
const C = {
  bg1: "#211613",
  bg2: "#140E0C",
  orange: "#EB5E34",
  tan: "#D9A56B",
  cream: "#FBEFE3",
  muted: "#B9A79A",
  line: "rgba(251,239,227,0.10)",
  ramp: ["#EB5E34", "#F2895F", "#D9A56B", "#B9774A", "#8E5B3E", "#6A4636"],
  heat: ["#2B1E1A", "#5A2A1C", "#8F3A22", "#C24B2A", "#EB5E34"],
};
const SANS = "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

// ---------- data ----------

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-cards",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

async function fetchLive() {
  const { user } = await gql(
    `query($login: String!) {
      user(login: $login) {
        name createdAt
        followers { totalCount }
        pullRequests { totalCount }
        issues { totalCount }
        repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE]) { totalCount }
        # Private repos are only visible with a PROFILE_TOKEN; the built-in token sees public ones.
        repositories(ownerAffiliations: [OWNER, ORGANIZATION_MEMBER], isFork: false, first: 100) {
          totalCount
          nodes {
            nameWithOwner owner { login }
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name } }
            }
          }
        }
      }
    }`,
    { login: LOGIN }
  );

  // Contribution calendar, one year at a time, back to account creation.
  const days = [];
  let activeDaysThisYear = 0;
  let contributionsThisYear = 0;
  const now = new Date();
  const start = new Date(user.createdAt);
  for (let y = now.getUTCFullYear(); y >= start.getUTCFullYear(); y--) {
    const from = new Date(Date.UTC(y, 0, 1)).toISOString();
    const to = y === now.getUTCFullYear() ? now.toISOString() : new Date(Date.UTC(y, 11, 31, 23, 59, 59)).toISOString();
    const d = await gql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions restrictedContributionsCount
            contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
          }
        }
      }`,
      { login: LOGIN, from, to }
    );
    const cc = d.user.contributionsCollection;
    if (y === now.getUTCFullYear()) {
      activeDaysThisYear = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays).filter((x) => x.contributionCount > 0).length;
      contributionsThisYear = cc.contributionCalendar.totalContributions;
    }
    for (const w of cc.contributionCalendar.weeks)
      for (const day of w.contributionDays) days.push({ date: day.date, count: day.contributionCount });
  }

  const langs = new Map();
  let stars = 0, ownCount = 0, orgCount = 0;
  for (const r of user.repositories.nodes) {
    // Skip this profile repo: its only code is the card generator.
    if (r.nameWithOwner.toLowerCase() === `${LOGIN}/${LOGIN}`.toLowerCase()) continue;
    if (r.owner.login.toLowerCase() === LOGIN.toLowerCase()) { stars += r.stargazerCount; ownCount++; } else orgCount++;
    for (const e of r.languages.edges) langs.set(e.node.name, (langs.get(e.node.name) || 0) + e.size);
  }

  // Counts only, no names: this log is public on a public repo.
  console.log(`Repos counted: ${ownCount} personal, ${orgCount} organization`);

  return {
    year: now.getUTCFullYear(),
    followers: user.followers.totalCount,
    publicRepos: user.repositories.totalCount,
    stars,
    prs: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    contributedTo: user.repositoriesContributedTo.totalCount,
    activeDaysThisYear,
    contributionsThisYear,
    days,
    languages: [...langs].map(([name, size]) => ({ name, size })),
  };
}

// ---------- helpers ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : n.toLocaleString("en-US"));

function streaks(days) {
  const byDate = new Map();
  for (const d of days) byDate.set(d.date, (byDate.get(d.date) || 0) + d.count);
  const dates = [...byDate.keys()].sort();
  let longest = 0, run = 0;
  for (const d of dates) {
    run = byDate.get(d) > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Current streak: today doesn't break it until the day is over.
  let i = dates.length - 1;
  if (i >= 0 && byDate.get(dates[i]) === 0) i--;
  let current = 0;
  while (i >= 0 && byDate.get(dates[i]) > 0) { current++; i--; }
  return { current, longest };
}

function frame(w, h, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
  <title>${esc(label)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg2}"/></linearGradient>
    <style>
      .sans { font-family: ${SANS}; } .mono { font-family: ${MONO}; }
      .fade { animation: fade .7s ease-out backwards; }
      @keyframes fade { from { opacity: 0 } }
      .grow { transform-box: fill-box; transform-origin: left; animation: grow .9s cubic-bezier(.2,.7,.2,1) backwards; }
      @keyframes grow { from { transform: scaleX(0) } }
      @media (prefers-reduced-motion: reduce) { .fade, .grow { animation: none } }
    </style>
  </defs>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="16" fill="url(#bg)" stroke="${C.line}"/>
${body}
</svg>
`;
}

const title = (x, y, text) =>
  `  <rect x="${x}" y="${y - 9}" width="8" height="8" rx="2" fill="${C.orange}"/>
  <text x="${x + 18}" y="${y}" class="mono" font-size="12" letter-spacing="2.4" fill="${C.tan}">${esc(text.toUpperCase())}</text>`;

// ---------- cards ----------

function overviewCard(d) {
  const W = 520, H = 220;
  const { current, longest } = streaks(d.days);
  const tiles = [
    [fmt(d.contributionsThisYear), `Contributions in ${d.year}`],
    [fmt(d.activeDaysThisYear), `Active days in ${d.year}`],
    [fmt(d.prs), "Pull requests"],
    [fmt(d.stars), "Stars earned"],
  ];
  let body = title(28, 40, "Activity");
  tiles.forEach(([n, label], i) => {
    const x = 28 + (i % 2) * 150, y = 92 + Math.floor(i / 2) * 76;
    body += `
  <g class="fade" style="animation-delay:${0.1 + i * 0.08}s">
    <text x="${x}" y="${y}" class="sans" font-size="30" font-weight="700" fill="${C.cream}">${n}</text>
    <text x="${x}" y="${y + 22}" class="sans" font-size="13" fill="${C.muted}">${esc(label)}</text>
  </g>`;
  });
  // Streak ring: the arc shows current streak as a share of the best one.
  const cx = 420, cy = 104, r = 54, circ = 2 * Math.PI * r;
  const share = longest ? current / longest : 0;
  body += `
  <line x1="332" y1="32" x2="332" y2="188" stroke="${C.line}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.cream}" stroke-opacity="0.08" stroke-width="8"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.orange}" stroke-width="8" stroke-linecap="round"
    stroke-dasharray="${(circ * share).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
  <text x="${cx}" y="${cy + 6}" text-anchor="middle" class="sans" font-size="34" font-weight="800" fill="${C.cream}">${current}</text>
  <text x="${cx}" y="${cy + 26}" text-anchor="middle" class="sans" font-size="11" fill="${C.muted}">day streak</text>
  <text x="${cx}" y="190" text-anchor="middle" class="sans" font-size="13" fill="${C.muted}">Best: <tspan fill="${C.tan}" font-weight="600">${longest} days</tspan></text>`;
  return frame(W, H, body, `GitHub activity: ${d.contributionsThisYear} contributions in ${d.year}, ${current}-day streak`);
}

function languagesCard(d) {
  const W = 520, H = 220;
  const sorted = [...d.languages].sort((a, b) => b.size - a.size);
  const total = sorted.reduce((s, l) => s + l.size, 0) || 1;
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((s, l) => s + l.size, 0);
  if (rest > 0) top.push({ name: "Other", size: rest });

  let body = title(28, 40, "Languages");
  const barX = 28, barW = W - 56, barY = 62;
  body += `\n  <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="12" rx="6"/></clipPath>\n  <g clip-path="url(#bar)" class="grow">`;
  let x = barX;
  top.forEach((l, i) => {
    const w = (l.size / total) * barW;
    body += `<rect x="${x.toFixed(2)}" y="${barY}" width="${(w + 0.5).toFixed(2)}" height="12" fill="${C.ramp[i]}"/>`;
    x += w;
  });
  body += `</g>`;
  top.forEach((l, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 28 + col * 240, ly = 112 + row * 36;
    const pct = ((l.size / total) * 100).toFixed(1);
    body += `
  <g class="fade" style="animation-delay:${0.2 + i * 0.06}s">
    <circle cx="${lx + 6}" cy="${ly - 5}" r="6" fill="${C.ramp[i]}"/>
    <text x="${lx + 22}" y="${ly}" class="sans" font-size="15" fill="${C.cream}">${esc(l.name)}</text>
    <text x="${lx + 220}" y="${ly}" text-anchor="end" class="mono" font-size="13" fill="${C.muted}">${pct}%</text>
  </g>`;
  });
  if (!sorted.length)
    body += `\n  <text x="28" y="130" class="sans" font-size="14" fill="${C.muted}">No repositories visible yet.</text>\n  <text x="28" y="154" class="sans" font-size="12" fill="${C.muted}">Add a PROFILE_TOKEN secret to include private work.</text>`;
  return frame(W, H, body, `Most used languages: ${top.map((l) => l.name).join(", ")}`);
}

function heatmapCard(d) {
  // Same width as the two half cards side by side (520 + 16 + 520).
  const W = 1056, weeks = 53, gap = 4;
  const step = (W - 56 + gap) / weeks, cell = +(step - gap).toFixed(2);
  const H = Math.round(64 + 7 * step + 24);
  // Last 53 weeks, aligned so the final column ends today.
  const byDate = new Map(d.days.map((x) => [x.date, x.count]));
  const today = new Date(d.days.length ? d.days.map((x) => x.date).sort().at(-1) + "T00:00:00Z" : Date.now());
  const end = new Date(today);
  const startDay = new Date(end);
  startDay.setUTCDate(end.getUTCDate() - (weeks - 1) * 7 - end.getUTCDay());
  const counts = [];
  for (let t = new Date(startDay); t <= end; t.setUTCDate(t.getUTCDate() + 1)) counts.push(byDate.get(t.toISOString().slice(0, 10)) || 0);
  const nonzero = counts.filter((c) => c > 0).sort((a, b) => a - b);
  const q = (p) => nonzero[Math.floor(p * (nonzero.length - 1))] || 1;
  const levels = [q(0.25), q(0.5), q(0.75)];
  const level = (c) => (c === 0 ? 0 : c <= levels[0] ? 1 : c <= levels[1] ? 2 : c <= levels[2] ? 3 : 4);
  const total = counts.reduce((a, b) => a + b, 0);

  let body = title(28, 40, "Last 12 months");
  body += `\n  <text x="${W - 28}" y="40" text-anchor="end" class="sans" font-size="13" fill="${C.muted}"><tspan fill="${C.cream}" font-weight="600">${fmt(total)}</tspan> contributions</text>\n  <g class="fade">`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let lastMonth = -1;
  counts.forEach((c, i) => {
    const wk = Math.floor(i / 7), dow = i % 7;
    const x = 28 + wk * step, y = 64 + dow * step;
    body += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3.5" fill="${C.heat[level(c)]}"/>`;
    if (dow === 0) {
      const dt = new Date(startDay); dt.setUTCDate(startDay.getUTCDate() + i);
      const m = dt.getUTCMonth();
      if (m !== lastMonth && wk < weeks - 2) {
        body += `<text x="${x}" y="${64 + 7 * step + 14}" class="sans" font-size="11" fill="${C.muted}">${months[m]}</text>`;
        lastMonth = m;
      }
    }
  });
  body += `</g>`;
  return frame(W, H, body, `${total} contributions in the last 12 months`);
}

// ---------- main ----------

const data = process.env.FIXTURE ? JSON.parse(await readFile(process.env.FIXTURE, "utf8")) : await fetchLive();
await mkdir(OUT, { recursive: true });
await writeFile(new URL("overview.svg", OUT), overviewCard(data));
await writeFile(new URL("languages.svg", OUT), languagesCard(data));
await writeFile(new URL("activity.svg", OUT), heatmapCard(data));
console.log("Cards written to assets/");
