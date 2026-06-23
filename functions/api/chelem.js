// Cloudflare Pages Function — /api/chelem
// Env requis : CHELEM_KV (KV binding), CHELEM_SECRET, ADMIN_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const LEGEND_ORDER = ['NZL87','AUS91','RSA95','AUS99','ENG03','RSA07','NZL11','NZL15','RSA19','RSA'];

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const url = new URL(request.url);

    // GET — liste publique ou admin
    if (request.method === 'GET') {
      const adminKey = url.searchParams.get('admin');
      const entries = await getEntries(env);
      const isAdmin = adminKey && adminKey === env.ADMIN_KEY;
      return Response.json({ entries, admin: isAdmin }, { headers: CORS });
    }

    // POST — inscription
    if (request.method === 'POST') {
      const body = await request.json();
      const { name, avg, slots, legendLog } = body;

      // Validation du Grand Chelem
      if (!legendLog || legendLog.length !== 10)
        return new Response('Pas 10 matchs', { status: 400, headers: CORS });

      for (let i = 0; i < 10; i++) {
        const m = legendLog[i];
        if (m.oppKey !== LEGEND_ORDER[i])
          return new Response('Mauvais adversaire', { status: 400, headers: CORS });
        if (!m.win)
          return new Response('Pas 10 victoires', { status: 400, headers: CORS });
        if (m.myScore <= m.oppScore || m.myScore > 80 || m.oppScore < 5)
          return new Response('Scores incohérents', { status: 400, headers: CORS });
      }

      // Validation nom
      const cleanName = String(name || '').trim().slice(0, 30).replace(/[<>&"']/g, '');
      if (!cleanName) return new Response('Nom invalide', { status: 400, headers: CORS });

      // Validation XV
      if (!slots || slots.length !== 15)
        return new Response('XV incomplet', { status: 400, headers: CORS });

      const avgNum = parseFloat(avg);
      if (isNaN(avgNum) || avgNum < 50 || avgNum > 100)
        return new Response('Moyenne invalide', { status: 400, headers: CORS });

      // Anti-doublon par nom (case-insensitive) sur 24h
      const entries = await getEntries(env);
      const lc = cleanName.toLowerCase();
      const recent = entries.filter(e =>
        e.name.toLowerCase() === lc && Date.now() - e.ts < 86400000
      );
      if (recent.length > 0)
        return new Response('Nom déjà inscrit aujourd\'hui', { status: 429, headers: CORS });

      // Formater le XV
      const xv = slots.map(s => ({
        pos: s.pos,
        name: s.player ? s.player.name : null,
        note: s.player ? s.player.note : null,
        team: s.player ? s.player.teamKey : null,
      }));

      // Formater le log Légendes
      const log = legendLog.map(m => ({
        opp: m.oppKey, my: m.myScore, opp_s: m.oppScore
      }));

      // Insérer l'entrée
      entries.unshift({
        name: cleanName,
        avg: Math.round(avgNum * 10) / 10,
        xv,
        log,
        date: new Date().toISOString().split('T')[0],
        ts: Date.now()
      });
      if (entries.length > 500) entries.splice(500);

      await env.CHELEM_KV.put('entries', JSON.stringify(entries));
      return Response.json({ success: true }, { headers: CORS });
    }

    // DELETE — admin seulement
    if (request.method === 'DELETE') {
      const adminKey = url.searchParams.get('key');
      const idx = parseInt(url.searchParams.get('index'));
      if (!adminKey || adminKey !== env.ADMIN_KEY)
        return new Response('Non autorisé', { status: 401, headers: CORS });

      const entries = await getEntries(env);
      if (idx >= 0 && idx < entries.length) entries.splice(idx, 1);
      await env.CHELEM_KV.put('entries', JSON.stringify(entries));
      return Response.json({ success: true }, { headers: CORS });
    }

    return new Response('Méthode non supportée', { status: 405, headers: CORS });

  } catch(e) {
    console.error(e);
    return new Response('Erreur serveur', { status: 500, headers: CORS });
  }
}

async function getEntries(env) {
  const raw = await env.CHELEM_KV.get('entries');
  return raw ? JSON.parse(raw) : [];
}
