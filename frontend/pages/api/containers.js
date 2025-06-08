export default async function handler(req, res) {
  const port = process.env.BACKEND_PORT || '8000';
  const devUrl = `http://localhost:${port}`;
  const backendUrl =
    process.env.BACKEND_URL ||
    (process.env.NODE_ENV === 'development' ? devUrl : 'http://backend:8000');
  try {
    const response = await fetch(`${backendUrl}/api/containers`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });
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
    res.status(500).json({ error: 'Failed to fetch containers' });
  }
}
