import { getSession, signOut } from "next-auth/react";
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

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Files with these extensions are treated as binary: opening them streams a
// download instead of corrupting the text editor with decoded bytes.
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'pdf',
  'zip', 'gz', 'tar', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war',
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'wav', 'flac', 'ogg',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'exe', 'bin', 'dll', 'so',
  'o', 'class', 'wasm', 'db', 'sqlite', 'sqlite3', 'pyc', 'deb', 'rpm',
  'img', 'iso', 'keystore', 'jks', 'p12', 'pfx', 'der',
]);

function isBinaryFilename(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return name.includes('.') && BINARY_EXTENSIONS.has(ext);
}

function uint8ToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Heuristic: a NUL (0) or replacement char (0xFFFD, from a failed utf-8 decode)
// in the first chunk means the file is binary and shouldn't be edited as text.
function looksBinaryText(text) {
  const limit = Math.min(text.length, 100000);
  for (let i = 0; i < limit; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0 || code === 0xfffd) return true;
  }
  return false;
}

function StatBar({ label, value, percent }) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const barColor = safePercent >= 90 ? 'bg-red-500' : safePercent >= 70 ? 'bg-yellow-500' : 'bg-blue-500';
  return (
    <div>
      <div className="flex justify-between text-[11px] text-gray-600">
        <span className="font-semibold text-gray-700">{label}</span>
        <span>{value}</span>
      </div>
      <div className="mt-1 h-2 w-full rounded bg-gray-200 overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${safePercent}%` }} />
      </div>
    </div>
  );
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

            {Array.isArray(data.domains) && data.domains.length > 0 && (() => {
              const dockerDomains = data.domains.filter((entry) => entry?.domainType === 'docker');
              if (dockerDomains.length === 0) return null;

              return (
                <fieldset className="mt-2 rounded border border-yellow-400/40 px-2 py-1">
                  <legend className="px-1 text-[10px] text-yellow-300 uppercase tracking-wide">Sites via Docker</legend>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {dockerDomains.map((entry) => {
                      const href = entry?.url || (entry?.domain ? `https://${entry.domain}` : null);
                      const label = entry?.domain || entry?.url;
                      if (!href || !label) return null;
                      const sourcePath = entry?.source || 'source not identified';
                      const reasons = Array.isArray(entry?.matchReasons) && entry.matchReasons.length > 0
                        ? `Match: ${entry.matchReasons.join(', ')}`
                        : null;
                      const source = entry?.source ? `Source: ${entry.source}` : null;
                      const details = [
                        `Open ${label}`,
                        reasons,
                        source,
                      ].filter(Boolean).join('\n');
                      return (
                        <span key={`${data.id}-${label}`} className="relative inline-flex group">
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded border border-yellow-300/70 px-2 py-0.5 text-[10px] text-yellow-100 hover:bg-yellow-400/20"
                            title={details}
                          >
                            🌐 {label}
                          </a>
                          <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden min-w-[260px] max-w-[420px] rounded border border-yellow-500/70 bg-black px-2 py-1 text-[10px] leading-snug text-yellow-100 shadow-lg group-hover:block">
                            <span className="block text-yellow-300">Source file</span>
                            <span className="block break-all">{sourcePath}</span>
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })()}
            {(data.gitBranch || data.gitCommit) && (
              <div className="text-[11px] text-yellow-100/90 mt-2 truncate" title={`${data.gitBranch || 'unknown'} ${data.gitCommit ? `• ${data.gitCommit.slice(0, 8)}` : ''}`}>
                {data.gitBranch || 'unknown'} {data.gitCommit ? `• ${data.gitCommit.slice(0, 8)}` : ''}
              </div>
            )}
            <fieldset className="mt-2 rounded border border-yellow-400/40 px-2 py-1 text-[10px] text-yellow-100/90">
              <legend className="px-1 text-[10px] text-yellow-300 uppercase tracking-wide">Git/Deploy status (VPS)</legend>
              <div className="truncate" title={`Active branch on VPS: ${data.currentBranch || data.gitBranch || 'unknown'}`}>Active branch on VPS: <span className="text-yellow-200">{data.currentBranch || data.gitBranch || 'unknown'}</span></div>
              <div className="truncate" title={`Selected branch: ${data.selectedBranch || 'none'}`}>Selected branch: <span className="text-yellow-200">{data.selectedBranch || 'none'}</span></div>
              <div className="truncate" title={data.operationStatus || 'Waiting for action.'}>{data.operationStatus || 'Waiting for action.'}</div>
            </fieldset>
            <div className="mt-2 flex items-center gap-2">
              <select
                value={data.selectedBranch || ''}
                onChange={(event) => data.onSelectBranch?.(event.target.value)}
                disabled={data.operationInProgress || branchOptions.length === 0}
                className="nodrag nopan min-w-0 flex-1 text-[11px] bg-black border border-yellow-400 text-yellow-100 rounded px-2 py-1"
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
                disabled={data.operationInProgress}
                className="nodrag nopan shrink-0 whitespace-nowrap text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 rounded px-2 py-1 text-[11px]"
                title="Refreshes remote branch list and confirms which branch is currently active on the VPS project."
              >
                ⟳
              </button>
              <button
                type="button"
                onMouseDown={handleCollapseMouseDown}
                onClick={data.onPullBranch}
                disabled={data.operationInProgress || !data.selectedBranch}
                className="nodrag nopan shrink-0 whitespace-nowrap text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 rounded px-2 py-1 text-[11px]"
                title="Checks out the selected branch on the VPS and runs git pull on it. The status above confirms success and the active branch."
              >
                {data.pullLoading ? 'Pulling...' : 'Pull'}
              </button>
              <button
                type="button"
                onMouseDown={handleCollapseMouseDown}
                onClick={data.onComposeStart}
                disabled={data.operationInProgress}
                className="nodrag nopan shrink-0 whitespace-nowrap text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 rounded px-2 py-1 text-[11px]"
                title="Runs docker compose up --build -d for this project. If containers are already running, it reapplies/recreates services as needed to reflect changes."
              >
                {data.composeLoading === 'start' ? 'Deploying...' : 'Deploy (up --build -d)'}
              </button>
              <button
                type="button"
                onMouseDown={handleCollapseMouseDown}
                onClick={data.onComposeStop}
                disabled={data.operationInProgress}
                className="nodrag nopan shrink-0 whitespace-nowrap text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 rounded px-2 py-1 text-[11px]"
                title="Runs docker compose stop for this project to stop containers without removing resources."
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
const APP_HEADER_HEIGHT = 250;
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

function normalizeApplicationsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.applications)) {
    return payload.applications;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  return null;
}

async function readJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export default function Home({ vpsDefaults = {} }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [applications, setApplications] = useState([]);
  const [applicationsError, setApplicationsError] = useState(null);
  const [collapsedApps, setCollapsedApps] = useState({});
  const [actionState, setActionState] = useState({});
  const [logState, setLogState] = useState({ open: false, id: null, name: '', logs: '', error: null, loading: false });
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [highlightedContainerId, setHighlightedContainerId] = useState(null);
  const [gitUiState, setGitUiState] = useState({});
  const [sidebarTab, setSidebarTab] = useState('ports');
  const [vpsConnection, setVpsConnection] = useState({
    host: vpsDefaults.host || process.env.NEXT_PUBLIC_VPS_HOST || '',
    port: vpsDefaults.port || process.env.NEXT_PUBLIC_VPS_PORT || 22,
    username: vpsDefaults.username || process.env.NEXT_PUBLIC_VPS_USERNAME || '',
    password: vpsDefaults.password || process.env.NEXT_PUBLIC_VPS_PASSWORD || '',
    privateKey: vpsDefaults.privateKey || process.env.NEXT_PUBLIC_VPS_PRIVATE_KEY || '',
    privateKeyPassphrase: '',
  });
  const [vpsPath, setVpsPath] = useState(vpsDefaults.path || process.env.NEXT_PUBLIC_VPS_PATH || '/etc/nginx/sites-available');
  const [vpsEntries, setVpsEntries] = useState([]);
  const [vpsSelectedFile, setVpsSelectedFile] = useState('');
  const [vpsFileContent, setVpsFileContent] = useState('');
  const [vpsCommand, setVpsCommand] = useState(vpsDefaults.defaultCommand || process.env.NEXT_PUBLIC_VPS_DEFAULT_COMMAND || 'nginx -t');
  const [vpsTerminalOpen, setVpsTerminalOpen] = useState(false);
  const [vpsTerminalCommand, setVpsTerminalCommand] = useState('');
  const [vpsTerminalOutput, setVpsTerminalOutput] = useState('');
  const [vpsTerminalCwd, setVpsTerminalCwd] = useState('~');
  const [vpsStatus, setVpsStatus] = useState({ loading: false, error: null, success: null });
  const [vpsConnState, setVpsConnState] = useState({ status: 'unknown', user: null, info: null });
  const [vpsFileBinary, setVpsFileBinary] = useState(false);
  const [systemOverview, setSystemOverview] = useState(null);
  const [systemStatus, setSystemStatus] = useState({ loading: false, error: null });
  const highlightTimeoutRef = useRef(null);
  const logsIntervalRef = useRef(null);
  const vpsUploadInputRef = useRef(null);
  const vpsTerminalHistoryRef = useRef([]);
  const vpsTerminalHistoryIndexRef = useRef(-1);

  const sendVpsRequest = useCallback(async (action, payload) => {
    const response = await fetch(`/api/vps/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: vpsConnection.host,
        port: Number(vpsConnection.port) || 22,
        username: vpsConnection.username,
        password: vpsConnection.password || null,
        private_key: vpsConnection.privateKey || null,
        private_key_passphrase: vpsConnection.privateKeyPassphrase || null,
        ...payload,
      }),
    });
    const data = await readJsonSafe(response);
    if (!response.ok) {
      throw new Error(data?.detail || data?.error || response.statusText);
    }
    return data;
  }, [vpsConnection]);

  const loadVpsPath = useCallback(async (nextPath = vpsPath) => {
    setVpsStatus({ loading: true, error: null, success: null });
    try {
      const data = await sendVpsRequest('list-files', { path: nextPath });
      setVpsPath(data.path || nextPath);
      setVpsEntries(Array.isArray(data.entries) ? data.entries : []);
      setVpsStatus({ loading: false, error: null, success: 'Directory loaded successfully.' });
    } catch (err) {
      setVpsStatus({ loading: false, error: err.message, success: null });
    }
  }, [sendVpsRequest, vpsPath]);

  const downloadVpsFile = useCallback(async (path) => {
    if (!path) return;
    setVpsStatus({ loading: true, error: null, success: null });
    try {
      const data = await sendVpsRequest('download-file', { path });
      const bytes = base64ToUint8(data.content_base64);
      const url = URL.createObjectURL(new Blob([bytes]));
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename || path.split('/').pop() || 'download';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setVpsStatus({ loading: false, error: null, success: `Downloaded ${link.download} (${formatBytes(data.size)}).` });
    } catch (err) {
      setVpsStatus({ loading: false, error: err.message, success: null });
    }
  }, [sendVpsRequest]);

  const uploadVpsFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setVpsStatus({ loading: true, error: null, success: null });
    try {
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const contentBase64 = uint8ToBase64(new Uint8Array(buffer));
        await sendVpsRequest('upload-file', { path: vpsPath, filename: file.name, content_base64: contentBase64 });
      }
      setVpsStatus({ loading: false, error: null, success: `Uploaded ${files.length} file(s) to ${vpsPath}.` });
      await loadVpsPath(vpsPath);
    } catch (err) {
      setVpsStatus({ loading: false, error: err.message, success: null });
    }
  }, [loadVpsPath, sendVpsRequest, vpsPath]);

  const renameRemotePath = useCallback(async (path, isDirectory) => {
    if (!path) return;
    const base = path.split('/').pop();
    const parent = path.split('/').slice(0, -1).join('/');
    const nextName = window.prompt(`Rename ${isDirectory ? 'folder' : 'file'} "${base}" to:`, base);
    if (!nextName || nextName === base) return;
    const newPath = parent ? `${parent}/${nextName}` : `/${nextName}`;
    setVpsStatus({ loading: true, error: null, success: null });
    try {
      await sendVpsRequest('rename-path', { path, new_path: newPath });
      if (vpsSelectedFile === path) setVpsSelectedFile(newPath);
      setVpsStatus({ loading: false, error: null, success: `Renamed to ${nextName}.` });
      await loadVpsPath(vpsPath);
    } catch (err) {
      setVpsStatus({ loading: false, error: err.message, success: null });
    }
  }, [loadVpsPath, sendVpsRequest, vpsPath, vpsSelectedFile]);

  const openRemoteFile = useCallback(async (path) => {
    if (isBinaryFilename(path)) {
      await downloadVpsFile(path);
      return;
    }
    setVpsStatus({ loading: true, error: null, success: null });
    try {
      const data = await sendVpsRequest('read-file', { path });
      const content = data.content || '';
      const looksBinary = looksBinaryText(content);
      setVpsSelectedFile(path);
      setVpsFileContent(content);
      setVpsFileBinary(looksBinary);
      setVpsStatus({
        loading: false,
        error: null,
        success: looksBinary
          ? `${path} looks binary — editing disabled, use Download instead.`
          : `File ${path} loaded.`,
      });
    } catch (err) {
      setVpsStatus({ loading: false, error: err.message, success: null });
    }
  }, [downloadVpsFile, sendVpsRequest]);

  const saveRemoteFile = useCallback(async () => {
    if (!vpsSelectedFile) {
      setVpsStatus({ loading: false, error: 'Select or enter a file path to save.', success: null });
      return;
    }
    setVpsStatus({ loading: true, error: null, success: null });
    try {
      await sendVpsRequest('write-file', { path: vpsSelectedFile, content: vpsFileContent });
      setVpsStatus({ loading: false, error: null, success: `File ${vpsSelectedFile} saved.` });
      await loadVpsPath(vpsPath);
    } catch (err) {
      setVpsStatus({ loading: false, error: err.message, success: null });
    }
  }, [loadVpsPath, sendVpsRequest, vpsFileContent, vpsPath, vpsSelectedFile]);

  const deleteRemotePath = useCallback(async (path) => {
    if (!path) return;
    setVpsStatus({ loading: true, error: null, success: null });
    try {
      await sendVpsRequest('delete-path', { path });
      if (vpsSelectedFile === path) {
        setVpsSelectedFile('');
        setVpsFileContent('');
      }
      setVpsStatus({ loading: false, error: null, success: `Removed: ${path}` });
      await loadVpsPath(vpsPath);
    } catch (err) {
      setVpsStatus({ loading: false, error: err.message, success: null });
    }
  }, [loadVpsPath, sendVpsRequest, vpsPath, vpsSelectedFile]);

  const runVpsCommand = useCallback(async (command, appendTerminal = false) => {
    setVpsStatus({ loading: true, error: null, success: null });
    try {
      const data = await sendVpsRequest('run-command', { command, cwd: vpsTerminalCwd });
      const output = [`${data.cwd || vpsTerminalCwd} $ ${command}`, data.stdout, data.stderr].filter(Boolean).join('\n');
      if (data.cwd) {
        setVpsTerminalCwd(data.cwd);
      }
      if (appendTerminal) {
        setVpsTerminalOutput((prev) => `${prev}${prev ? '\n\n' : ''}${output}`);
      }
      setVpsStatus({ loading: false, error: null, success: `Command executed (status ${data.exitStatus}).` });
      return output;
    } catch (err) {
      setVpsStatus({ loading: false, error: err.message, success: null });
      if (appendTerminal) {
        setVpsTerminalOutput((prev) => `${prev}${prev ? '\n\n' : ''}Error: ${err.message}`);
      }
      return null;
    }
  }, [sendVpsRequest, vpsTerminalCwd]);

  const testVpsConnection = useCallback(async () => {
    if (!vpsConnection.host || !vpsConnection.username) {
      setVpsStatus({ loading: false, error: 'Host and username are required to connect.', success: null });
      return;
    }
    setVpsConnState({ status: 'testing', user: null, info: null });
    setVpsStatus({ loading: true, error: null, success: null });
    try {
      const data = await sendVpsRequest('test-connection', {});
      setVpsConnState({ status: 'ok', user: data.user, info: data.info });
      setVpsStatus({ loading: false, error: null, success: `Connected as ${data.user}@${vpsConnection.host}.` });
    } catch (err) {
      setVpsConnState({ status: 'error', user: null, info: null });
      setVpsStatus({ loading: false, error: err.message, success: null });
    }
  }, [sendVpsRequest, vpsConnection.host, vpsConnection.username]);

  const fetchSystemOverview = useCallback(async () => {
    setSystemStatus({ loading: true, error: null });
    try {
      const res = await fetch('/api/system/overview');
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || res.statusText);
      }
      setSystemOverview(data);
      setSystemStatus({ loading: false, error: null });
    } catch (err) {
      setSystemStatus({ loading: false, error: err.message });
    }
  }, []);

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
      const data = await readJsonSafe(response);
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
            currentBranch: activeBranch,
            operationStatus: `Branches refreshed. VPS active branch: ${activeBranch || 'unknown branch'}.`,
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
      const normalized = normalizeApplicationsPayload(data);
      if (!res.ok || !normalized) {
        throw new Error(data?.detail || data?.error || 'Invalid applications payload');
      }
      setApplications(normalized);
      setApplicationsError(null);
    } catch (err) {
      console.error(err);
      setApplicationsError(err.message || 'Failed to load applications');
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
          operationStatus: 'Running pull on selected branch...',
        },
      }));

    try {
      const response = await fetch(`/api/applications/${appId}/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: selectedBranch }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || response.statusText);
      }

      setGitUiState((prev) => ({
        ...prev,
        [appId]: {
          ...(prev[appId] || {}),
          pullLoading: false,
          gitError: null,
          currentBranch: data?.currentBranch || selectedBranch,
          operationStatus: `Pull completed successfully on ${data?.currentBranch || selectedBranch}.`,
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
          operationStatus: 'Pull failed. Check the error below.',
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
          operationStatus: action === 'start' ? 'Running deploy (compose up --build -d)...' : 'Stopping containers (compose stop)...',
        },
      }));

    try {
      const response = await fetch(`/api/applications/${appId}/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || response.statusText);
      }

      setGitUiState((prev) => ({
        ...prev,
        [appId]: {
          ...(prev[appId] || {}),
          composeLoading: null,
          gitError: null,
          operationStatus: action === 'start' ? 'Deploy completed successfully.' : 'Containers stopped successfully.',
        },
      }));
      await fetchApplications();
      await refreshBranches(appId, data?.branch || selectedBranch);
    } catch (err) {
      const errorMessage = err?.message || '';
      const composeTimedOut = action === 'start' && /504\s+Gateway\s+Time-?out/i.test(errorMessage);

      if (composeTimedOut) {
        setGitUiState((prev) => ({
          ...prev,
          [appId]: {
            ...(prev[appId] || {}),
            composeLoading: null,
            gitError: null,
            operationStatus: 'Deploy request sent. Refreshing container status...',
          },
        }));
        await fetchApplications();
        setTimeout(() => {
          fetchApplications();
        }, 2500);
        return;
      }

      setGitUiState((prev) => ({
        ...prev,
        [appId]: {
          ...(prev[appId] || {}),
          composeLoading: null,
          gitError: err.message,
          operationStatus: 'Compose action failed. Check the error below.',
        },
      }));
    }
  }, [fetchApplications, refreshBranches]);


  const safeApplications = useMemo(() => (Array.isArray(applications) ? applications : []), [applications]);

  const allContainers = useMemo(() => safeApplications.flatMap((app) => app.containers || []), [safeApplications]);

  const nodeTypes = useMemo(() => ({ container: ContainerNode, application: ApplicationNode }), []);

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
          currentBranch: gitUiState[app.id]?.currentBranch || app.gitBranch || '',
          operationStatus: gitUiState[app.id]?.operationStatus || null,
          operationInProgress: !!(gitUiState[app.id]?.branchLoading || gitUiState[app.id]?.pullLoading || gitUiState[app.id]?.composeLoading),
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
    if (sidebarTab === 'system') {
      fetchSystemOverview();
    }
  }, [sidebarTab, fetchSystemOverview]);

  useEffect(() => {
    if (!applicationsError) return undefined;
    const timer = setTimeout(() => {
      fetchApplications();
    }, 3000);
    return () => clearTimeout(timer);
  }, [applicationsError, fetchApplications]);

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

  useEffect(() => {
    const loadVpsDefaults = async () => {
      try {
        const response = await fetch('/api/vps/defaults');
        const data = await readJsonSafe(response);
        if (!response.ok) return;

        setVpsConnection((prev) => ({
          host: prev.host || data.host || '',
          port: prev.port || data.port || 22,
          username: prev.username || data.username || '',
          password: prev.password || data.password || '',
          privateKey: prev.privateKey || data.privateKey || '',
        }));

        setVpsPath((prev) => prev || data.path || '/etc/nginx/sites-available');
        setVpsCommand((prev) => prev || data.defaultCommand || 'nginx -t');
      } catch {
        // Silent fallback: manual input remains available.
      }
    };

    loadVpsDefaults();
  }, []);

  return (
    <div className="h-screen flex">
      <div className="flex-1">
        <HighlightContext.Provider value={highlightedContainerId}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            proOptions={{}}
            nodesDraggable={false}
            onInit={setReactFlowInstance}
            style={{ width: '100%', height: '100%' }}
          >
            <Background />
          </ReactFlow>
        </HighlightContext.Provider>
      </div>
      <aside className="w-[26rem] border-l border-gray-200 bg-white text-black overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/favicon.svg" alt="" className="w-5 h-5 shrink-0" />
            <span className="font-semibold text-sm truncate">Dumb Docker</span>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="shrink-0 rounded px-2 py-1 text-[11px] font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300"
            title="Sign out of the dashboard"
          >
            Sign out
          </button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setSidebarTab('ports')} className={`rounded px-3 py-1 text-xs font-semibold ${sidebarTab === 'ports' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>Ports</button>
          <button type="button" onClick={() => setSidebarTab('system')} className={`rounded px-3 py-1 text-xs font-semibold ${sidebarTab === 'system' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>System</button>
          <button type="button" onClick={() => setSidebarTab('vps')} className={`rounded px-3 py-1 text-xs font-semibold ${sidebarTab === 'vps' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>VPS SFTP</button>
        </div>

        {sidebarTab === 'ports' && (
          <>
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">External Ports</h2>
              <p className="text-[11px] text-gray-500 mt-1">Double-click a port or use Focus to center its container</p>
            </div>
            {applicationsError && <p className="text-xs text-red-500 break-all">{applicationsError}</p>}
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
          </>
        )}

        {sidebarTab === 'system' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Host overview</h2>
              <button type="button" onClick={fetchSystemOverview} disabled={systemStatus.loading} className="rounded px-2 py-1 text-[11px] font-semibold bg-blue-600 text-white disabled:opacity-60">{systemStatus.loading ? 'Refreshing…' : 'Refresh'}</button>
            </div>
            <p className="text-[11px] text-gray-500">Live stats from the machine the dashboard runs on.</p>
            {systemStatus.error && <p className="text-xs text-red-500 break-all">{systemStatus.error}</p>}
            {!systemOverview && !systemStatus.error && <p className="text-xs text-gray-500">Loading…</p>}
            {systemOverview && (
              <div className="space-y-3">
                <StatBar
                  label="CPU load (1m)"
                  value={`${(systemOverview.loadAverage?.['1m'] ?? 0).toFixed(2)} / ${systemOverview.cpuCount} cores`}
                  percent={systemOverview.cpuCount ? ((systemOverview.loadAverage?.['1m'] || 0) / systemOverview.cpuCount) * 100 : 0}
                />
                <StatBar
                  label="Memory"
                  value={`${formatBytes(systemOverview.memory?.used)} / ${formatBytes(systemOverview.memory?.total)}`}
                  percent={systemOverview.memory?.usedPercent}
                />
                <StatBar
                  label={`Disk (${systemOverview.disk?.path || '/'})`}
                  value={`${formatBytes(systemOverview.disk?.used)} / ${formatBytes(systemOverview.disk?.total)}`}
                  percent={systemOverview.disk?.usedPercent}
                />
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-gray-100 rounded px-2 py-2">
                    <div className="text-gray-500 uppercase tracking-wide text-[10px]">Uptime</div>
                    <div className="font-semibold">{formatDuration(systemOverview.uptimeSeconds)}</div>
                  </div>
                  <div className="bg-gray-100 rounded px-2 py-2">
                    <div className="text-gray-500 uppercase tracking-wide text-[10px]">Containers</div>
                    <div className="font-semibold">{systemOverview.docker?.containersRunning ?? 0} run / {systemOverview.docker?.containers ?? 0}</div>
                  </div>
                </div>
                <div className="border rounded p-2 space-y-1">
                  <div className="font-semibold text-gray-700 uppercase tracking-wide text-[10px]">Docker disk usage</div>
                  <div className="flex justify-between"><span className="text-gray-600">Images ({systemOverview.docker?.images ?? 0})</span><span>{formatBytes(systemOverview.docker?.imagesSize)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Volumes ({systemOverview.docker?.volumes ?? 0})</span><span>{formatBytes(systemOverview.docker?.volumesSize)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Build cache</span><span>{formatBytes(systemOverview.docker?.buildCacheSize)}</span></div>
                </div>
                <div className="text-[10px] text-gray-400 break-all">Scan paths: {(systemOverview.scanPaths || []).join(', ')}</div>
              </div>
            )}
          </div>
        )}

        {sidebarTab === 'vps' && (
          <div className="space-y-3 text-xs">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">VPS Access (SFTP + commands)</h2>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Host" value={vpsConnection.host} onChange={(e) => setVpsConnection((prev) => ({ ...prev, host: e.target.value }))} className="border rounded px-2 py-1 col-span-2" />
              <input placeholder="Username" value={vpsConnection.username} onChange={(e) => setVpsConnection((prev) => ({ ...prev, username: e.target.value }))} className="border rounded px-2 py-1" />
              <input placeholder="Port" value={vpsConnection.port} onChange={(e) => setVpsConnection((prev) => ({ ...prev, port: e.target.value }))} className="border rounded px-2 py-1" />
              <input placeholder="Password" type="password" value={vpsConnection.password} onChange={(e) => setVpsConnection((prev) => ({ ...prev, password: e.target.value }))} className="border rounded px-2 py-1 col-span-2" />
              <textarea placeholder="Private key (optional)" value={vpsConnection.privateKey} onChange={(e) => setVpsConnection((prev) => ({ ...prev, privateKey: e.target.value }))} className="border rounded px-2 py-1 col-span-2 min-h-20" />
              {vpsConnection.privateKey && (
                <input placeholder="Private key passphrase (if encrypted)" type="password" value={vpsConnection.privateKeyPassphrase} onChange={(e) => setVpsConnection((prev) => ({ ...prev, privateKeyPassphrase: e.target.value }))} className="border rounded px-2 py-1 col-span-2" />
              )}
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={testVpsConnection} disabled={vpsStatus.loading} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded px-3 py-1 font-semibold">
                {vpsConnState.status === 'testing' ? 'Connecting…' : 'Test connection'}
              </button>
              {vpsConnState.status === 'ok' && <span className="text-emerald-700 truncate" title={vpsConnState.info || ''}>✓ {vpsConnState.user}@{vpsConnection.host}</span>}
              {vpsConnState.status === 'error' && <span className="text-red-600">✕ Connection failed</span>}
              {vpsConnState.status === 'unknown' && <span className="text-gray-400">Not connected yet</span>}
            </div>

            <div className="flex flex-wrap items-center gap-1 text-[11px] text-gray-600">
              <button type="button" onClick={() => loadVpsPath('/')} className="hover:text-blue-700 hover:underline" title="Go to root">/</button>
              {vpsPath.split('/').filter(Boolean).map((seg, idx, arr) => {
                const segPath = `/${arr.slice(0, idx + 1).join('/')}`;
                return (
                  <span key={segPath} className="flex items-center gap-1 min-w-0">
                    <span className="text-gray-400">›</span>
                    <button type="button" onClick={() => loadVpsPath(segPath)} className="hover:text-blue-700 hover:underline truncate max-w-[9rem]" title={segPath}>{seg}</button>
                  </span>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input value={vpsPath} onChange={(e) => setVpsPath(e.target.value)} className="border rounded px-2 py-1 flex-1" />
              <button type="button" onClick={() => loadVpsPath(vpsPath)} className="bg-blue-600 text-white rounded px-2">Open</button>
              <button type="button" onClick={() => {
                const parent = vpsPath.split('/').slice(0, -1).join('/') || '/';
                loadVpsPath(parent);
              }} className="bg-gray-600 text-white rounded px-2">↑</button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">{vpsEntries.length} item(s)</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => loadVpsPath(vpsPath)} className="text-[11px] text-blue-700 hover:underline">Refresh</button>
                <button type="button" onClick={() => vpsUploadInputRef.current?.click()} className="text-[11px] text-blue-700 hover:underline" title={`Upload file(s) into ${vpsPath}`}>⬆ Upload here</button>
              </div>
            </div>
            <input
              ref={vpsUploadInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { uploadVpsFiles(e.target.files); e.target.value = ''; }}
            />
            <div className="border rounded p-2 max-h-52 overflow-auto space-y-1">
              {vpsEntries.length === 0 && <p className="text-gray-400 px-1">Empty or not loaded.</p>}
              {vpsEntries.map((entry) => (
                <div key={entry.path} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left hover:bg-gray-100 rounded px-1 py-0.5 truncate"
                    title={entry.isDirectory ? `Open ${entry.name}` : `${entry.name} (${formatBytes(entry.size)})`}
                    onClick={() => (entry.isDirectory ? loadVpsPath(entry.path) : openRemoteFile(entry.path))}
                  >
                    {entry.isDirectory ? '📁' : '📄'} {entry.name}
                  </button>
                  {!entry.isDirectory && (
                    <button type="button" onClick={() => downloadVpsFile(entry.path)} className="opacity-60 hover:opacity-100" title="Download">⬇</button>
                  )}
                  <button type="button" onClick={() => renameRemotePath(entry.path, entry.isDirectory)} className="opacity-60 hover:opacity-100" title="Rename">✏️</button>
                  <button type="button" onClick={() => { if (window.confirm(`Delete "${entry.name}"?${entry.isDirectory ? ' This removes the folder and all its contents.' : ''} This cannot be undone.`)) deleteRemotePath(entry.path); }} className="text-red-600 opacity-70 hover:opacity-100" title="Delete">🗑</button>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <input placeholder="/path/file.conf" value={vpsSelectedFile} onChange={(e) => { setVpsSelectedFile(e.target.value); setVpsFileBinary(false); }} className="border rounded px-2 py-1 w-full" />
              {vpsFileBinary && <p className="text-amber-600 text-[11px]">Binary file detected — editing disabled. Use Download to fetch it.</p>}
              <textarea value={vpsFileContent} disabled={vpsFileBinary} onChange={(e) => setVpsFileContent(e.target.value)} className="border rounded px-2 py-1 w-full min-h-48 font-mono text-[11px] disabled:bg-gray-100 disabled:text-gray-400" />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveRemoteFile} disabled={vpsFileBinary} className="bg-green-600 disabled:opacity-50 text-white rounded px-2 py-1">Save / Create</button>
                {vpsSelectedFile && <button type="button" onClick={() => downloadVpsFile(vpsSelectedFile)} className="bg-blue-600 text-white rounded px-2 py-1">Download</button>}
                <button type="button" onClick={() => { if (vpsSelectedFile && window.confirm(`Delete ${vpsSelectedFile}? This cannot be undone.`)) deleteRemotePath(vpsSelectedFile); }} className="bg-red-600 text-white rounded px-2 py-1">Remove</button>
                <button type="button" onClick={async () => {
                  const dirName = window.prompt('Enter the directory path to create', `${vpsPath}/new-directory`);
                  if (!dirName) return;
                  try {
                    await sendVpsRequest('create-directory', { path: dirName });
                    await loadVpsPath(vpsPath);
                  } catch (err) {
                    setVpsStatus({ loading: false, error: err.message, success: null });
                  }
                }} className="bg-gray-700 text-white rounded px-2 py-1">New folder</button>
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="font-semibold text-[11px] uppercase">Quick commands</h3>
              <div className="flex flex-wrap gap-1">
                {['nginx -t', 'systemctl reload nginx', 'systemctl restart nginx', 'certbot renew', 'ls -la /etc/nginx/sites-available'].map((command) => (
                  <button key={command} type="button" onClick={() => { setVpsCommand(command); runVpsCommand(command); }} className="bg-black text-yellow-300 rounded px-2 py-1">{command}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={vpsCommand} onChange={(e) => setVpsCommand(e.target.value)} className="border rounded px-2 py-1 flex-1" />
                <button type="button" onClick={() => runVpsCommand(vpsCommand)} className="bg-blue-700 text-white rounded px-2 py-1">Run</button>
                <button type="button" onClick={() => setVpsTerminalOpen(true)} className="bg-gray-800 text-white rounded px-2 py-1">Terminal</button>
              </div>
            </div>

            {vpsStatus.loading && <p className="text-blue-600">Processing...</p>}
            {vpsStatus.error && <p className="text-red-600 break-all">{vpsStatus.error}</p>}
            {vpsStatus.success && <p className="text-green-700">{vpsStatus.success}</p>}
          </div>
        )}
      </aside>
      {vpsTerminalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white text-black rounded w-11/12 max-w-5xl max-h-[90vh] p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold truncate" title={vpsTerminalCwd}>Terminal VPS — <span className="font-mono text-sm text-gray-600">{vpsTerminalCwd}</span></h2>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setVpsTerminalOutput('')} className="bg-gray-500 text-white rounded px-3 py-1">Clear</button>
                <button type="button" onClick={() => setVpsTerminalOpen(false)} className="bg-gray-700 text-white rounded px-3 py-1">Close</button>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                value={vpsTerminalCommand}
                onChange={(e) => setVpsTerminalCommand(e.target.value)}
                onKeyDown={async (e) => {
                  const hist = vpsTerminalHistoryRef.current;
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (hist.length === 0) return;
                    const idx = vpsTerminalHistoryIndexRef.current < 0 ? hist.length - 1 : Math.max(0, vpsTerminalHistoryIndexRef.current - 1);
                    vpsTerminalHistoryIndexRef.current = idx;
                    setVpsTerminalCommand(hist[idx]);
                    return;
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (vpsTerminalHistoryIndexRef.current < 0) return;
                    const idx = vpsTerminalHistoryIndexRef.current + 1;
                    if (idx >= hist.length) {
                      vpsTerminalHistoryIndexRef.current = -1;
                      setVpsTerminalCommand('');
                    } else {
                      vpsTerminalHistoryIndexRef.current = idx;
                      setVpsTerminalCommand(hist[idx]);
                    }
                    return;
                  }
                  if (e.key !== 'Enter' || !vpsTerminalCommand.trim()) return;
                  e.preventDefault();
                  const cmd = vpsTerminalCommand;
                  vpsTerminalHistoryRef.current = [...hist.filter((c) => c !== cmd), cmd];
                  vpsTerminalHistoryIndexRef.current = -1;
                  await runVpsCommand(cmd, true);
                  setVpsTerminalCommand('');
                }}
                placeholder="Type a command (↑/↓ for history)"
                className="border rounded px-2 py-1 flex-1 font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!vpsTerminalCommand.trim()) return;
                  const cmd = vpsTerminalCommand;
                  vpsTerminalHistoryRef.current = [...vpsTerminalHistoryRef.current.filter((c) => c !== cmd), cmd];
                  vpsTerminalHistoryIndexRef.current = -1;
                  await runVpsCommand(cmd, true);
                  setVpsTerminalCommand('');
                }}
                className="bg-blue-700 text-white rounded px-3 py-1"
              >
                Run
              </button>
            </div>
            <pre className="bg-black text-green-300 p-3 rounded flex-1 overflow-auto text-xs whitespace-pre-wrap">{vpsTerminalOutput || 'No commands executed yet.'}</pre>
          </div>
        </div>
      )}

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

  const vpsDefaults = {
    host: process.env.VPS_HOST || process.env.NEXT_PUBLIC_VPS_HOST || '',
    port: process.env.VPS_PORT || process.env.NEXT_PUBLIC_VPS_PORT || 22,
    username: process.env.VPS_USERNAME || process.env.NEXT_PUBLIC_VPS_USERNAME || '',
    password: process.env.VPS_PASSWORD || process.env.NEXT_PUBLIC_VPS_PASSWORD || '',
    privateKey: process.env.VPS_PRIVATE_KEY || process.env.NEXT_PUBLIC_VPS_PRIVATE_KEY || '',
    path: process.env.VPS_PATH || process.env.NEXT_PUBLIC_VPS_PATH || '/etc/nginx/sites-available',
    defaultCommand: process.env.VPS_DEFAULT_COMMAND || process.env.NEXT_PUBLIC_VPS_DEFAULT_COMMAND || 'nginx -t',
  };

  return { props: { vpsDefaults } };
}
