import { useEffect, useState } from 'react';
import ReactFlow, { Background } from 'reactflow';
import 'reactflow/dist/style.css';

export default function Home() {
  const [nodes, setNodes] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/containers');
        const data = await res.json();
        const mapped = data.map((c, i) => ({
          id: c.id,
          position: { x: 0, y: i * 80 },
          data: { label: `${c.name} (${c.status})` }
        }));
        setNodes(mapped);
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, []);

  return (
    <div style={{ height: '100vh' }}>
      <ReactFlow nodes={nodes} edges={[]}>
        <Background />
      </ReactFlow>
    </div>
  );
}
