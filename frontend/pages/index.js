import { useEffect, useState, useCallback } from 'react';
import ReactFlow, { Background } from 'reactflow';
import 'reactflow/dist/style.css';

function ContainerNode({ data }) {
  const color =
    data.status === 'running'
      ? 'bg-green-500'
      : data.status === 'exited'
      ? 'bg-red-500'
      : 'bg-gray-400';
  return (
    <div className="bg-white border rounded shadow p-2 w-48 text-sm">
      <img src="/docker.svg" className="w-full h-16 object-contain mb-2" alt="docker" />
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold truncate" title={data.name}>{data.name}</span>
        <span className={`w-3 h-3 rounded-full ${color}`}></span>
      </div>
      <div className="text-xs text-gray-600 mb-2 truncate" title={data.image}>{data.image}</div>
      <div className="flex gap-1 justify-end">
        <button onClick={data.onRestart} className="bg-blue-500 text-white rounded px-2 py-1 text-xs">Restart</button>
        <button onClick={data.onStop} className="bg-red-500 text-white rounded px-2 py-1 text-xs">Stop</button>
      </div>
    </div>
  );
}

export default function Home() {
  const [nodes, setNodes] = useState([]);

  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch('/api/containers');
      const data = await res.json();
      const mapped = data.map((c, i) => ({
        id: c.id,
        type: 'container',
        position: { x: 0, y: i * 180 },
        data: {
          ...c,
          onRestart: async () => {
            await fetch(`/api/containers/${c.id}/restart`, { method: 'POST' });
            fetchContainers();
          },
          onStop: async () => {
            await fetch(`/api/containers/${c.id}/stop`, { method: 'POST' });
            fetchContainers();
          },
        },
      }));
      setNodes(mapped);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  return (
    <div style={{ height: '100vh' }}>
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={{ container: ContainerNode }}>
        <Background />
      </ReactFlow>
    </div>
  );
}
