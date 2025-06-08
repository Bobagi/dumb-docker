import { useEffect, useState, useCallback } from 'react';
import ReactFlow, { Background } from 'reactflow';
import 'reactflow/dist/style.css';

function DockerIcon(props) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <title>Docker</title>
      <path
        d="
          M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186
          0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954
          -5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185
          0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186
          0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186
          0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186
          0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186
          0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185
          0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185
          0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185
          0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51
          -.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748
          11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"
      />
    </svg>
  );
}


function ContainerNode({ data }) {
  const color =
    data.status === 'running'
      ? 'bg-green-500'
      : data.status === 'exited'
      ? 'bg-red-500'
      : 'bg-gray-400';
  return (
    <div className="bg-white border rounded shadow p-2 w-48 text-sm">
      <DockerIcon className="w-full h-16 object-contain mb-2" />
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
