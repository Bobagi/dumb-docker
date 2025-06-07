import { useEffect, useState } from 'react';

export default function Home() {
  const [containers, setContainers] = useState([]);

  useEffect(() => {
    fetch('/api/containers')
      .then((res) => res.json())
      .then(setContainers)
      .catch((err) => console.error('Failed to fetch containers', err));
  }, []);

  return (
    <div>
      <h1>Containers</h1>
      <pre>{JSON.stringify(containers, null, 2)}</pre>
    </div>
  );
}
