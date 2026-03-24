import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { NextResponse } from "next/server"

// ── In-memory cache (15 min TTL) ─────────────────────────────────────────────
const cache = new Map()
const TTL   = 15 * 60 * 1000

async function ghFetch(url, headers) {
  try {
    const res = await fetch(url, { headers })
    // Soft retry on rate-limit
    if (res.status === 429 || res.status === 403) {
      await new Promise(r => setTimeout(r, 800))
      const r2 = await fetch(url, { headers })
      return r2.ok ? r2 : null
    }
    return res.ok ? res : null
  } catch { return null }
}

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { owner, repo } = body
  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo required" }, { status: 400 })
  }

  const cacheKey = `${owner}/${repo}`
  const cached   = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data)
  }

  const headers = {
    Authorization: `token ${session.accessToken}`,
    Accept: "application/vnd.github.v3+json",
  }

  // ── 1. Fetch commit list (up to 200 commits, 2 pages × 100) ─────────────────
  let allCommits = []
  for (let page = 1; page <= 2; page++) {
    const res = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&page=${page}`,
      headers
    )
    if (!res) break
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) break
    allCommits = allCommits.concat(data)
    if (data.length < 100) break
  }

  if (allCommits.length === 0) {
    return NextResponse.json({ error: "No commits found or repository is empty" }, { status: 404 })
  }

  const totalCommits = allCommits.length
  // Reverse so index 0 = oldest commit
  allCommits.reverse()

  // ── 2. Sample to max 50 commits if needed ───────────────────────────────────
  const MAX_DETAIL = 50
  let sampled      = false
  let selected     = allCommits

  if (allCommits.length > MAX_DETAIL) {
    sampled  = true
    const step = (allCommits.length - 1) / (MAX_DETAIL - 1)
    selected = Array.from({ length: MAX_DETAIL }, (_, i) =>
      allCommits[Math.round(i * step)]
    )
  }

  // ── 3. Fetch commit details in batches of 10 ─────────────────────────────────
  const BATCH = 10
  const detailResults = []

  for (let i = 0; i < selected.length; i += BATCH) {
    const batch = selected.slice(i, i + BATCH)
    const batchResults = await Promise.allSettled(
      batch.map(async (c) => {
        const res = await ghFetch(
          `https://api.github.com/repos/${owner}/${repo}/commits/${c.sha}`,
          headers
        )
        if (!res) return { sha: c.sha, commit: c.commit, files: [] }
        const data = await res.json()
        return {
          sha:    c.sha,
          commit: c.commit,
          files:  Array.isArray(data.files) ? data.files : [],
        }
      })
    )
    detailResults.push(...batchResults)
  }

  // ── 4. Build timeline with cumulative file state ──────────────────────────────
  const currentFiles = new Set()
  const timeline     = []

  for (const result of detailResults) {
    if (result.status !== "fulfilled" || !result.value) continue
    const { sha, commit, files } = result.value

    const filesAdded    = []
    const filesModified = []
    const filesRemoved  = []

    for (const f of files) {
      const name = f.filename
      if (!name) continue
      if (f.status === "added" || f.status === "copied") {
        filesAdded.push(name)
        currentFiles.add(name)
      } else if (f.status === "removed") {
        filesRemoved.push(name)
        currentFiles.delete(name)
      } else if (f.status === "renamed") {
        if (f.previous_filename) {
          filesRemoved.push(f.previous_filename)
          currentFiles.delete(f.previous_filename)
        }
        filesAdded.push(name)
        currentFiles.add(name)
      } else {
        filesModified.push(name)
      }
    }

    const message = (commit?.message ?? "").split("\n")[0].slice(0, 100)
    const date    = commit?.author?.date ?? commit?.committer?.date ?? ""
    const author  = commit?.author?.name ?? commit?.committer?.name ?? "unknown"

    timeline.push({
      sha,
      message,
      date,
      author,
      filesAdded,
      filesModified,
      filesRemoved,
      totalFilesAtThisPoint: currentFiles.size,
    })
  }

  if (timeline.length === 0) {
    return NextResponse.json({ error: "Could not fetch commit details" }, { status: 500 })
  }

  const result = {
    commits:      timeline,
    totalCommits,
    sampled,
    firstCommit:  timeline[0]                    ?? null,
    latestCommit: timeline[timeline.length - 1]  ?? null,
  }

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + TTL })
  return NextResponse.json(result)
}
