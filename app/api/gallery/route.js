import { NextResponse } from "next/server"
import { readGallery } from "@/lib/gallery"

export const dynamic = "force-dynamic"

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sort = searchParams.get("sort") || "viewCount"
  const page = parseInt(searchParams.get("page") || "0", 10)
  const type = searchParams.get("type") || "all"  // all | github | spotify
  const PAGE_SIZE = 24

  const entries = readGallery()

  const filtered = type === "all"
    ? entries
    : type === "github"
      ? entries.filter(e => !e.type || e.type === "github")
      : entries.filter(e => e.type === type)

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "stars")   return (b.stars || 0) - (a.stars || 0)
    if (sort === "addedAt") return new Date(b.addedAt) - new Date(a.addedAt)
    return (b.viewCount || 0) - (a.viewCount || 0)
  })

  const slice = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  return NextResponse.json({ entries: slice, total: sorted.length, page, pageSize: PAGE_SIZE })
}

