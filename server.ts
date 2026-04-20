import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // ISP Proxy to avoid CORS errors
  app.get('/api/isp', async (req, res) => {
    try {
      // Use ip-api.com for better reliability
      const response = await axios.get('http://ip-api.com/json/');
      res.json(response.data);
    } catch (error) {
      console.error('Server ISP Proxy Error:', error);
      res.status(500).json({ status: 'error', message: 'Detection failed' });
    }
  });

  // Performance test endpoint
  app.post('/api/upload-test', (req, res) => {
    // Just consume the data and return success
    res.json({ status: 'ok', size: req.headers['content-length'] });
  });

  // Proxy or other API routes here if needed
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`REHAN_BHAI Server active at http://localhost:${PORT}`);
  });
}

startServer();
