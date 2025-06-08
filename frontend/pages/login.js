import { getCsrfToken } from 'next-auth/react';

export async function getServerSideProps(context) {
  const csrfToken = await getCsrfToken(context);
  const { error } = context.query;
  return { props: { csrfToken, error: error ?? null } };
}

export default function Login({ csrfToken, error }) {
  const errorMessage = error ? 'Invalid username or password' : null;
  return (
    <div className="flex items-center justify-center h-screen">
      <form method="post" action="/api/auth/callback/credentials" className="bg-white p-4 shadow rounded flex flex-col gap-2 w-64">
        <input name="csrfToken" type="hidden" defaultValue={csrfToken} />
        <label className="flex flex-col text-sm text-black">
          Username
          <input name="username" type="text" className="border rounded p-1 text-black" />
        </label>
        <label className="flex flex-col text-sm text-black">
          Password
          <input name="password" type="password" className="border rounded p-1 text-black" />
        </label>
        {errorMessage && <p className="text-red-500 text-sm">{errorMessage}</p>}
        <button type="submit" className="bg-blue-500 text-white rounded p-1 mt-2">Sign in</button>
      </form>
    </div>
  );
}
