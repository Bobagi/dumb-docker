import fs from 'fs';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

async function fetchWithRetry(url, options = {}, retries = 12, delayMs = 500) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      const code = error?.cause?.code || error?.code;
      if (code !== 'ECONNREFUSED' && code !== 'EAI_AGAIN' && code !== 'ENOTFOUND') {
        throw error;
      }
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError || new Error('Failed to connect to backend');
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const port = process.env.BACKEND_PORT || '8000';
  const devUrl = `http://localhost:${port}`;
  const inDocker = fs.existsSync('/.dockerenv');
  const backendUrl =
    process.env.BACKEND_URL ||
    (!inDocker && process.env.NODE_ENV === 'development' ? devUrl : 'http://backend:8000');

  try {
    const response = await fetchWithRetry(`${backendUrl}/api/applications`);
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
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
}
