export default async function handler(req, res) {
  const { id, action } = req.query;
  const backendUrl = process.env.BACKEND_URL || 'http://backend:8000';
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
