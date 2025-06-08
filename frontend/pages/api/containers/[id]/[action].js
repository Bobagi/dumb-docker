export default async function handler(req, res) {
  const { id, action } = req.query;
  const port = process.env.BACKEND_PORT || '8000';
  const devUrl = `http://localhost:${port}`;
  const backendUrl =
    process.env.BACKEND_URL ||
    (process.env.NODE_ENV === 'development' ? devUrl : 'http://backend:8000');
  const url = `${backendUrl}/api/containers/${id}/${action}`;
  try {
    const response = await fetch(url, { method: req.method });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Failed to proxy request' });
  }
}
