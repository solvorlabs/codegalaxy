"use client"
import { useSession } from "next-auth/react"
import { useEffect, useState } from "react"
import { use } from "react"
import { useSearchParams } from "next/navigation"
import GalaxyCanvas from "@/components/GalaxyCanvas"

export default function EmbedPage({ params }) {
  const { owner, repo } = use(params)
  const { data: session, status } = useSession()
  const searchParams = useSearchParams()

  const [graph,   setGraph]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    if (status === "loading") return
    if (!session) { setLoading(false); return }
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, repo }),
    })
      .then(async r => {
        const data = await r.json()
        if (!r.ok || !data.nodes?.length) { setError(true); setLoading(false); return }
        setGraph(data); setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [session, status, owner, repo])

  // Loading spinner
  if (status === "loading" || loading) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-blue-950" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
        </div>
      </div>
    )
  }

  // Not authenticated — show placeholder with link
  if (!session || error) {
    return (
      <div className="w-screen h-screen bg-black flex flex-col items-center justify-center gap-4 font-mono"
           style={{ background: "radial-gradient(ellipse 80% 60% at 50% 50%, #030918 0%, #000 100%)" }}>
        {/* Decorative glow */}
        <div className="absolute w-32 h-32 rounded-full"
             style={{ background: "radial-gradient(circle, rgba(60,100,255,0.25) 0%, transparent 70%)", filter: "blur(16px)" }} />
        <div className="text-blue-400 text-2xl">🌌</div>
        <div className="text-white font-semibold text-sm">{owner}/{repo}</div>
        <div className="text-gray-600 text-xs text-center max-w-xs leading-relaxed px-4">
          {error ? "This repository could not be loaded." : "Sign in to explore this galaxy."}
        </div>
        <a
          href={`/galaxy/${owner}/${repo}`}
          target="_top"
          rel="noopener noreferrer"
          className="text-xs px-4 py-2 rounded-lg transition-colors mt-1"
          style={{ background: "rgba(30,60,160,0.4)", border: "1px solid rgba(60,120,255,0.4)", color: "#8bb8ff" }}
        >
          Open in Codebase Galaxy →
        </a>
        {/* Watermark */}
        <div className="absolute bottom-3 right-3 text-gray-800 text-xs font-mono">
          Codebase Galaxy
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      <GalaxyCanvas
        nodes={graph.nodes}
        edges={graph.edges}
        owner={owner}
        repo={repo}
        hideUI={true}
        showMinimap={false}
      />

      {/* Repo label overlay */}
      <div className="absolute top-3 left-3 pointer-events-none"
           style={{ fontFamily: "monospace" }}>
        <div className="text-blue-300 text-xs font-bold backdrop-blur-sm px-2 py-1 rounded"
             style={{ background: "rgba(2,8,20,0.7)", border: "1px solid rgba(40,80,200,0.3)" }}>
          {owner}/{repo}
        </div>
      </div>

      {/* "Open full view" link */}
      <a
        href={`/galaxy/${owner}/${repo}`}
        target="_top"
        rel="noopener noreferrer"
        className="absolute top-3 right-3 text-xs backdrop-blur-sm px-2 py-1 rounded transition-colors"
        style={{ background: "rgba(2,8,20,0.7)", border: "1px solid rgba(40,80,200,0.3)", color: "#8bb8ff", fontFamily: "monospace" }}
      >
        ↗ full view
      </a>

      {/* Watermark */}
      <div className="absolute bottom-3 right-3 text-gray-700 text-xs pointer-events-none"
           style={{ fontFamily: "monospace" }}>
        Codebase Galaxy
      </div>
    </div>
  )
}
