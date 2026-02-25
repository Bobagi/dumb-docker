import { getSession } from "next-auth/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background } from 'reactflow';
import 'reactflow/dist/style.css';

function DockerIcon(props) {
  return <img src="/favicon.svg" alt="Project icon" {...props} />;
}

const HighlightContext = createContext(null);

function normalizeGitRemoteUrl(remoteUrl) {
  if (!remoteUrl) {
    return null;
  }
  if (remoteUrl.startsWith('git@github.com:')) {
    return `https://github.com/${remoteUrl.replace('git@github.com:', '').replace(/\.git$/, '')}`;
  }
  if (remoteUrl.startsWith('https://github.com/') || remoteUrl.startsWith('http://github.com/')) {
    return remoteUrl.replace(/\.git$/, '');
  }
  return remoteUrl;
}


function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function UsagePie({ label, sharePercent }) {
  const safePercent = Number.isFinite(sharePercent) ? Math.max(0, Math.min(100, sharePercent)) : 0;
  const style = {
    background:
      safePercent <= 0
        ? '#1a1a1a'
        : `conic-gradient(transparent 0% ${safePercent}%, #1a1a1a ${safePercent}% 100%), conic-gradient(#facc15 0%, #f59e0b 35%, #ef4444 55%, #b91c1c 100%)`,
  };
  return (
    <div className="flex flex-col items-center gap-1" title={`${label}: ${safePercent.toFixed(2)}%`}>
      <div className="relative w-12 h-12 rounded-full" style={style}>
        <div className="absolute inset-[6px] rounded-full bg-black flex items-center justify-center text-[10px] text-yellow-100">
          {safePercent.toFixed(0)}%
        </div>
      </div>
      <span className="text-[9px] uppercase tracking-wide text-yellow-200">{label}</span>
    </div>
  );
}

