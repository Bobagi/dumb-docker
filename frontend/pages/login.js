import { signIn, getSession } from 'next-auth/react';
import { useState } from 'react';

export async function getServerSideProps(context) {
  const session = await getSession(context);
  if (session) {
    return { redirect: { destination: '/', permanent: false } };
  }
  return { props: {} };
}

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await signIn('credentials', {
      redirect: false,
      username,
      password,
    });
    if (res?.error) {
      setError('Invalid username or password');
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="flex items-center justify-center h-screen">
      <form onSubmit={handleSubmit} className="bg-white p-4 shadow rounded flex flex-col gap-2 w-64">
        <label className="flex flex-col text-sm text-black">
          Username
          <input
            name="username"
            type="text"
            className="border rounded p-1 text-black"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-sm text-black">
          Password
          <input
            name="password"
            type="password"
            className="border rounded p-1 text-black"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button type="submit" className="bg-blue-500 text-white rounded p-1 mt-2">Sign in</button>
      </form>
    </div>
  );
}
