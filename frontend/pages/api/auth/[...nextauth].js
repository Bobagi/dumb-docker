import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import crypto from 'crypto';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text', placeholder: 'admin' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const adminUsername = process.env.ADMIN_USERNAME;
        const adminHash = process.env.ADMIN_PASSWORD_SHA256;
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!credentials?.username || !credentials.password) return null;
        if (!adminUsername || !safeEqual(credentials.username, adminUsername)) return null;
        if (adminHash) {
          const inputHash = crypto
            .createHash('sha256')
            .update(credentials.password)
            .digest('hex');
          if (!safeEqual(inputHash, adminHash)) return null;
        } else if (adminPassword) {
          if (!safeEqual(credentials.password, adminPassword)) return null;
        } else {
          // No admin credential configured — refuse rather than allow blank login.
          return null;
        }
        return { id: 'admin', name: adminUsername };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
    error: '/login',
  },
};

export default NextAuth(authOptions);
