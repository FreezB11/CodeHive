/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import { 
  Search, 
  FileCode, 
  FolderOpen, 
  Info, 
  ChevronRight, 
  X, 
  Maximize2, 
  Minimize2,
  Cpu,
  Network,
  BookOpen,
  ArrowLeft,
  Github,
  ExternalLink,
  Loader2,
  LogOut,
  Plus,
  Minus,
  Menu,
  Activity,
  Flame,
  Box,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  CodeFile, 
  GraphNode, 
  GraphLink, 
  CodebaseData, 
  parseCppIncludes, 
  buildGraph,
  extractDoxygen
} from './types';
import { generateFileDoc, FileDoc } from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

const Header = ({ user, onLogout, onToggleSidebar, showSidebarToggle }: { user: any, onLogout: () => void, onToggleSidebar: () => void, showSidebarToggle: boolean }) => (
  <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
    <div className="flex items-center gap-3">
      {showSidebarToggle && (
        <button 
          onClick={onToggleSidebar}
          className="p-2 hover:bg-zinc-900 rounded-md text-zinc-400 hover:text-zinc-100 transition-colors mr-2"
          title="Toggle Sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}
      <div className="w-8 h-8 bg-emerald-500/10 border border-emerald-500/20 rounded flex items-center justify-center">
        <Network className="w-5 h-5 text-emerald-500" />
      </div>
      <div>
        <h1 className="text-sm font-semibold tracking-tight text-zinc-100">CodeHive</h1>
        <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">C++ Codebase Visualizer</p>
      </div>
    </div>
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md">
        <Search className="w-4 h-4 text-zinc-500" />
        <input 
          type="text" 
          placeholder="Search files..." 
          className="bg-transparent border-none outline-none text-xs text-zinc-300 w-48"
        />
      </div>
      {user && (
        <div className="flex items-center gap-3 pl-4 border-l border-zinc-800">
          <img src={user.avatar_url} alt={user.login} className="w-6 h-6 rounded-full border border-zinc-700" />
          <span className="text-xs font-medium text-zinc-300">{user.login}</span>
          <button onClick={onLogout} className="p-1.5 hover:bg-zinc-900 rounded-md text-zinc-500 hover:text-red-400 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  </header>
);

const GitHubConnect = ({ onConnected }: { onConnected: () => void }) => {
  const [checking, setChecking] = useState(false);

  const handleConnect = async () => {
    const res = await fetch('/api/auth/github/url');
    const { url } = await res.json();
    window.open(url, 'github_oauth', 'width=600,height=700');
  };

  const manualCheck = async () => {
    setChecking(true);
    await onConnected();
    setTimeout(() => setChecking(false), 1000);
  };

  return (
    <div className="max-w-2xl mx-auto mt-20 p-12 border border-zinc-800 bg-zinc-900/30 rounded-2xl flex flex-col items-center text-center gap-6">
      <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-2">
        <Github className="w-8 h-8 text-zinc-400" />
      </div>
      <div>
        <h2 className="text-xl font-medium text-zinc-100 mb-2">Connect to GitHub</h2>
        <p className="text-zinc-500 text-sm max-w-sm">
          Connect your GitHub account to browse your C++ repositories. For large projects (12k+ files), you can browse subdirectories to keep the visualization manageable.
        </p>
      </div>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button 
          onClick={handleConnect}
          className="flex items-center justify-center gap-2 bg-white hover:bg-zinc-200 text-zinc-950 px-6 py-2.5 rounded-lg font-medium transition-colors"
        >
          <Github className="w-5 h-5" />
          Connect GitHub
        </button>
        <button 
          onClick={manualCheck}
          disabled={checking}
          className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors flex items-center justify-center gap-2"
        >
          {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          Already authorized? Click to check
        </button>
      </div>
    </div>
  );
};

const RepoSelector = ({ onRepoSelected }: { onRepoSelected: (repo: any, path?: string) => void }) => {
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<any | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [contents, setContents] = useState<any[]>([]);
  const [loadingContents, setLoadingContents] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('gh_token');
    const headers: Record<string, string> = {};
    if (token) headers['x-github-token'] = token;

    fetch('/api/repos', { headers })
      .then(res => res.json())
      .then(data => {
        setRepos(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  }, []);

  const fetchContents = async (repo: any, path: string) => {
    setLoadingContents(true);
    const token = sessionStorage.getItem('gh_token');
    const headers: Record<string, string> = {};
    if (token) headers['x-github-token'] = token;

    try {
      const branch = repo.default_branch || "main";
      const res = await fetch(`/api/repo/files?owner=${repo.owner.login}&repo=${repo.name}&path=${path}&branch=${branch}`, { headers });
      const data = await res.json();
      setContents(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to fetch contents", e);
    } finally {
      setLoadingContents(false);
    }
  };

  const handleRepoClick = (repo: any) => {
    setSelectedRepo(repo);
    setCurrentPath("");
    fetchContents(repo, "");
  };

  const handleDirClick = (path: string) => {
    setCurrentPath(path);
    fetchContents(selectedRepo, path);
  };

  const handleBack = () => {
    if (currentPath === "") {
      setSelectedRepo(null);
    } else {
      const parts = currentPath.split('/');
      parts.pop();
      const newPath = parts.join('/');
      setCurrentPath(newPath);
      fetchContents(selectedRepo, newPath);
    }
  };

  const analyzeCurrentFolder = () => {
    onRepoSelected(selectedRepo, currentPath);
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      <p className="text-xs text-zinc-500 font-mono">Fetching your repositories...</p>
    </div>
  );

  if (selectedRepo) {
    return (
      <div className="max-w-4xl mx-auto mt-10 p-8 h-full flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-8 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={handleBack} className="p-2 hover:bg-zinc-900 rounded-lg text-zinc-400">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-xl font-medium text-zinc-100">{selectedRepo.name}</h2>
              <p className="text-xs font-mono text-zinc-500">/{currentPath}</p>
            </div>
          </div>
          <button 
            onClick={analyzeCurrentFolder}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Cpu className="w-4 h-4" />
            Analyze This Folder
          </button>
        </div>

        {loadingContents ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 flex-1">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            <p className="text-xs text-zinc-500 font-mono">Loading folder contents...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1 overflow-y-auto flex-1 custom-scrollbar pr-2">
            {contents.map(item => (
              <button 
                key={item.path}
                onClick={() => item.type === 'dir' ? handleDirClick(item.path) : null}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border border-transparent transition-all text-left",
                  item.type === 'dir' ? "hover:bg-zinc-900 hover:border-zinc-800 text-zinc-300" : "text-zinc-500 cursor-default"
                )}
              >
                <div className="flex items-center gap-3">
                  {item.type === 'dir' ? <FolderOpen className="w-4 h-4 text-emerald-500" /> : <FileCode className="w-4 h-4 text-zinc-600" />}
                  <span className="text-sm font-mono">{item.name}</span>
                </div>
                {item.type === 'dir' && <ChevronRight className="w-4 h-4 text-zinc-700" />}
              </button>
            ))}
            {contents.length === 0 && (
              <div className="py-20 text-center">
                <p className="text-zinc-500 text-sm">This folder is empty or contains no supported files.</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto mt-10 p-8 h-full flex flex-col overflow-hidden">
      <h2 className="text-xl font-medium text-zinc-100 mb-6 flex items-center gap-2 flex-shrink-0">
        <FolderOpen className="w-5 h-5 text-emerald-500" />
        Select a Repository
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto flex-1 custom-scrollbar pr-2">
        {repos.map(repo => (
          <button 
            key={repo.id}
            onClick={() => handleRepoClick(repo)}
            className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-emerald-500/50 hover:bg-zinc-900 transition-all text-left group h-fit"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-zinc-200 group-hover:text-emerald-400 transition-colors">{repo.name}</span>
              <ExternalLink className="w-3 h-3 text-zinc-600" />
            </div>
            <p className="text-xs text-zinc-500 line-clamp-1 mb-3">{repo.description || "No description provided."}</p>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-zinc-600">{repo.language || "Unknown"}</span>
              <span className="text-[10px] font-mono text-zinc-600">★ {repo.stargazers_count}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

const GraphView = ({ 
  data, 
  selectedFile, 
  hoveredFile,
  highlightMode,
  viewMode,
  onNodeClick,
  onNodeHover
}: { 
  data: CodebaseData, 
  selectedFile: CodeFile | null, 
  hoveredFile: CodeFile | null,
  highlightMode: 'all' | 'out' | 'in',
  viewMode: 'spatial' | 'hotspots',
  onNodeClick: (node: GraphNode | null) => void,
  onNodeHover: (node: GraphNode | null) => void
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [highlightDepth, setHighlightDepth] = useState(1);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeHoverRef = useRef(onNodeHover);

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
    onNodeHoverRef.current = onNodeHover;
  }, [onNodeClick, onNodeHover]);

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g");

    // Add a transparent background to capture zoom/pan events everywhere
    svg.append("rect")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("fill", "none")
      .attr("pointer-events", "all")
      .on("click", (event) => {
        // Only clear if we clicked the background directly, not a node
        if (event.target.tagName === 'rect') {
          onNodeClickRef.current(null);
        }
      });

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    const simulation = d3.forceSimulation<GraphNode>(data.nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(data.links).id(d => (d as any).id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(d => (d as any).size + 10));

    const link = g.append("g")
      .selectAll("line")
      .data(data.links)
      .join("line")
      .attr("class", "link-line")
      .attr("stroke", "#3f3f46")
      .attr("stroke-opacity", 0.7)
      .attr("stroke-width", 1.2);

    const node = g.append("g")
      .selectAll("g")
      .data(data.nodes)
      .join("g")
      .attr("class", "node-group")
      .attr("cursor", "pointer")
      .attr("pointer-events", "all")
      .on("click", (event, d) => {
        event.stopPropagation();
        onNodeClickRef.current(d);
      })
      .on("mouseenter", (event, d) => {
        onNodeHoverRef.current(d);
      })
      .on("mouseleave", () => {
        onNodeHoverRef.current(null);
      })
      .call(d3.drag<any, any>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    node.append("circle")
      .attr("r", d => d.size)
      .attr("fill", d => {
        if (viewMode === 'hotspots') {
          const churn = d.churn || 0;
          // Color scale from zinc-800 to red-500
          const colors = ['#27272a', '#3f3f46', '#71717a', '#ef4444', '#f87171'];
          if (churn === 0) return colors[0];
          if (churn < 5) return colors[1];
          if (churn < 10) return colors[2];
          if (churn < 20) return colors[3];
          return colors[4];
        }
        const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];
        const groupHash = d.group.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return colors[groupHash % colors.length];
      })
      .attr("stroke", d => d.isBroken ? "#ef4444" : "rgba(255,255,255,0.2)")
      .attr("stroke-width", d => d.isBroken ? 2 : 1)
      .attr("pointer-events", "none");

    node.append("text")
      .text(d => d.name)
      .attr("x", d => d.size + 4)
      .attr("y", 4)
      .attr("font-size", "10px")
      .attr("fill", "#a1a1aa")
      .attr("font-family", "JetBrains Mono")
      .attr("pointer-events", "none");

    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as any).x)
        .attr("y1", d => (d.source as any).y)
        .attr("x2", d => (d.target as any).x)
        .attr("y2", d => (d.target as any).y);

      node
        .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    return () => { simulation.stop(); };
  }, [data]);

  // Zoom to selected node logic
  useEffect(() => {
    if (!svgRef.current || !zoomRef.current || !selectedFile) return;
    
    const node = data.nodes.find(n => n.path === selectedFile.path);
    if (!node || node.x === undefined || node.y === undefined) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    d3.select(svgRef.current)
      .transition()
      .duration(750)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(1.5)
          .translate(-node.x, -node.y)
      );
  }, [selectedFile, data.nodes]);

  // Highlighting Logic
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const nodes = svg.selectAll(".node-group");
    const links = svg.selectAll(".link-line");

    const activePath = hoveredFile?.path || selectedFile?.path;

    if (!activePath) {
      nodes.style("opacity", 1);
      links.style("opacity", 0.7).attr("stroke", "#3f3f46");
      
      // Reset rings
      nodes.select("circle")
        .attr("stroke", "rgba(255,255,255,0.2)")
        .attr("stroke-width", 1)
        .attr("filter", "none");
      return;
    }

    const neighbors = new Set<string>();
    const activeLinks = new Set<any>();
    neighbors.add(activePath);
    
    let currentLevel = [activePath];
    for (let i = 0; i < highlightDepth; i++) {
      const nextLevel: string[] = [];
      data.links.forEach(l => {
        const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
        
        const isOutbound = currentLevel.includes(s);
        const isInbound = currentLevel.includes(t);

        if (isOutbound && (highlightMode === 'all' || highlightMode === 'out')) {
          activeLinks.add(l);
          if (!neighbors.has(t)) {
            neighbors.add(t);
            nextLevel.push(t);
          }
        }
        if (isInbound && (highlightMode === 'all' || highlightMode === 'in')) {
          activeLinks.add(l);
          if (!neighbors.has(s)) {
            neighbors.add(s);
            nextLevel.push(s);
          }
        }
      });
      currentLevel = nextLevel;
      if (currentLevel.length === 0) break;
    }

    nodes.style("opacity", (d: any) => neighbors.has(d.id) ? 1 : 0.1);
    
    // Highlight active node with a ring
    nodes.select("circle")
      .attr("stroke", (d: any) => {
        if (d.path === hoveredFile?.path) return "#10b981";
        if (d.path === selectedFile?.path) return "#fff";
        return "rgba(255,255,255,0.2)";
      })
      .attr("stroke-width", (d: any) => (d.path === hoveredFile?.path || d.path === selectedFile?.path) ? 2 : 1)
      .attr("filter", (d: any) => (d.path === hoveredFile?.path || d.path === selectedFile?.path) ? "drop-shadow(0 0 8px rgba(255,255,255,0.4))" : "none");

    // Scale effect on hover
    nodes.select("circle").transition().duration(200)
      .attr("transform", (d: any) => {
        const scale = d.path === hoveredFile?.path ? 1.3 : 1;
        return `scale(${scale})`;
      });

    links.style("opacity", (l: any) => activeLinks.has(l) ? 1 : 0.05)
         .attr("stroke", (l: any) => activeLinks.has(l) ? "#10b981" : "#3f3f46");
  }, [hoveredFile, selectedFile, data.links, highlightDepth, highlightMode, viewMode]);

  return (
    <div className="relative w-full h-full bg-[#050505] overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />
      
      {/* Tooltip */}
      <AnimatePresence>
        {hoveredFile && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-8 left-8 p-4 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl max-w-xs pointer-events-none"
          >
            <div className="flex items-center gap-2 mb-2">
              <FileCode className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-mono text-zinc-100 truncate">{hoveredFile.name}</span>
            </div>
            <p className="text-[10px] text-zinc-500 font-mono mb-2">{hoveredFile.path}</p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">Group: {hoveredFile.path.split('/').slice(0, -1).join('/') || 'root'}</span>
              {hoveredFile.churn !== undefined && (
                <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20">Churn: {hoveredFile.churn}</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <button 
          onClick={() => {
            if (svgRef.current && zoomRef.current) {
              d3.select(svgRef.current).transition().duration(300).call(
                zoomRef.current.scaleBy, 1.3
              );
            }
          }}
          className="p-2 bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors flex items-center justify-center"
          title="Zoom In"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button 
          onClick={() => {
            if (svgRef.current && zoomRef.current) {
              d3.select(svgRef.current).transition().duration(300).call(
                zoomRef.current.scaleBy, 0.7
              );
            }
          }}
          className="p-2 bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors flex items-center justify-center"
          title="Zoom Out"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button 
          onClick={() => {
            if (svgRef.current && zoomRef.current) {
              d3.select(svgRef.current).transition().duration(750).call(
                zoomRef.current.transform, 
                d3.zoomIdentity
              );
            }
          }}
          className="p-2 bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors flex items-center justify-center"
          title="Reset View"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <div className="p-2 bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-md text-zinc-400 hover:text-white cursor-pointer transition-colors flex items-center justify-center">
          <Info className="w-4 h-4" />
        </div>

        <div className="mt-4 p-3 bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-lg flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">Highlight</span>
            <div className="flex bg-zinc-800 rounded p-0.5">
              <button 
                onClick={() => setHighlightDepth(1)}
                className={cn("px-2 py-0.5 text-[9px] rounded", highlightDepth === 1 ? "bg-zinc-700 text-white" : "text-zinc-500")}
              >
                Reset
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">Depth</span>
            <span className="text-[10px] font-mono text-emerald-400">{highlightDepth}</span>
          </div>
          <input 
            type="range" 
            min="1" 
            max="10" 
            step="1" 
            value={highlightDepth}
            onChange={(e) => setHighlightDepth(parseInt(e.target.value))}
            className="w-32 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
        </div>
      </div>
    </div>
  );
};

const DocPanel = ({ file, onClose, dependents, onMove }: { file: CodeFile, onClose: () => void, dependents: CodeFile[], onMove?: (newPath: string) => void }) => {
  const [doc, setDoc] = useState<FileDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [doxygen, setDoxygen] = useState("");
  const [isSandbox, setIsSandbox] = useState(false);
  const [newPath, setNewPath] = useState(file.path);

  useEffect(() => {
    setDoxygen(extractDoxygen(file.content));
    setDoc(null);
  }, [file]);

  const handleAIAnalysis = async () => {
    setLoading(true);
    try {
      const result = await generateFileDoc(file.name, file.content);
      setDoc(result);
    } catch (error: any) {
      console.error("Gemini Error:", error);
      if (error.message?.includes('429') || error.toString().includes('429')) {
        setDoc({
          summary: "AI Rate Limit Exceeded. Please wait a moment before trying again.",
          keyComponents: ["Rate Limit reached"],
          responsibilities: "The Gemini API is currently busy handling other requests.",
          complexity: "Medium"
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-y-0 right-0 w-[450px] bg-zinc-950 border-l border-zinc-800 z-[60] shadow-2xl flex flex-col"
    >
      <div className="h-16 border-b border-zinc-800 flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-medium text-zinc-100">File Documentation</span>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-zinc-900 rounded-md transition-colors">
          <X className="w-4 h-4 text-zinc-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="mb-8">
          <h2 className="text-2xl font-serif italic text-zinc-100 mb-1">{file.name}</h2>
          <p className="text-xs font-mono text-zinc-500">{file.path}</p>
        </div>

        <div className="space-y-10">
          {isSandbox ? (
            <section className="animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-lg mb-6">
                <h4 className="text-xs font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                  <Box className="w-3 h-3" />
                  Refactoring Sandbox
                </h4>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Simulate moving this file to a new location. We'll calculate which dependencies will break and how it affects the "Hive".
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Virtual Path</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newPath}
                      onChange={(e) => setNewPath(e.target.value)}
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-300 font-mono"
                    />
                    <button 
                      onClick={() => onMove?.(newPath)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                  <h5 className="text-[10px] font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Predicted Impact</h5>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500">Broken Inbound Links</span>
                      <span className="text-[10px] font-mono text-red-400">{dependents.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500">Broken Outbound Links</span>
                      <span className="text-[10px] font-mono text-red-400">{file.includes.length}</span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setIsSandbox(false)}
                  className="w-full py-2 border border-zinc-800 text-zinc-500 hover:text-zinc-300 text-[10px] uppercase tracking-widest font-mono rounded transition-colors"
                >
                  Cancel Sandbox
                </button>
              </div>
            </section>
          ) : (
            <>
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Impact Analysis</h3>
                  <button 
                    onClick={() => setIsSandbox(true)}
                    className="flex items-center gap-1.5 text-[10px] text-emerald-500 hover:text-emerald-400 font-mono"
                  >
                    <Box className="w-3 h-3" />
                    Sandbox Mode
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                    <div className="flex items-center gap-2 text-zinc-400 mb-1">
                      <ArrowUpRight className="w-3 h-3" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider">Dependencies</span>
                    </div>
                    <p className="text-lg font-mono text-zinc-200">{file.includes.length}</p>
                    <p className="text-[9px] text-zinc-500 mt-1">Outbound includes</p>
                  </div>
                  <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                    <div className="flex items-center gap-2 text-zinc-400 mb-1">
                      <ArrowDownLeft className="w-3 h-3" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider">Dependents</span>
                    </div>
                    <p className="text-lg font-mono text-zinc-200">{dependents.length}</p>
                    <p className="text-[9px] text-zinc-500 mt-1">Inbound references</p>
                  </div>
                </div>
                
                {dependents.length > 0 && (
                  <div className="mt-4 space-y-1">
                    <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">Used by:</p>
                    {dependents.slice(0, 5).map(dep => (
                      <div key={dep.path} className="text-[10px] font-mono text-zinc-400 truncate flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-zinc-700" />
                        {dep.name}
                      </div>
                    ))}
                    {dependents.length > 5 && <p className="text-[9px] text-zinc-600 italic">...and {dependents.length - 5} more</p>}
                  </div>
                )}
              </section>

              {doxygen && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-4">Extracted Comments</h3>
                  <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg text-sm text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
                    {doxygen}
                  </div>
                </section>
              )}

              {!doc && !loading && (
                <div className="py-6 flex flex-col items-center justify-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/20">
                  <Cpu className="w-8 h-8 text-zinc-700 mb-4" />
                  <p className="text-xs text-zinc-500 mb-4 text-center px-6">
                    Need a deeper understanding? Let Gemini analyze the code structure and responsibilities.
                  </p>
                  <button 
                    onClick={handleAIAnalysis}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    Generate AI Analysis
                  </button>
                </div>
              )}

              {loading && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-zinc-500 font-mono animate-pulse">Analyzing codebase with Gemini...</p>
                </div>
              )}

              {doc && (
                <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <section>
                    <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-4">AI Summary</h3>
                    <p className="text-sm text-zinc-300 leading-relaxed">{doc.summary}</p>
                  </section>

                  <section>
                    <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-4">Key Components</h3>
                    <div className="flex flex-wrap gap-2">
                      {doc.keyComponents.map((comp, i) => (
                        <span key={i} className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[11px] font-mono text-emerald-400">
                          {comp}
                        </span>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-4">Responsibilities</h3>
                    <p className="text-sm text-zinc-300 leading-relaxed">{doc.responsibilities}</p>
                  </section>

                  <section>
                    <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-4">Metadata</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                        <p className="text-[10px] text-zinc-500 uppercase mb-1">Complexity</p>
                        <p className={cn(
                          "text-xs font-semibold",
                          doc.complexity === 'High' ? 'text-red-400' : doc.complexity === 'Medium' ? 'text-amber-400' : 'text-emerald-400'
                        )}>{doc.complexity}</p>
                      </div>
                      <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                        <p className="text-[10px] text-zinc-500 uppercase mb-1">File Size</p>
                        <p className="text-xs font-semibold text-zinc-300">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-4">Includes</h3>
                <div className="space-y-1">
                  {file.includes.map((inc, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                      <ChevronRight className="w-3 h-3 text-zinc-600" />
                      <span>{inc}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      <div className="p-6 border-t border-zinc-800 bg-zinc-950/50">
        <button className="w-full py-2.5 bg-zinc-100 hover:bg-white text-zinc-950 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
          <FileCode className="w-4 h-4" />
          View Source Code
        </button>
      </div>
    </motion.div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<CodeFile | null>(null);
  const [graphData, setGraphData] = useState<CodebaseData | null>(null);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [repoTree, setRepoTree] = useState<any[]>([]); 
  const [currentRepoId, setCurrentRepoId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [hoveredFile, setHoveredFile] = useState<CodeFile | null>(null);
  const [highlightMode, setHighlightMode] = useState<'all' | 'out' | 'in'>('all');
  const [viewMode, setViewMode] = useState<'spatial' | 'hotspots'>('spatial');
  const [sandboxMoves, setSandboxMoves] = useState<Record<string, string>>({});

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log("Received message:", event.data);
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        console.log("OAuth Success detected, checking user...");
        if (event.data.token) {
          sessionStorage.setItem('gh_token', event.data.token);
        }
        checkUser();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkUser = async () => {
    console.log("Checking user authentication status...");
    const token = sessionStorage.getItem('gh_token');
    const headers: Record<string, string> = {};
    if (token) headers['x-github-token'] = token;

    try {
      const res = await fetch('/api/user', { headers });
      if (res.ok) {
        const data = await res.json();
        console.log("User authenticated:", data.login);
        setUser(data);
      } else {
        console.log("User not authenticated (status:", res.status, ")");
      }
    } catch (e) {
      console.error("Auth check failed", e);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    sessionStorage.removeItem('gh_token');
    setUser(null);
    setFiles([]);
    setGraphData(null);
  };

  const handleRepoSelected = async (repo: any, path: string = "") => {
    setLoadingRepo(true);
    const token = sessionStorage.getItem('gh_token');
    const headers: Record<string, string> = {};
    if (token) headers['x-github-token'] = token;

    try {
      const branch = repo.default_branch || "main";
      
      // 1. Fetch the full recursive tree if we haven't already OR if we've switched repos
      let currentTree = repoTree;
      if (repoTree.length === 0 || currentRepoId !== repo.id) {
        console.log(`Fetching fresh tree for repo: ${repo.name} (branch: ${branch})`);
        const treeRes = await fetch(`/api/repo/tree?owner=${repo.owner.login}&repo=${repo.name}&branch=${branch}`, { headers });
        if (treeRes.ok) {
          currentTree = await treeRes.json();
          setRepoTree(currentTree);
          setCurrentRepoId(repo.id);
        } else {
          const errData = await treeRes.json();
          throw new Error(errData.error || "Failed to fetch repository structure");
        }
      }

      const cppExtensions = ['.cpp', '.h', '.hpp', '.cc', '.cxx', '.hxx', '.c', '.hh', '.inl'];
      
      // 2. Identify ALL files under the selected path (RECURSIVE)
      const normalizedPath = path ? (path.endsWith('/') ? path : path + '/') : "";
      const filesInScope = currentTree.filter((item: any) => {
        if (item.type !== 'blob') return false;
        const isUnderPath = path === "" || item.path.startsWith(normalizedPath);
        if (!isUnderPath) return false;
        
        const pathLower = item.path.toLowerCase();
        return cppExtensions.some(ext => pathLower.endsWith(ext));
      });

      console.log(`Found ${filesInScope.length} C++ files in scope for path: "${path}"`);

      if (filesInScope.length === 0) {
        alert(`No C++ files found in "${path}" or its subfolders. Please try a different folder.`);
        setLoadingRepo(false);
        return;
      }

      // 3. Limit to 2000 files for performance (increased from 1000)
      const filesToFetch = filesInScope.slice(0, 3000);
      if (filesInScope.length > 3000) {
        console.warn(`Truncating analysis to first 3000 files out of ${filesInScope.length}`);
      }

      const loadedFiles: CodeFile[] = [];
      const externalPathsToFetch = new Set<string>();

      // 4. Fetch content for all files in scope
      // Increased chunkSize to 30 for faster parallel fetching
      const chunkSize = 30;
      for (let i = 0; i < filesToFetch.length; i += chunkSize) {
        const chunk = filesToFetch.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (f: any) => {
          try {
            const params = new URLSearchParams({
              owner: repo.owner.login,
              repo: repo.name,
              path: f.path
            });
            const contentRes = await fetch(`/api/repo/file/content?${params.toString()}`, { headers });
            const contentType = contentRes.headers.get("content-type");
            if (contentRes.ok && contentType && contentType.includes("application/json")) {
              const data = await contentRes.json();
              if (data.content) {
                const includes = parseCppIncludes(data.content);
                loadedFiles.push({
                  name: f.path.split('/').pop() || f.path,
                  path: f.path,
                  content: data.content,
                  size: f.size || 0,
                  includes
                });

                includes.forEach(inc => {
                  const incName = inc.split('/').pop() || inc;
                  const found = currentTree.find(item => item.path.endsWith(incName) || item.path.endsWith(inc));
                  if (found && !filesInScope.some(ff => ff.path === found.path)) {
                    externalPathsToFetch.add(found.path);
                  }
                });
              }
            } else {
              console.error(`Failed to fetch content for ${f.path}:`, contentRes.statusText);
            }
          } catch (e) {
            console.error(`Failed to fetch ${f.path}`, e);
          }
        }));
      }

      // 5. Fetch content for discovered external headers (Level 1 Depth - up to 500 files)
      const externalPaths = Array.from(externalPathsToFetch).slice(0, 500);
      const secondaryPathsToFetch = new Set<string>();

      for (let i = 0; i < externalPaths.length; i += chunkSize) {
        const chunk = externalPaths.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (p: string) => {
          if (loadedFiles.some(f => f.path === p)) return;
          
          try {
            const params = new URLSearchParams({
              owner: repo.owner.login,
              repo: repo.name,
              path: p
            });
            const contentRes = await fetch(`/api/repo/file/content?${params.toString()}`, { headers });
            const contentType = contentRes.headers.get("content-type");
            if (contentRes.ok && contentType && contentType.includes("application/json")) {
              const data = await contentRes.json();
              if (data.content) {
                const includes = parseCppIncludes(data.content);
                loadedFiles.push({
                  name: p.split('/').pop() || p,
                  path: p,
                  content: data.content,
                  size: data.size || 0,
                  includes
                });

                includes.forEach(inc => {
                  const incName = inc.split('/').pop() || inc;
                  const found = currentTree.find(item => item.path.endsWith(incName) || item.path.endsWith(inc));
                  if (found && !loadedFiles.some(ff => ff.path === found.path)) {
                    secondaryPathsToFetch.add(found.path);
                  }
                });
              }
            }
          } catch (e) {}
        }));
      }

      // 6. Level 2 Depth Fetch (up to 300 more files)
      const secondaryPaths = Array.from(secondaryPathsToFetch).slice(0, 300);
      const tertiaryPathsToFetch = new Set<string>();

      for (let i = 0; i < secondaryPaths.length; i += chunkSize) {
        const chunk = secondaryPaths.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (p: string) => {
          if (loadedFiles.some(f => f.path === p)) return;
          try {
            const params = new URLSearchParams({
              owner: repo.owner.login,
              repo: repo.name,
              path: p
            });
            const contentRes = await fetch(`/api/repo/file/content?${params.toString()}`, { headers });
            const contentType = contentRes.headers.get("content-type");
            if (contentRes.ok && contentType && contentType.includes("application/json")) {
              const data = await contentRes.json();
              if (data.content) {
                const includes = parseCppIncludes(data.content);
                loadedFiles.push({
                  name: p.split('/').pop() || p,
                  path: p,
                  content: data.content,
                  size: data.size || 0,
                  includes
                });

                // Level 3 Depth: Look for includes inside these headers
                includes.forEach(inc => {
                  const incName = inc.split('/').pop() || inc;
                  const found = currentTree.find(item => item.path.endsWith(incName) || item.path.endsWith(inc));
                  if (found && !loadedFiles.some(ff => ff.path === found.path)) {
                    tertiaryPathsToFetch.add(found.path);
                  }
                });
              }
            }
          } catch (e) {}
        }));
      }

      // 7. Level 3 Depth Fetch (up to 150 more files)
      const tertiaryPaths = Array.from(tertiaryPathsToFetch).slice(0, 150);
      for (let i = 0; i < tertiaryPaths.length; i += chunkSize) {
        const chunk = tertiaryPaths.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (p: string) => {
          if (loadedFiles.some(f => f.path === p)) return;
          try {
            const params = new URLSearchParams({
              owner: repo.owner.login,
              repo: repo.name,
              path: p
            });
            const contentRes = await fetch(`/api/repo/file/content?${params.toString()}`, { headers });
            const contentType = contentRes.headers.get("content-type");
            if (contentRes.ok && contentType && contentType.includes("application/json")) {
              const data = await contentRes.json();
              if (data.content) {
                const includes = parseCppIncludes(data.content);
                loadedFiles.push({
                  name: p.split('/').pop() || p,
                  path: p,
                  content: data.content,
                  size: data.size || 0,
                  includes
                });
              }
            }
          } catch (e) {}
        }));
      }

      if (loadedFiles.length === 0) {
        throw new Error("Failed to load content for any files.");
      }

      setFiles(loadedFiles);
      
      // Fetch some commit data for hotspots if authenticated
      if (token) {
        try {
          const commitsRes = await fetch(`/api/repo/commits?owner=${repo.owner.login}&repo=${repo.name}&per_page=30`, { headers });
          const contentType = commitsRes.headers.get("content-type");
          
          if (commitsRes.ok && contentType && contentType.includes("application/json")) {
            const commits = await commitsRes.json();
            const churnMap: Record<string, number> = {};
            
            // For each commit, fetch files changed (limit to first 10 for performance)
            const recentCommits = commits.slice(0, 10);
            await Promise.all(recentCommits.map(async (c: any) => {
              try {
                const detailRes = await fetch(`/api/repo/commit?owner=${repo.owner.login}&repo=${repo.name}&ref=${c.sha}`, { headers });
                const detailContentType = detailRes.headers.get("content-type");
                if (detailRes.ok && detailContentType && detailContentType.includes("application/json")) {
                  const detail = await detailRes.json();
                  detail.files?.forEach((f: any) => {
                    churnMap[f.filename] = (churnMap[f.filename] || 0) + 1;
                  });
                }
              } catch (err) {
                console.warn(`Failed to fetch commit detail for ${c.sha}`, err);
              }
            }));

            const filesWithChurn = loadedFiles.map(f => ({
              ...f,
              churn: churnMap[f.path] || 0
            }));
            setFiles(filesWithChurn);
            setGraphData(buildGraph(filesWithChurn));
            setLoadingRepo(false);
            return;
          } else {
            console.warn("Commits API returned non-JSON or error", commitsRes.status);
          }
        } catch (e) {
          console.error("Failed to fetch churn data", e);
        }
      }

      setGraphData(buildGraph(loadedFiles));
    } catch (e: any) {
      console.error("Failed to load repo", e);
      alert(`Error: ${e.message || "Failed to load repository"}`);
    } finally {
      setLoadingRepo(false);
    }
  };

  const handleNodeClick = (node: GraphNode | null) => {
    if (node && graphData) {
      setSelectedFile(graphData.files[node.id]);
    } else {
      setSelectedFile(null);
    }
  };

  const handleNodeHover = (node: GraphNode | null) => {
    if (node && graphData) {
      const file = graphData.files[node.id];
      setHoveredFile(file);
      // Automatically select on hover as requested
      setSelectedFile(file);
    } else {
      setHoveredFile(null);
    }
  };

  const handleSandboxMove = (oldPath: string, newPath: string) => {
    setSandboxMoves(prev => ({ ...prev, [oldPath]: newPath }));
    
    // Recalculate graph with "broken" links
    if (graphData) {
      const updatedFiles = files.map(f => {
        if (f.path === oldPath) return { ...f, path: newPath };
        return f;
      });
      
      const newGraph = buildGraph(updatedFiles);
      
      // Mark nodes as broken if they have includes that don't exist anymore
      newGraph.nodes = newGraph.nodes.map(n => {
        const file = updatedFiles.find(f => f.path === n.path);
        if (file) {
          const hasBroken = file.includes.some(inc => {
            const incName = inc.split('/').pop() || inc;
            return !updatedFiles.some(f => f.path.endsWith(incName));
          });
          return { ...n, isBroken: hasBroken };
        }
        return n;
      });

      setGraphData(newGraph);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0a0a0a]">
      <Header 
        user={user} 
        onLogout={handleLogout} 
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        showSidebarToggle={files.length > 0}
      />

      <main className="flex-1 relative overflow-y-auto custom-scrollbar">
        {!user ? (
          <div className="h-full flex flex-col items-center justify-center px-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-12"
            >
              <h2 className="text-4xl font-serif italic text-zinc-100 mb-4">Understand Complex Codebases.</h2>
              <p className="text-zinc-500 max-w-lg mx-auto">
                Connect your GitHub to generate a spatial dependency graph and AI-powered documentation for your C++ projects.
              </p>
            </motion.div>
            
            <GitHubConnect onConnected={checkUser} />

            <div className="mt-20 grid grid-cols-3 gap-8 max-w-4xl w-full">
              {[
                { icon: Network, title: "Spatial Mapping", desc: "Visualize file relationships through #include headers." },
                { icon: Cpu, title: "AI Analysis", desc: "Gemini 3.1 Pro summarizes file logic and responsibilities." },
                { icon: BookOpen, title: "Instant Docs", desc: "Hover and click to explore auto-generated documentation." }
              ].map((feature, i) => (
                <div key={i} className="p-6 bg-zinc-900/30 border border-zinc-800/50 rounded-xl">
                  <feature.icon className="w-6 h-6 text-emerald-500 mb-4" />
                  <h3 className="text-sm font-medium text-zinc-200 mb-2">{feature.title}</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : files.length === 0 ? (
          loadingRepo ? (
            <div className="h-full flex flex-col items-center justify-center gap-4">
              <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-200">Analyzing Repository...</p>
                <p className="text-xs text-zinc-500 font-mono mt-1">Fetching C++ files and parsing dependencies</p>
              </div>
            </div>
          ) : (
            <RepoSelector onRepoSelected={handleRepoSelected} />
          )
        ) : (
          <div className="h-full flex">
            {/* Sidebar */}
            <AnimatePresence initial={false}>
              {isSidebarOpen && (
                <motion.div 
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 256, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 150 }}
                  className="border-r border-zinc-800 bg-[#0a0a0a] flex flex-col overflow-hidden whitespace-nowrap"
                >
                  <div className="p-4 border-b border-zinc-800 flex-shrink-0">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Project Files</p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
                    {files.map(f => (
                      <button 
                        key={f.path}
                        onClick={() => setSelectedFile(f)}
                        onMouseEnter={() => setHoveredFile(f)}
                        onMouseLeave={() => setHoveredFile(null)}
                        className={cn(
                          "w-full text-left px-3 py-1.5 rounded text-[11px] font-mono transition-colors flex items-center gap-2",
                          selectedFile?.path === f.path ? "bg-emerald-500/10 text-emerald-400" : 
                          hoveredFile?.path === f.path ? "bg-zinc-900 text-zinc-200" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                        )}
                      >
                        <FileCode className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Graph Area */}
            <div className="flex-1 relative">
              {graphData && (
                <GraphView 
                  data={graphData} 
                  selectedFile={selectedFile}
                  hoveredFile={hoveredFile}
                  highlightMode={highlightMode}
                  viewMode={viewMode}
                  onNodeClick={handleNodeClick} 
                  onNodeHover={handleNodeHover}
                />
              )}
              
              <div className="absolute top-4 left-4 flex flex-col gap-2">
                <div className="p-3 bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[10px] font-mono text-zinc-300">{files.length} Files Analyzed</span>
                  </div>
                </div>

                <div className="flex bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-lg p-1">
                  <button 
                    onClick={() => setViewMode('spatial')}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded text-[10px] font-mono transition-colors",
                      viewMode === 'spatial' ? "bg-zinc-800 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    <Network className="w-3 h-3" />
                    Spatial
                  </button>
                  <button 
                    onClick={() => setViewMode('hotspots')}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded text-[10px] font-mono transition-colors",
                      viewMode === 'hotspots' ? "bg-zinc-800 text-red-400" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    <Flame className="w-3 h-3" />
                    Hotspots
                  </button>
                </div>

                <div className="flex bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-lg p-1">
                  <button 
                    onClick={() => setHighlightMode('all')}
                    className={cn(
                      "px-3 py-1.5 rounded text-[10px] font-mono transition-colors",
                      highlightMode === 'all' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    All
                  </button>
                  <button 
                    onClick={() => setHighlightMode('out')}
                    className={cn(
                      "flex items-center gap-1 px-3 py-1.5 rounded text-[10px] font-mono transition-colors",
                      highlightMode === 'out' ? "bg-zinc-800 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    <ArrowUpRight className="w-3 h-3" />
                    Out
                  </button>
                  <button 
                    onClick={() => setHighlightMode('in')}
                    className={cn(
                      "flex items-center gap-1 px-3 py-1.5 rounded text-[10px] font-mono transition-colors",
                      highlightMode === 'in' ? "bg-zinc-800 text-blue-400" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    <ArrowDownLeft className="w-3 h-3" />
                    In
                  </button>
                </div>
              </div>

              <button 
                onClick={() => { 
                  setFiles([]); 
                  setGraphData(null); 
                  setRepoTree([]); 
                  setCurrentRepoId(null);
                }}
                className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-[10px] font-mono text-zinc-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                Switch Repository
              </button>
            </div>
          </div>
        )}
      </main>

      <AnimatePresence mode="wait">
        {selectedFile && (
          <DocPanel 
            key={selectedFile.path}
            file={selectedFile} 
            dependents={files.filter(f => f.includes.some(inc => {
              const incName = inc.split('/').pop() || inc;
              return selectedFile.path.endsWith(incName);
            }))}
            onMove={(newPath) => handleSandboxMove(selectedFile.path, newPath)}
            onClose={() => setSelectedFile(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
