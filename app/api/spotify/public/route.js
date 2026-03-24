import { NextResponse } from "next/server"
import { publicGalaxyStore } from "@/lib/spotifyCache"

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get("userId")

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  }

  const entry = publicGalaxyStore.get(userId)
  if (!entry || entry.expiresAt < Date.now()) {
    return NextResponse.json({ error: "Galaxy not found or expired" }, { status: 404 })
  }

  return NextResponse.json(entry.data)
}
