// api/history.js — Vercel Serverless Function
// Fetches all Serie A 2024/25 matches, reconstructs standings per matchday,
// scores Ana & Adil's predictions for each matchday from 10 onwards.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const API_TOKEN = process.env.FOOTBALL_API_TOKEN;
    const SEASON = 2025;
    const LEAGUE = 'SA';
    const FROM_MATCHDAY = 10;

    // ── PREDICTIONS (same order as frontend) ────────────────────────────────────
    const PRED_NAMES = [
        [ // Ana
            'SSC Napoli', 'Juventus FC', 'AS Roma', 'FC Internazionale Milano', 'AC Milan',
            'ACF Fiorentina', 'Bologna FC 1909', 'SS Lazio', 'Atalanta BC', 'Como 1907',
            'Torino FC', 'Udinese Calcio', 'Genoa CFC', 'Cagliari Calcio', 'US Sassuolo Calcio',
            'US Cremonese', 'US Lecce', 'Hellas Verona FC', 'Parma Calcio 1913', 'AC Pisa 1909',
        ],
        [ // Adil
            'Juventus FC', 'SSC Napoli', 'FC Internazionale Milano', 'AC Milan', 'AS Roma',
            'SS Lazio', 'Bologna FC 1909', 'Atalanta BC', 'ACF Fiorentina', 'Como 1907',
            'Torino FC', 'Genoa CFC', 'Udinese Calcio', 'Parma Calcio 1913', 'US Sassuolo Calcio',
            'Cagliari Calcio', 'US Cremonese', 'Hellas Verona FC', 'AC Pisa 1909', 'US Lecce',
        ],
    ];

    // ── SCORING LOGIC ────────────────────────────────────────────────────────────
    function zone(p) {
        if (p <= 4) return 'cl';
        if (p === 5) return 'el';
        if (p === 6) return 'conf';
        if (p >= 18) return 'rel';
        return '';
    }

    function scoreRow(myPos, rPos) {
        if (rPos === undefined) return 0;
        const diff = Math.abs(myPos - rPos);
        const pos_pts = diff === 0 ? 3 : diff === 1 ? 2 : 0;
        const mz = zone(myPos), rz = zone(rPos);
        const zone_pts = (mz && mz === rz) ? 1 : 0;
        return pos_pts + zone_pts;
    }

    function calcScore(pred, standings) {
        // standings: array of team names sorted 1st to last
        const posMap = {};
        standings.forEach((name, i) => { posMap[name] = i + 1; });
        return pred.reduce((tot, name, i) => tot + scoreRow(i + 1, posMap[name]), 0);
    }

    // ── STANDINGS RECONSTRUCTION ─────────────────────────────────────────────────
    // Returns points table after a given matchday
    // teamStats: { [teamName]: { pts, gd, gf } }
    function applyMatch(teamStats, match) {
        if (match.status !== 'FINISHED') return;
        const { homeTeam, awayTeam, score } = match;
        const ft = score?.fullTime ?? score?.regularTime ?? {};
        const hg = ft.home, ag = ft.away;
        if (hg === null || hg === undefined || ag === null || ag === undefined) return;

        const h = homeTeam.name, a = awayTeam.name;
        if (!teamStats[h]) teamStats[h] = { pts: 0, gd: 0, gf: 0 };
        if (!teamStats[a]) teamStats[a] = { pts: 0, gd: 0, gf: 0 };

        teamStats[h].gf += hg; teamStats[h].gd += (hg - ag);
        teamStats[a].gf += ag; teamStats[a].gd += (ag - hg);

        if (hg > ag) { teamStats[h].pts += 3; }
        else if (hg < ag) { teamStats[a].pts += 3; }
        else { teamStats[h].pts += 1; teamStats[a].pts += 1; }
    }

    function buildStandings(teamStats) {
        // Sort: pts desc, gd desc, gf desc, name asc
        return Object.entries(teamStats)
            .sort(([na, a], [nb, b]) => {
                if (b.pts !== a.pts) return b.pts - a.pts;
                if (b.gd !== a.gd) return b.gd - a.gd;
                if (b.gf !== a.gf) return b.gf - a.gf;
                return na.localeCompare(nb);
            })
            .map(([name]) => name);
    }

    try {
        // Fetch all matches for the season
        const url = `https://api.football-data.org/v4/competitions/${LEAGUE}/matches?season=${SEASON}`;
        const response = await fetch(url, {
            headers: { 'X-Auth-Token': API_TOKEN }
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `API error: ${response.status}` });
        }

        const data = await response.json();
        const allMatches = data.matches ?? [];

        // Group matches by matchday
        const byMatchday = {};
        for (const match of allMatches) {
            const md = match.matchday;
            if (!md) continue;
            if (!byMatchday[md]) byMatchday[md] = [];
            byMatchday[md].push(match);
        }

        const matchdays = Object.keys(byMatchday).map(Number).sort((a, b) => a - b);
        const maxMatchday = Math.max(...matchdays);

        // Build cumulative standings matchday by matchday
        const teamStats = {}; // cumulative
        const history = {};   // { [matchday]: [scoreAna, scoreAdil] }

        for (const md of matchdays) {
            // Apply all matches of this matchday
            for (const match of byMatchday[md]) {
                applyMatch(teamStats, match);
            }

            // Only record from FROM_MATCHDAY onwards
            if (md >= FROM_MATCHDAY) {
                const standings = buildStandings(teamStats);
                const scores = PRED_NAMES.map(pred => calcScore(pred, standings));
                history[md] = scores;
            }
        }

        // Cache aggressively for past matchdays — 1 hour
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=300');
        return res.status(200).json({ history, maxMatchday });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}