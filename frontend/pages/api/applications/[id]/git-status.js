import fs from 'fs';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id } = req.query;
  const port = process.env.BACKEND_PORT || '8000';
  const devUrl = `http://localhost:${port}`;
  const inDocker = fs.existsSync('/.dockerenv');
  const backendUrl =
    process.env.BACKEND_URL ||
    (!inDocker && process.env.NODE_ENV === 'development' ? devUrl : 'http://backend:8000');

  try {
    const response = await fetch(`${backendUrl}/api/applications/${id}/git-status`);
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Failed to fetch git status' });
  }
}