function ApplicationNode({ data }) {
  const githubUrl = normalizeGitRemoteUrl(data.gitRemoteUrl);
  const branchOptions = data.branchOptions || [];

  const handleCollapseMouseDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleCollapseClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    data.onToggleCollapse?.();
  };

  return (
    <div className="bg-black/80 border-2 border-yellow-500 rounded-lg shadow-sm" style={{ width: data.width, height: data.height }}>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 pr-2">
            <h3 className="font-semibold text-sm truncate text-yellow-100" title={data.name}>{data.name}</h3>
            {data.path && <div className="text-xs text-yellow-200/80 truncate mt-1" title={data.path}>{data.path}</div>}
            {githubUrl ? (
              <a href={githubUrl} target="_blank" rel="noreferrer" className="text-[11px] text-yellow-300 hover:text-yellow-200 underline truncate block mt-1" title={githubUrl}>
                {githubUrl}
              </a>
            ) : (
              <div className="text-[11px] text-yellow-200/70 mt-1">Repository remote unavailable</div>
            )}
            {(data.gitBranch || data.gitCommit) && (
              <div className="text-[11px] text-yellow-100/90 mt-2">
                {data.gitBranch || 'unknown'} {data.gitCommit ? `• ${data.gitCommit.slice(0, 8)}` : ''}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <select
                value={data.selectedBranch || ''}
                onChange={(event) => data.onSelectBranch?.(event.target.value)}
                disabled={data.branchLoading || branchOptions.length === 0}
                className="nodrag nopan flex-1 text-[11px] bg-black border border-yellow-400 text-yellow-100 rounded px-2 py-1"
              >
                {branchOptions.length === 0 ? (
                  <option value="">No branches</option>
                ) : (
                  branchOptions.map((branch) => (
                    <option key={branch} value={branch}>{branch}</option>
                  ))
                )}
              </select>
              <button
                type="button"
                onMouseDown={handleCollapseMouseDown}
                onClick={data.onRefreshBranches}
                disabled={data.branchLoading}
                className="nodrag nopan text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 rounded px-2 py-1 text-[11px]"
                title="Refresh branches"
              >
                ⟳
              </button>
              <button
                type="button"
                onMouseDown={handleCollapseMouseDown}
                onClick={data.onPullBranch}
                disabled={data.pullLoading || !data.selectedBranch}
                className="nodrag nopan text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 rounded px-2 py-1 text-[11px]"
              >
                {data.pullLoading ? 'Pulling...' : 'Pull'}
              </button>
              <button
                type="button"
                onMouseDown={handleCollapseMouseDown}
                onClick={data.onComposeStart}
                disabled={data.composeLoading === 'start'}
                className="nodrag nopan text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 rounded px-2 py-1 text-[11px]"
              >
                {data.composeLoading === 'start' ? 'Starting...' : 'Start'}
              </button>
              <button
                type="button"
                onMouseDown={handleCollapseMouseDown}
                onClick={data.onComposeStop}
                disabled={data.composeLoading === 'stop'}
                className="nodrag nopan text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 rounded px-2 py-1 text-[11px]"
              >
                {data.composeLoading === 'stop' ? 'Stopping...' : 'Stop'}
              </button>
            </div>
            {data.gitError && <div className="text-[11px] text-red-400 mt-1 break-all">{data.gitError}</div>}
          </div>
          <div className="flex items-start gap-2">
            <UsagePie label="CPU" sharePercent={data.resourceUsage?.sharePercent || 0} />
            <UsagePie label="MEM" sharePercent={data.resourceUsage?.memorySharePercent || 0} />
            <div className="flex flex-col items-end gap-1">
              <div className="text-[10px] leading-tight text-yellow-100/90 text-right">
                <div>CPU share: {(data.resourceUsage?.sharePercent || 0).toFixed(1)}%</div>
                <div>Mem share: {(data.resourceUsage?.memorySharePercent || 0).toFixed(1)}%</div>
                <div>CPU app: {(data.resourceUsage?.cpuPercent || 0).toFixed(2)}%</div>
                <div>Mem app: {formatBytes(data.resourceUsage?.memoryBytes || 0)}</div>
              </div>
              <span className="text-[10px] uppercase tracking-wide bg-yellow-500 text-black px-2 py-0.5 rounded">{data.containerCount} containers</span>
              <button
                type="button"
                onMouseDown={handleCollapseMouseDown}
                onClick={handleCollapseClick}
                className="nodrag nopan text-black bg-yellow-500 hover:bg-yellow-400 rounded p-1 leading-none"
                aria-label={data.collapsed ? 'Expand section' : 'Collapse section'}
                title={data.collapsed ? 'Expand section' : 'Collapse section'}
              >
                <span className={`inline-block transition-transform ${data.collapsed ? '-rotate-90' : 'rotate-0'}`}>▼</span>
              </button>
            </div>
          </div>
        </div>
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
const ROW_VERTICAL_GAP = 40;
const APP_HEADER_HEIGHT = 170;
const NODE_WIDTH = 192;
const HORIZONTAL_GAP = 28;
const GROUP_PADDING = 20;
const APP_MIN_WIDTH = 620;
const APP_MAX_WIDTH = 1380;
const MAX_CONTAINERS_PER_ROW = 6;

function estimateNodeHeight(container) {
  const portCount = container?.ports?.length || 0;
  const portsHeight = portCount > 0 ? portCount * PORT_LINE_HEIGHT + PORT_SECTION_PADDING : 0;
  return BASE_NODE_HEIGHT + portsHeight;
}

export default function Home() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [applications, setApplications] = useState([]);
  const [collapsedApps, setCollapsedApps] = useState({});
  const [actionState, setActionState] = useState({});
  const [logState, setLogState] = useState({ open: false, id: null, name: '', logs: '', error: null, loading: false });
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [highlightedContainerId, setHighlightedContainerId] = useState(null);
  const [gitUiState, setGitUiState] = useState({});
  const highlightTimeoutRef = useRef(null);
  const logsIntervalRef = useRef(null);

  const updateActionState = useCallback((id, newState) => {
    setActionState((prev) => ({ ...prev, [id]: { ...prev[id], ...newState } }));
  }, []);

  const toggleCollapse = useCallback((appId) => {
    setCollapsedApps((prev) => ({ ...prev, [appId]: !prev[appId] }));
  }, []);

  const refreshBranches = useCallback(async (appId, currentBranch) => {
    if (!appId || appId === 'unassigned') return;
    setGitUiState((prev) => ({
      ...prev,
      [appId]: {
        ...(prev[appId] || {}),
        branchLoading: true,
        gitError: null,
      },
    }));

    try {
      const response = await fetch(`/api/applications/${appId}/branches`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || response.statusText);
      }

      const branches = Array.isArray(data?.branches) ? data.branches : [];
      const activeBranch = data?.currentBranch || currentBranch || branches[0] || '';
      setGitUiState((prev) => {
        const previousSelected = prev[appId]?.selectedBranch;
        const selectedBranch = branches.includes(previousSelected)
          ? previousSelected
          : (branches.includes(activeBranch) ? activeBranch : branches[0] || '');
        return {
          ...prev,
          [appId]: {
            ...(prev[appId] || {}),
            branchOptions: branches,
            selectedBranch,
            branchLoading: false,
            loadedOnce: true,
            gitError: null,
          },
        };
      });
    } catch (err) {
      setGitUiState((prev) => ({
        ...prev,
        [appId]: {
          ...(prev[appId] || {}),
          branchLoading: false,
          loadedOnce: true,
          gitError: err.message,
        },
      }));
    }
  }, []);

  const fetchApplications = useCallback(async () => {
    try {
      const res = await fetch('/api/applications');
      const data = await res.json();
      setApplications(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const pullBranch = useCallback(async (appId, selectedBranch) => {
    if (!selectedBranch) return;

    setGitUiState((prev) => ({
      ...prev,
      [appId]: {
        ...(prev[appId] || {}),
        pullLoading: true,
        gitError: null,
      },
    }));

    try {
      const response = await fetch(`/api/applications/${appId}/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: selectedBranch }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || response.statusText);
      }

      setGitUiState((prev) => ({
        ...prev,
        [appId]: {
          ...(prev[appId] || {}),
          pullLoading: false,
          gitError: null,
        },
      }));
      await fetchApplications();
      await refreshBranches(appId, selectedBranch);
    } catch (err) {
      setGitUiState((prev) => ({
        ...prev,
        [appId]: {
          ...(prev[appId] || {}),
          pullLoading: false,
          gitError: err.message,
        },
      }));
    }
  }, [fetchApplications, refreshBranches]);


  const runComposeAction = useCallback(async (appId, action, selectedBranch) => {
    if (!appId || appId === 'unassigned') return;
    setGitUiState((prev) => ({
      ...prev,
      [appId]: {
        ...(prev[appId] || {}),
        composeLoading: action,
        gitError: null,
      },
    }));

    try {
      const response = await fetch(`/api/applications/${appId}/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || response.statusText);
      }

      setGitUiState((prev) => ({
        ...prev,
        [appId]: {
          ...(prev[appId] || {}),
          composeLoading: null,
          gitError: null,
        },
      }));
      await fetchApplications();
      await refreshBranches(appId, data?.branch || selectedBranch);
    } catch (err) {
      setGitUiState((prev) => ({
        ...prev,
        [appId]: {
          ...(prev[appId] || {}),
          composeLoading: null,
          gitError: err.message,
        },
      }));
    }
  }, [fetchApplications, refreshBranches]);


  const safeApplications = useMemo(() => (Array.isArray(applications) ? applications : []), [applications]);

  const allContainers = useMemo(() => safeApplications.flatMap((app) => app.containers || []), [safeApplications]);

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

  useEffect(() => {
    const mapped = [];
    const generatedEdges = [];
    let currentY = 40;

    safeApplications.forEach((app) => {
      const appContainers = app.containers || [];
      const collapsed = !!collapsedApps[app.id];
      const containerCount = appContainers.length;
      const rowSize = Math.min(MAX_CONTAINERS_PER_ROW, Math.max(containerCount, 1));
      const rowCount = Math.max(1, Math.ceil(containerCount / MAX_CONTAINERS_PER_ROW));

      const idealWidth = GROUP_PADDING * 2 + rowSize * NODE_WIDTH + Math.max(0, rowSize - 1) * HORIZONTAL_GAP;
      const calculatedWidth = Math.max(APP_MIN_WIDTH, Math.min(APP_MAX_WIDTH, idealWidth));

      let appHeight = APP_HEADER_HEIGHT + 12;
      if (!collapsed && containerCount > 0) {
        const rowHeights = Array.from({ length: rowCount }, () => BASE_NODE_HEIGHT);
        appContainers.forEach((container, index) => {
          const rowIndex = Math.floor(index / MAX_CONTAINERS_PER_ROW);
          rowHeights[rowIndex] = Math.max(rowHeights[rowIndex], estimateNodeHeight(container));
        });
        const containersHeight = rowHeights.reduce((acc, value) => acc + value, 0) + Math.max(0, rowCount - 1) * GROUP_PADDING;
        appHeight = APP_HEADER_HEIGHT + GROUP_PADDING + containersHeight + GROUP_PADDING;
      }

      mapped.push({
        id: `app-${app.id}`,
        type: 'application',
        position: { x: 40, y: currentY },
        data: {
          ...app,
          collapsed,
          containerCount,
          width: calculatedWidth,
          height: appHeight,
          branchOptions: gitUiState[app.id]?.branchOptions || [],
          selectedBranch: gitUiState[app.id]?.selectedBranch || app.gitBranch || '',
          branchLoading: gitUiState[app.id]?.branchLoading || false,
          pullLoading: gitUiState[app.id]?.pullLoading || false,
          composeLoading: gitUiState[app.id]?.composeLoading || null,
          gitError: gitUiState[app.id]?.gitError || null,
          onSelectBranch: (branch) => setGitUiState((prev) => ({
            ...prev,
            [app.id]: {
              ...(prev[app.id] || {}),
              selectedBranch: branch,
              gitError: null,
            },
          })),
          onRefreshBranches: () => refreshBranches(app.id, app.gitBranch),
          onPullBranch: () => pullBranch(app.id, gitUiState[app.id]?.selectedBranch || app.gitBranch || ''),
          onComposeStart: () => runComposeAction(app.id, 'start', gitUiState[app.id]?.selectedBranch || app.gitBranch || ''),
          onComposeStop: () => runComposeAction(app.id, 'stop', gitUiState[app.id]?.selectedBranch || app.gitBranch || ''),
          onToggleCollapse: () => toggleCollapse(app.id),
        },
        draggable: false,
        selectable: true,
      });

      if (!collapsed) {
        const rowHeights = [];
        appContainers.forEach((container, index) => {
          const rowIndex = Math.floor(index / MAX_CONTAINERS_PER_ROW);
          rowHeights[rowIndex] = Math.max(rowHeights[rowIndex] || BASE_NODE_HEIGHT, estimateNodeHeight(container));
        });

        appContainers.forEach((c, i) => {
          const rowIndex = Math.floor(i / MAX_CONTAINERS_PER_ROW);
          const colIndex = i % MAX_CONTAINERS_PER_ROW;
          const yOffset = rowHeights
            .slice(0, rowIndex)
            .reduce((acc, value) => acc + value + GROUP_PADDING, 0);
          mapped.push({
            id: c.id,
            type: 'container',
            position: {
              x: 40 + GROUP_PADDING + colIndex * (NODE_WIDTH + HORIZONTAL_GAP),
              y: currentY + APP_HEADER_HEIGHT + GROUP_PADDING + yOffset,
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
      }

      currentY += appHeight + ROW_VERTICAL_GAP;
    });

    setNodes(mapped);
    setEdges(generatedEdges);
  }, [actionState, collapsedApps, gitUiState, handleAction, handleDeleteImage, pullBranch, refreshBranches, runComposeAction, safeApplications, showLogs, toggleCollapse]);


  useEffect(() => { fetchApplications(); }, [fetchApplications]);

  useEffect(() => {
    safeApplications.forEach((app) => {
      if (app.id === 'unassigned' || !app.path) return;
      if (gitUiState[app.id]?.loadedOnce || gitUiState[app.id]?.branchLoading) return;
      refreshBranches(app.id, app.gitBranch);
    });
  }, [gitUiState, refreshBranches, safeApplications]);

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
