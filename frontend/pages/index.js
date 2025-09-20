import { getSession } from "next-auth/react";
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
    <div className="relative">
      <div className="bg-white border-2 rounded shadow p-2 w-48 text-sm">
        <DockerIcon className="w-full h-16 object-contain mb-2" />
        <div className="mb-1">
          <span className="font-semibold truncate text-black" title={data.name}>{data.name}</span>
        </div>
        <div className="text-xs text-gray-600 mb-2 truncate" title={data.image}>{data.image}</div>
        {data.ports?.length > 0 && (
          <div className="text-xs text-gray-600 mb-2 space-y-0.5">
            {data.ports.map((port) => {
              const key = `${port.host_ip || 'all'}-${port.host_port || 'unknown'}-${port.container_port || 'none'}`;
              const hostLabel = port.host_ip ? `${port.host_ip}:${port.host_port}` : port.host_port;
              const containerLabel = port.container_port ? `Container: ${port.container_port}` : null;
              const descriptionParts = [];
              if (hostLabel) descriptionParts.push(`Host: ${hostLabel}`);
              if (containerLabel) descriptionParts.push(containerLabel);
              const description = descriptionParts.join(' → ');
              return (
                <div key={key} className="truncate" title={description}>
                  Host: {hostLabel || '—'}
                  {port.container_port ? ` → Container: ${port.container_port}` : ''}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex gap-1 justify-end">
          <button
            onClick={data.onRestart}
            disabled={data.loadingAction === 'restart'}
            className="bg-blue-500 disabled:opacity-50 text-white rounded px-2 py-1 text-xs !cursor-pointer disabled:!cursor-not-allowed"
          >
            {data.loadingAction === 'restart'
              ? data.status === 'running'
                ? 'Restarting...'
                : 'Starting...'
              : data.status === 'running'
              ? 'Restart'
              : 'Start'}
          </button>
          <button
            onClick={data.onStop}
            disabled={data.loadingAction === 'stop'}
            className="bg-red-500 disabled:opacity-50 text-white rounded px-2 py-1 text-xs !cursor-pointer disabled:!cursor-not-allowed"
          >
            {data.loadingAction === 'stop' ? 'Stopping...' : 'Stop'}
          </button>
          <button
            onClick={data.onShowLogs}
            className="bg-gray-500 text-white rounded px-2 py-1 text-xs !cursor-pointer"
          >
            Logs
          </button>
        </div>
        {data.error && (
          <div className="text-red-500 text-xs mt-1 break-all">{data.error}</div>
        )}
      </div>
      <span className={`absolute top-2 right-2 w-3 h-3 rounded-full ${color}`}></span>
    </div>
  );
}

const BASE_NODE_HEIGHT = 240;
const PORT_LINE_HEIGHT = 18;
const PORT_SECTION_PADDING = 12;
const ROW_VERTICAL_GAP = 20;

function estimateNodeHeight(container) {
  const portCount = container?.ports?.length || 0;
  const portsHeight = portCount > 0 ? portCount * PORT_LINE_HEIGHT + PORT_SECTION_PADDING : 0;
  return BASE_NODE_HEIGHT + portsHeight;
}

export default function Home() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [actionState, setActionState] = useState({});
  const [logState, setLogState] = useState({ open: false, id: null, name: '', logs: '', error: null, loading: false });

  const updateActionState = useCallback((id, newState) => {
    setActionState((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...newState },
    }));
  }, []);

  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch('/api/containers');
      const data = await res.json();

      const groups = {};
      data.forEach((c) => {
        const key = c.project || 'default';
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
      });

      const mapped = [];
      let currentY = 40;
      Object.values(groups).forEach((containers) => {
        let maxHeight = BASE_NODE_HEIGHT;
        containers.forEach((c, i) => {
          const estimatedHeight = estimateNodeHeight(c);
          if (estimatedHeight > maxHeight) {
            maxHeight = estimatedHeight;
          }
          mapped.push({
            id: c.id,
            type: 'container',
            position: { x: 40 + i * 220, y: currentY },
            data: {
              ...c,
              onRestart: () => handleAction(c.id, 'restart'),
              onStop: () => handleAction(c.id, 'stop'),
              onShowLogs: () => showLogs(c.id, c.name),
              loadingAction: actionState[c.id]?.loadingAction,
              error: actionState[c.id]?.error,
            },
          });
        });
        currentY += maxHeight + ROW_VERTICAL_GAP;
      });

      const generatedEdges = [];
      Object.values(groups).forEach((containers) => {
        for (let i = 0; i < containers.length - 1; i++) {
          generatedEdges.push({
            id: `${containers[i].id}-${containers[i + 1].id}`,
            source: containers[i].id,
            target: containers[i + 1].id,
            style: { stroke: '#ffd500' },
          });
        }
      });

      setNodes(mapped);
      setEdges(generatedEdges);
    } catch (err) {
      console.error(err);
    }
  // handleAction and showLogs are defined below and remain stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionState]);

  const handleAction = useCallback(
    async (id, action) => {
      updateActionState(id, { loadingAction: action, error: null });
      try {
        const res = await fetch(`/api/containers/${id}/${action}`, {
          method: 'POST',
        });
        if (!res.ok) {
          let msg = res.statusText;
          try {
            const data = await res.json();
            msg = data.error || JSON.stringify(data);
          } catch {}
          updateActionState(id, { loadingAction: null, error: msg });
          return;
        }
        updateActionState(id, { loadingAction: null, error: null });
        fetchContainers();
      } catch (err) {
        updateActionState(id, { loadingAction: null, error: err.message });
      }
    },
    [fetchContainers, updateActionState]
  );

  const showLogs = useCallback(
    async (id, name) => {
      setLogState({ open: true, id, name, logs: '', error: null, loading: true });
      try {
        const res = await fetch(`/api/containers/${id}/logs`);
        if (!res.ok) {
          let msg = res.statusText;
          try {
            const data = await res.json();
            msg = data.error || JSON.stringify(data);
          } catch {}
          setLogState({ open: true, id, name, logs: '', error: msg, loading: false });
          return;
        }
        const data = await res.json();
        setLogState({ open: true, id, name, logs: data.logs || '', error: null, loading: false });
      } catch (err) {
        setLogState({ open: true, id, name, logs: '', error: err.message, loading: false });
      }
    },
    []
  );

  const closeLogs = () => setLogState({ open: false, id: null, name: '', logs: '', error: null, loading: false });

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  return (
    <div className="h-screen">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ container: ContainerNode }}
        proOptions={{}}
        nodesDraggable={false}
      >
        <Background />
      </ReactFlow>
      {logState.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white text-black p-4 rounded w-11/12 md:w-2/3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-semibold text-sm">Logs for {logState.name || logState.id}</h2>
              <button onClick={closeLogs} className="bg-blue-500 text-white rounded px-2 py-1 text-xs !cursor-pointer">Close</button>
            </div>
            {logState.loading ? (
              <p className="text-sm">Loading...</p>
            ) : logState.error ? (
              <p className="text-red-500 text-sm break-all">{logState.error}</p>
            ) : (
              <pre className="text-xs whitespace-pre-wrap break-all">{logState.logs}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export async function getServerSideProps(context) {
  const session = await getSession(context);
  if (!session) {
    return {
      redirect: { destination: '/login', permanent: false },
    };
  }
  return { props: {} };
}
