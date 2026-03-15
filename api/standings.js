export default async function handler(req, res) {
  // Allow CORS from same origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_TOKEN = process.env.FOOTBALL_API_TOKEN;
  const API_URL = 'https://api.football-data.org/v4/competitions/SA/standings';

  try {
    const response = await fetch(API_URL, {
      headers: { 'X-Auth-Token': API_TOKEN }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `API error: ${response.status}` });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
