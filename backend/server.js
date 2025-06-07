const express = require('express');
const app = express();
const port = process.env.PORT || 8000;

app.get('/api/containers', (req, res) => {
  res.json([
    { id: '1', name: 'container-a', status: 'running', image: 'node:18' },
    { id: '2', name: 'container-b', status: 'exited', image: 'redis:latest' }
  ]);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on port ${port}`);
});
