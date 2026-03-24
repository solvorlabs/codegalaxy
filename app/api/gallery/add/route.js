import { NextResponse } from "next/server"
import { readGallery, writeGallery } from "@/lib/gallery"

export async function POST(request) {
  try {
    const { owner, repo, stars, description, language, type } = await request.json()
    if (!owner || !repo) return NextResponse.json({ error: "owner and repo required" }, { status: 400 })

    const entryType = type || "github"
    const entries = readGallery()
    const idx = entries.findIndex(e => e.owner === owner && e.repo === repo)

    if (idx >= 0) {
      // Update existing entry (refresh metadata but keep viewCount)
      entries[idx] = {
        ...entries[idx],
        stars: stars ?? entries[idx].stars,
        description: description ?? entries[idx].description,
        language: language ?? entries[idx].language,
        type: entryType,
        updatedAt: new Date().toISOString(),
      }
    } else {
      entries.push({
        owner, repo,
        stars: stars || 0,
        description: description || "",
        language: language || "",
        type: entryType,
        viewCount: 0,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }

    writeGallery(entries)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
