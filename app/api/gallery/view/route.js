import { NextResponse } from "next/server"
import { readGallery, writeGallery } from "@/lib/gallery"

export async function POST(request) {
  try {
    const { owner, repo } = await request.json()
    if (!owner || !repo) return NextResponse.json({ error: "owner and repo required" }, { status: 400 })

    const entries = readGallery()
    const idx = entries.findIndex(e => e.owner === owner && e.repo === repo)

    if (idx >= 0) {
      entries[idx].viewCount = (entries[idx].viewCount || 0) + 1
      writeGallery(entries)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
