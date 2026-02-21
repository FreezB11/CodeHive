import * as d3 from 'd3';

export interface CodeFile {
  name: string;
  path: string;
  content: string;
  size: number;
  includes: string[];
  churn?: number;
  lastModified?: string;
}

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  path: string;
  group: string;
  size: number;
  churn?: number;
  lastModified?: string;
  isBroken?: boolean;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string;
  target: string;
}

export interface CodebaseData {
  nodes: GraphNode[];
  links: GraphLink[];
  files: Record<string, CodeFile>;
}

export function parseCppIncludes(content: string): string[] {
  // Robust regex for C/C++ includes:
  // - Handles spaces before #
  // - Handles spaces between # and include
  // - Handles both "" and <>
  const includeRegex = /^\s*#\s*include\s+["<]([^">]+)[">]/gm;
  const includes: string[] = [];
  let match;
  while ((match = includeRegex.exec(content)) !== null) {
    includes.push(match[1]);
  }
  return includes;
}

export function extractDoxygen(content: string): string {
  const comments: string[] = [];
  
  // 1. Match all /* ... */ and /** ... */ blocks
  const multiLineRegex = /\/\*([\s\S]*?)\*\//g;
  let multiMatch;
  while ((multiMatch = multiLineRegex.exec(content)) !== null) {
    const cleaned = multiMatch[1]
      .split('\n')
      .map(line => line.trim().replace(/^\*+/, '').trim())
      .filter(line => line.length > 0)
      .join('\n');
    if (cleaned) comments.push(cleaned);
  }

  // 2. Match all // and /// lines, grouping consecutive ones
  const lines = content.split('\n');
  let currentBlock: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) {
      // Handle /// and //
      const commentText = trimmed.replace(/^\/\/+/, '').trim();
      currentBlock.push(commentText);
    } else {
      if (currentBlock.length > 0) {
        comments.push(currentBlock.join('\n'));
        currentBlock = [];
      }
    }
  }
  if (currentBlock.length > 0) {
    comments.push(currentBlock.join('\n'));
  }

  // Return unique comments to avoid duplicates if regex and line-by-line overlap (though they shouldn't)
  return Array.from(new Set(comments)).join('\n\n');
}

export function buildGraph(files: CodeFile[]): CodebaseData {
  const nodes: GraphNode[] = files.map(f => ({
    id: f.path,
    name: f.name,
    path: f.path,
    group: f.path.split('/').slice(0, -1).join('/') || 'root',
    size: Math.sqrt(f.size) / 2 + 5,
    churn: f.churn,
    lastModified: f.lastModified
  }));

  const links: GraphLink[] = [];
  
  // Create a map of filename -> list of paths (to handle duplicate filenames in different folders)
  const filenameToPaths = new Map<string, string[]>();
  files.forEach(f => {
    const name = f.path.split('/').pop() || f.path;
    if (!filenameToPaths.has(name)) filenameToPaths.set(name, []);
    filenameToPaths.get(name)!.push(f.path);
  });

  files.forEach(file => {
    const currentDir = file.path.split('/').slice(0, -1).join('/');
    
    file.includes.forEach(include => {
      const includeName = include.split('/').pop() || include;
      let targetPath: string | undefined;

      // 1. Try relative path match (most accurate for "")
      const potentialPath = currentDir ? `${currentDir}/${include}` : include;
      // Normalize path (very basic)
      const normalized = potentialPath.replace(/\/.\//g, '/').replace(/[^\/]+\/\.\.\//g, '');
      targetPath = files.find(f => f.path === normalized || f.path === include || f.path.endsWith(include))?.path;

      // 2. Try filename match (standard for system/library headers or flat projects)
      if (!targetPath) {
        const candidates = filenameToPaths.get(includeName);
        if (candidates && candidates.length > 0) {
          targetPath = candidates[0];
        }
      }

      // 3. Fallback: fuzzy match (case insensitive)
      if (!targetPath) {
        targetPath = files.find(f => f.path.toLowerCase().endsWith(include.toLowerCase()))?.path;
      }

      if (targetPath && targetPath !== file.path) {
        links.push({
          source: file.path,
          target: targetPath
        });
      }
    });
  });

  return {
    nodes,
    links,
    files: Object.fromEntries(files.map(f => [f.path, f]))
  };
}
