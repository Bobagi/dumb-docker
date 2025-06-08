import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

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
        const adminHash = process.env.ADMIN_PASSWORD_HASH;
        if (!credentials?.username || !credentials.password) return null;
        if (credentials.username !== adminUsername) return null;
        if (!adminHash) return null;
        const ok = await bcrypt.compare(credentials.password, adminHash);
        if (!ok) return null;
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
