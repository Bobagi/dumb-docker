import { getSession } from "next-auth/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background } from 'reactflow';
import 'reactflow/dist/style.css';

function DockerIcon(props) {
  return <img src="/favicon.svg" alt="Project icon" {...props} />;
}

const HighlightContext = createContext(null);

function ApplicationNode({ data }) {
  return (
    <div className="bg-slate-950/60 border-2 border-slate-700 rounded-lg shadow-sm" style={{ width: data.width, height: data.height }}>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm truncate text-white" title={data.name}>{data.name}</h3>
          <span className="text-[10px] uppercase tracking-wide bg-slate-700 text-white px-2 py-0.5 rounded">{data.containerCount} containers</span>
        </div>
        {data.path && <div className="text-xs text-slate-300 truncate mt-1" title={data.path}>{data.path}</div>}
        {(data.description || data.summary) && (
          <p className="text-xs text-slate-200 mt-2 line-clamp-2">{data.description || data.summary}</p>
        )}
        {(data.gitBranch || data.gitCommit) && (
          <div className="text-[11px] text-slate-300 mt-2">
            {data.gitBranch || 'unknown'} {data.gitCommit ? `• ${data.gitCommit.slice(0, 8)}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function ContainerNode({ data }) {
  const highlightedContainerId = useContext(HighlightContext);
  const color =
    data.status === 'running'
      ? 'bg-green-500'
      : data.status === 'exited'
      ? 'bg-red-500'
      : 'bg-gray-400';
  const highlightClasses = highlightedContainerId === data.containerId ? 'ring-4 ring-yellow-400 animate-pulse' : '';
  return (
    <div className="relative">
      <div className={`bg-white border-2 rounded shadow p-2 w-48 text-sm transition flex flex-col ${highlightClasses}`}>
        <DockerIcon className="w-full h-16 object-contain mb-2" />
        <div className="mb-1">
          <span className="font-semibold truncate text-black" title={data.name}>{data.name}</span>
        </div>
        <div className="text-xs text-gray-600 mb-2 truncate" title={data.image}>{data.image}</div>
        {data.ports?.length > 0 && (
          <div className="text-xs text-gray-600 mb-2">
            <div className="font-semibold text-gray-700 uppercase tracking-wide text-[10px] mb-1">Ports</div>
            <div className="space-y-1">
              {data.ports.map((port) => {
                const key = `${port.host_ip || 'all'}-${port.host_port || 'unknown'}-${port.container_port || 'none'}`;
                const hostLabel = port.host_ip ? `${port.host_ip}:${port.host_port}` : port.host_port;
                const [containerBase, protocol] = (port.container_port || '').split('/');
                const containerLabel = containerBase ? `${containerBase}${protocol ? `/${protocol.toUpperCase()}` : ''}` : null;
                const tooltipDetails = [
                  hostLabel ? `External: ${hostLabel}` : null,
                  containerLabel ? `Internal: ${containerLabel}` : null,
                ]
                  .filter(Boolean)
                  .join(' → ');
                return (
                  <div key={key} className="space-y-0.5" title={tooltipDetails}>
                    <div className="truncate">External: {hostLabel || '—'}</div>
                    {containerLabel && <div className="truncate text-gray-500">Internal: {containerLabel}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-1 justify-end">
          <button onClick={data.onRestart} disabled={data.loadingAction === 'restart'} className="bg-blue-500 disabled:opacity-50 text-white rounded px-2 py-1 text-xs !cursor-pointer disabled:!cursor-not-allowed">
            {data.loadingAction === 'restart' ? (data.status === 'running' ? 'Restarting...' : 'Starting...') : data.status === 'running' ? 'Restart' : 'Start'}
          </button>
          <button onClick={data.onStop} disabled={data.loadingAction === 'stop'} className="bg-red-500 disabled:opacity-50 text-white rounded px-2 py-1 text-xs !cursor-pointer disabled:!cursor-not-allowed">
            {data.loadingAction === 'stop' ? 'Stopping...' : 'Stop'}
          </button>
          <button onClick={data.onShowLogs} className="bg-gray-500 text-white rounded px-2 py-1 text-xs !cursor-pointer">Logs</button>
          <button onClick={data.onDeleteImage} disabled={data.loadingAction === 'deleteImage'} className="bg-purple-600 disabled:opacity-50 text-white rounded px-2 py-1 text-xs !cursor-pointer disabled:!cursor-not-allowed">
            {data.loadingAction === 'deleteImage' ? 'Deleting...' : 'Delete Image'}
          </button>
        </div>
        {data.error && <div className="text-red-500 text-xs mt-1 break-all">{data.error}</div>}
      </div>
      <span className={`absolute top-2 right-2 w-3 h-3 rounded-full ${color}`}></span>
    </div>
  );
}

const BASE_NODE_HEIGHT = 240;
const PORT_LINE_HEIGHT = 18;
const PORT_SECTION_PADDING = 12;
const ROW_VERTICAL_GAP = 60;
const APP_HEADER_HEIGHT = 120;
const NODE_WIDTH = 192;
const HORIZONTAL_GAP = 28;
const GROUP_PADDING = 20;
const APP_MIN_WIDTH = 780;

function estimateNodeHeight(container) {
  const portCount = container?.ports?.length || 0;
  const portsHeight = portCount > 0 ? portCount * PORT_LINE_HEIGHT + PORT_SECTION_PADDING : 0;
  return BASE_NODE_HEIGHT + portsHeight;
}

export default function Home() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [applications, setApplications] = useState([]);
  const [actionState, setActionState] = useState({});
  const [logState, setLogState] = useState({ open: false, id: null, name: '', logs: '', error: null, loading: false });
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [highlightedContainerId, setHighlightedContainerId] = useState(null);
  const highlightTimeoutRef = useRef(null);
  const logsIntervalRef = useRef(null);

  const updateActionState = useCallback((id, newState) => {
    setActionState((prev) => ({ ...prev, [id]: { ...prev[id], ...newState } }));
  }, []);

  const fetchApplications = useCallback(async () => {
    try {
      const res = await fetch('/api/applications');
      const data = await res.json();
      setApplications(data);

      const mapped = [];
      const generatedEdges = [];
      let currentY = 40;

      data.forEach((app) => {
        const appContainers = app.containers || [];
        const containerCount = appContainers.length;
        const calculatedWidth = Math.max(
          APP_MIN_WIDTH,
          GROUP_PADDING * 2 + Math.max(1, containerCount) * NODE_WIDTH + Math.max(0, containerCount - 1) * HORIZONTAL_GAP
        );

        let tallestContainer = BASE_NODE_HEIGHT;
        appContainers.forEach((container) => {
          tallestContainer = Math.max(tallestContainer, estimateNodeHeight(container));
        });

        const appHeight = APP_HEADER_HEIGHT + GROUP_PADDING + tallestContainer + GROUP_PADDING;

        mapped.push({
          id: `app-${app.id}`,
          type: 'application',
          position: { x: 40, y: currentY },
          data: {
            ...app,
            containerCount,
            width: calculatedWidth,
            height: appHeight,
          },
          draggable: false,
          selectable: false,
        });

        let rowMaxHeight = appHeight;
        appContainers.forEach((c, i) => {
          mapped.push({
            id: c.id,
            type: 'container',
            position: {
              x: 40 + GROUP_PADDING + i * (NODE_WIDTH + HORIZONTAL_GAP),
              y: currentY + APP_HEADER_HEIGHT + GROUP_PADDING,
            },
            data: {
              ...c,
              containerId: c.id,
              onRestart: () => handleAction(c.id, 'restart'),
              onStop: () => handleAction(c.id, 'stop'),
              onShowLogs: () => showLogs(c.id, c.name),
              onDeleteImage: () => handleDeleteImage(c.id),
              loadingAction: actionState[c.id]?.loadingAction,
              error: actionState[c.id]?.error,
            },
          });
        });

        for (let i = 0; i < appContainers.length - 1; i++) {
          generatedEdges.push({
            id: `${appContainers[i].id}-${appContainers[i + 1].id}`,
            source: appContainers[i].id,
            target: appContainers[i + 1].id,
            style: { stroke: '#ffd500' },
          });
        }

        currentY += rowMaxHeight + ROW_VERTICAL_GAP;
      });

      setNodes(mapped);
      setEdges(generatedEdges);
    } catch (err) {
      console.error(err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionState]);

  const allContainers = useMemo(() => applications.flatMap((app) => app.containers || []), [applications]);

  const externalPorts = useMemo(() => {
    const items = [];
    allContainers.forEach((container) => {
      (container.ports || []).forEach((port) => {
        if (!port.host_port) return;
        items.push({
          id: `${container.id}-${port.host_ip || 'all'}-${port.host_port}-${port.container_port || 'none'}`,
          containerId: container.id,
          containerName: container.name,
          hostIp: port.host_ip,
          hostPort: port.host_port,
          containerPort: port.container_port,
        });
      });
    });
    return items;
  }, [allContainers]);

  const handleJumpToContainer = useCallback((containerId) => {
    if (!reactFlowInstance || typeof reactFlowInstance.setCenter !== 'function') return;
    const node = nodes.find((n) => n.id === containerId);
    const container = allContainers.find((c) => c.id === containerId);
    if (!node) return;
    const estimatedHeight = container ? estimateNodeHeight(container) : BASE_NODE_HEIGHT;
    reactFlowInstance.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + estimatedHeight / 2, { duration: 800, zoom: 1 });
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setHighlightedContainerId(containerId);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedContainerId(null), 2000);
  }, [allContainers, nodes, reactFlowInstance]);

  const handleAction = useCallback(async (id, action) => {
    updateActionState(id, { loadingAction: action, error: null });
    try {
      const res = await fetch(`/api/containers/${id}/${action}`, { method: 'POST' });
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
      fetchApplications();
    } catch (err) {
      updateActionState(id, { loadingAction: null, error: err.message });
    }
  }, [fetchApplications, updateActionState]);

  const handleDeleteImage = useCallback(async (id) => {
    updateActionState(id, { loadingAction: 'deleteImage', error: null });
    try {
      const res = await fetch(`/api/containers/${id}/delete-image`, { method: 'DELETE' });
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
      fetchApplications();
    } catch (err) {
      updateActionState(id, { loadingAction: null, error: err.message });
    }
  }, [fetchApplications, updateActionState]);

  const fetchLogsForContainer = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/containers/${id}/logs`);
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const data = await res.json();
          msg = data.error || JSON.stringify(data);
        } catch {}
        setLogState((prev) => ({ ...prev, error: msg, loading: false }));
        return;
      }
      const data = await res.json();
      setLogState((prev) => ({ ...prev, logs: data.logs || '', error: null, loading: false }));
    } catch (err) {
      setLogState((prev) => ({ ...prev, error: err.message, loading: false }));
    }
  }, []);

  const showLogs = useCallback(async (id, name) => {
    setLogState({ open: true, id, name, logs: '', error: null, loading: true });
    fetchLogsForContainer(id);
  }, [fetchLogsForContainer]);

  const closeLogs = useCallback(() => {
    if (logsIntervalRef.current) {
      clearInterval(logsIntervalRef.current);
      logsIntervalRef.current = null;
    }
    setLogState({ open: false, id: null, name: '', logs: '', error: null, loading: false });
  }, []);

  useEffect(() => { fetchApplications(); }, [fetchApplications]);

  useEffect(() => {
    if (!logState.open || !logState.id) {
      if (logsIntervalRef.current) {
        clearInterval(logsIntervalRef.current);
        logsIntervalRef.current = null;
      }
      return;
    }
    if (logsIntervalRef.current) clearInterval(logsIntervalRef.current);
    logsIntervalRef.current = setInterval(() => fetchLogsForContainer(logState.id), 3000);
    return () => {
      if (logsIntervalRef.current) {
        clearInterval(logsIntervalRef.current);
        logsIntervalRef.current = null;
      }
    };
  }, [fetchLogsForContainer, logState.id, logState.open]);

  useEffect(() => () => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    if (logsIntervalRef.current) clearInterval(logsIntervalRef.current);
  }, []);

  return (
    <div className="h-screen flex">
      <div className="flex-1">
        <HighlightContext.Provider value={highlightedContainerId}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={{ container: ContainerNode, application: ApplicationNode }}
            proOptions={{}}
            nodesDraggable={false}
            onInit={setReactFlowInstance}
            style={{ width: '100%', height: '100%' }}
          >
            <Background />
          </ReactFlow>
        </HighlightContext.Provider>
      </div>
      <aside className="w-72 border-l border-gray-200 bg-white text-black overflow-y-auto p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">External Ports</h2>
          <p className="text-[11px] text-gray-500 mt-1">Double-click a port or use Focus to center its container</p>
        </div>
        {externalPorts.length === 0 ? <p className="text-xs text-gray-500">No external ports available.</p> : (
          <ul className="space-y-2 text-xs">
            {externalPorts.map((port) => {
              const hostLabel = port.hostIp && port.hostIp !== '::' ? `${port.hostIp}:${port.hostPort}` : port.hostPort;
              return (
                <li key={port.id} className="bg-gray-100 rounded px-2 py-2">
                  <div onDoubleClick={() => handleJumpToContainer(port.containerId)} className="flex items-start gap-2" title={`Container: ${port.containerName}\nInternal: ${port.containerPort || 'unknown'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{hostLabel}</div>
                      <div className="text-gray-600 truncate">{port.containerName}</div>
                      {port.containerPort && <div className="text-gray-500 truncate text-[11px]">Internal: {port.containerPort}</div>}
                    </div>
                    <button type="button" onClick={() => handleJumpToContainer(port.containerId)} className="shrink-0 bg-blue-500 hover:bg-blue-600 text-white rounded px-2 py-1 text-[11px] uppercase">Focus</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      {logState.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white text-black p-4 rounded w-11/12 md:w-2/3 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-semibold text-sm">Logs for {logState.name || logState.id}</h2>
              <button onClick={closeLogs} className="bg-blue-500 text-white rounded px-2 py-1 text-xs !cursor-pointer">Close</button>
            </div>
            {logState.loading ? <p className="text-sm">Loading...</p> : logState.error ? <p className="text-red-500 text-sm break-all">{logState.error}</p> : <pre className="text-xs whitespace-pre-wrap break-all">{logState.logs}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

export async function getServerSideProps(context) {
  const session = await getSession(context);
  if (!session) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: {} };
}
