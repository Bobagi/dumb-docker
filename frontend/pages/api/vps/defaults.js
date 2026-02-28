import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const defaults = {
    host: process.env.VPS_HOST || process.env.NEXT_PUBLIC_VPS_HOST || '',
    port: process.env.VPS_PORT || process.env.NEXT_PUBLIC_VPS_PORT || 22,
    username: process.env.VPS_USERNAME || process.env.NEXT_PUBLIC_VPS_USERNAME || '',
    password: process.env.VPS_PASSWORD || process.env.NEXT_PUBLIC_VPS_PASSWORD || '',
    privateKey: process.env.VPS_PRIVATE_KEY || process.env.NEXT_PUBLIC_VPS_PRIVATE_KEY || '',
    path: process.env.VPS_PATH || process.env.NEXT_PUBLIC_VPS_PATH || '/etc/nginx/sites-available',
    defaultCommand: process.env.VPS_DEFAULT_COMMAND || process.env.NEXT_PUBLIC_VPS_DEFAULT_COMMAND || 'nginx -t',
  };

  return res.status(200).json(defaults);
}
