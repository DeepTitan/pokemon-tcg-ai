import { useState } from 'react';

const KEY_COLOR = '#94a3b8';
const STRING_COLOR = '#86efac';
const NUMBER_COLOR = '#fcd34d';
const BOOLEAN_COLOR = '#f472b6';
const NULL_COLOR = '#9ca3af';
const BRACE_COLOR = '#e2e8f0';

interface JsonTreeProps {
  data: unknown;
  name?: string;
  path: string;
  depth?: number;
  defaultExpandedDepth?: number;
  expandedPaths?: Set<string>;
  onTogglePath?: (path: string) => void;
}

function isExpandable(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/** Paths with depth < maxDepth (root = 0). */
export function getDefaultExpandedPaths(data: unknown, maxDepth: number): Set<string> {
  const out = new Set<string>();
  function collect(obj: unknown, path: string, depth: number) {
    if (depth > maxDepth) return;
    if (obj === null || typeof obj !== 'object') return;
    out.add(path);
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => collect(item, `${path}.${i}`, depth + 1));
    } else {
      Object.keys(obj as Record<string, unknown>).forEach((k) =>
        collect((obj as Record<string, unknown>)[k], path ? `${path}.${k}` : k, depth + 1)
      );
    }
  }
  collect(data, '', 0);
  return out;
}

/** Build a copy of data where collapsed nodes are replaced with summary strings. */
export function getVisibleRepresentation(data: unknown, expandedPaths: Set<string>, path = ''): unknown {
  if (data === null || typeof data !== 'object') return data;
  if (!expandedPaths.has(path)) {
    if (Array.isArray(data)) return `[Collapsed: ${data.length} items]`;
    return `[Collapsed: ${Object.keys(data as Record<string, unknown>).length} keys]`;
  }
  if (Array.isArray(data)) {
    return (data as unknown[]).map((item, i) =>
      getVisibleRepresentation(item, expandedPaths, path ? `${path}.${i}` : String(i))
    );
  }
  const obj = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const childPath = path ? `${path}.${k}` : k;
    result[k] = getVisibleRepresentation(obj[k], expandedPaths, childPath);
  }
  return result;
}

function JsonNode({
  data,
  name,
  path,
  depth = 0,
  defaultExpandedDepth = 1,
  expandedPaths,
  onTogglePath,
}: JsonTreeProps) {
  const isControlled = expandedPaths !== undefined && onTogglePath !== undefined;
  const defaultExpanded = depth < defaultExpandedDepth;
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expanded = isControlled ? expandedPaths!.has(path) : internalExpanded;
  const setExpanded = isControlled
    ? () => onTogglePath!(path)
    : () => setInternalExpanded((e) => !e);
  const isObj = isExpandable(data);
  const isArray = Array.isArray(data);

  if (!isObj) {
    const keyPart = name !== undefined ? <span style={{ color: KEY_COLOR }}>{name}: </span> : null;
    let valuePart: React.ReactNode;
    if (data === null) {
      valuePart = <span style={{ color: NULL_COLOR }}>null</span>;
    } else if (typeof data === 'string') {
      valuePart = <span style={{ color: STRING_COLOR }}>&quot;{data}&quot;</span>;
    } else if (typeof data === 'number') {
      valuePart = <span style={{ color: NUMBER_COLOR }}>{data}</span>;
    } else if (typeof data === 'boolean') {
      valuePart = <span style={{ color: BOOLEAN_COLOR }}>{String(data)}</span>;
    } else {
      valuePart = <span style={{ color: NULL_COLOR }}>{String(data)}</span>;
    }
    return (
      <div className="leading-tight" style={{ paddingLeft: depth * 12 }}>
        {keyPart}
        {valuePart}
      </div>
    );
  }

  const keys = isArray ? data.map((_, i) => i) : Object.keys(data);
  const summary = isArray ? `[${data.length}]` : `{${keys.length}}`;
  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';

  return (
    <div className="leading-tight" style={{ paddingLeft: depth * 12 }}>
      <button
        type="button"
        onClick={setExpanded}
        className="flex items-center gap-1 text-left w-full hover:bg-gray-800/50 rounded py-0.5 -my-0.5"
      >
        <span className="inline-block w-3 text-[10px] text-gray-500 select-none">
          {expanded ? '▼' : '▶'}
        </span>
        {name !== undefined && <span style={{ color: KEY_COLOR }}>{name}: </span>}
        <span style={{ color: BRACE_COLOR }}>{open}</span>
        {!expanded && <span style={{ color: KEY_COLOR }}> {summary} </span>}
        {!expanded && <span style={{ color: BRACE_COLOR }}>{close}</span>}
      </button>
      {expanded && (
        <div className="pl-0">
          {isArray
            ? (data as unknown[]).map((item, i) => (
                <JsonNode
                  key={i}
                  data={item}
                  name={String(i)}
                  path={path ? `${path}.${i}` : String(i)}
                  depth={depth + 1}
                  defaultExpandedDepth={defaultExpandedDepth}
                  expandedPaths={expandedPaths}
                  onTogglePath={onTogglePath}
                />
              ))
            : Object.entries(data as Record<string, unknown>).map(([k, v]) => (
                <JsonNode
                  key={k}
                  data={v}
                  name={k}
                  path={path ? `${path}.${k}` : k}
                  depth={depth + 1}
                  defaultExpandedDepth={defaultExpandedDepth}
                  expandedPaths={expandedPaths}
                  onTogglePath={onTogglePath}
                />
              ))}
          <div style={{ paddingLeft: (depth + 1) * 12 }}>
            <span style={{ color: BRACE_COLOR }}>{close}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export interface JsonTreeViewProps {
  data: unknown;
  defaultExpandedDepth?: number;
  className?: string;
  expandedPaths?: Set<string>;
  onTogglePath?: (path: string) => void;
}

/**
 * Renders JSON (or any object) as an expandable/collapsible tree.
 * When expandedPaths and onTogglePath are provided, expansion is controlled (for Copy visible).
 */
export function JsonTreeView({
  data,
  defaultExpandedDepth = 1,
  className = '',
  expandedPaths,
  onTogglePath,
}: JsonTreeViewProps) {
  return (
    <div className={`font-mono text-[11px] p-2 ${className}`}>
      {data == null ? (
        <span style={{ color: NULL_COLOR }}>null</span>
      ) : (
        <JsonNode
          data={data}
          path=""
          depth={0}
          defaultExpandedDepth={defaultExpandedDepth}
          expandedPaths={expandedPaths}
          onTogglePath={onTogglePath}
        />
      )}
    </div>
  );
}
