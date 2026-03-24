const IGNORED_RE = /^(node_modules|\.git|dist|build|\.next|coverage|out)\//
const JS_TS_RE = /\.(js|jsx|ts|tsx)$/
// Matches: import ... from '...' | import('...') | require('...')
const IMPORT_RE = /(?:import|require)\s*(?:[^'"(]*?\s+from\s+)?['"]([^'"]+)['"]/g

function resolveImport(fromFolder, importPath) {
  if (!importPath.startsWith(".")) return null
  const base = fromFolder ? `${fromFolder}/${importPath}` : importPath
  const parts = base.split("/")
  const resolved = []
  for (const part of parts) {
    if (part === "..") resolved.pop()
    else if (part !== ".") resolved.push(part)
  }
  return resolved.join("/")
}

export function buildGraph(tree, fileContents) {
  const files = tree.filter(
    (item) => item.type === "blob" && !IGNORED_RE.test(item.path)
  )

  const nodes = files.map((item) => {
    const parts = item.path.split("/")
    const label = parts[parts.length - 1]
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "."
    const sizeBytes = item.size || 0
    const lines = Math.max(1, Math.round(sizeBytes / 40))
    const size = Math.max(1, Math.min(10, Math.ceil(sizeBytes / 5000)))
    const imports = []

    if (JS_TS_RE.test(item.path) && fileContents[item.path]) {
      IMPORT_RE.lastIndex = 0
      let match
      while ((match = IMPORT_RE.exec(fileContents[item.path])) !== null) {
        imports.push(match[1])
      }
    }

    return { id: item.path, label, folder, size, lines, imports }
  })

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = []
  const seen = new Set()

  nodes.forEach((node) => {
    const fromFolder = node.folder === "." ? "" : node.folder
    node.imports.forEach((importPath) => {
      const base = resolveImport(fromFolder, importPath)
      if (!base) return
      const exts = [
        "",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        "/index.js",
        "/index.jsx",
        "/index.ts",
        "/index.tsx",
      ]
      for (const ext of exts) {
        const target = base + ext
        if (nodeIds.has(target)) {
          const key = `${node.id}|${target}`
          if (!seen.has(key)) {
            seen.add(key)
            edges.push({ source: node.id, target })
          }
          break
        }
      }
    })
  })

  return { nodes, edges }
}
