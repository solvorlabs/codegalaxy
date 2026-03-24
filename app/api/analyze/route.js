import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { createOctokit, getRepoTree, getFileContent } from "@/lib/github"
import { buildGraph } from "@/lib/graphBuilder"

const IGNORED_RE = /^(node_modules|\.git|dist|build|\.next)\//
const JS_TS_RE   = /\.(js|jsx|ts|tsx)$/
const MAX_SIZE   = 100 * 1024    // 100 KB per file
const MAX_FILES  = 300           // cap for large repos
const CACHE_TTL  = 5 * 60 * 1000 // 5 minutes

// ── In-memory response cache ───────────────────────────────────────────────
const cache = new Map() // key "owner/repo" → { graph, ts }

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let owner, repo
  try {
    ;({ owner, repo } = await request.json())
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!owner || !repo) {
    return Response.json({ error: "Missing owner or repo" }, { status: 400 })
  }

  // ── Cache hit ─────────────────────────────────────────────────────────────
  const cacheKey = `${owner}/${repo}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return Response.json(cached.graph)
  }

  try {
    const octokit = createOctokit(session.accessToken)
    const tree    = await getRepoTree(octokit, owner, repo)

    // Candidate JS/TS files small enough to fetch
    let jsFiles = tree.filter(
      (item) =>
        item.type === "blob" &&
        !IGNORED_RE.test(item.path) &&
        JS_TS_RE.test(item.path) &&
        (item.size || 0) < MAX_SIZE
    )

    // Truncation: keep the 300 largest when repo is huge
    const totalFiles = jsFiles.length
    const truncated  = totalFiles > MAX_FILES
    if (truncated) {
      jsFiles = jsFiles
        .slice()
        .sort((a, b) => (b.size || 0) - (a.size || 0))
        .slice(0, MAX_FILES)
    }

    const fileContents = {}
    await Promise.allSettled(
      jsFiles.map(async (item) => {
        const content = await getFileContent(octokit, owner, repo, item.path)
        if (content) fileContents[item.path] = content
      })
    )

    const graph = {
      ...buildGraph(tree, fileContents),
      truncated,
      totalFiles,
    }

    cache.set(cacheKey, { graph, ts: Date.now() })
    return Response.json(graph)
  } catch (err) {
    console.error("[analyze]", err)
    // Octokit attaches a .status property to HTTP errors
    if (err.status === 403) return Response.json({ error: "RATE_LIMIT" }, { status: 429 })
    if (err.status === 404) return Response.json({ error: "NOT_FOUND" },   { status: 404 })
    return Response.json({ error: err.message }, { status: 500 })
  }
}
