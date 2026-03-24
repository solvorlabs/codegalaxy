import { NextResponse } from "next/server"
import { jobStore } from "@/lib/spotifyCache"

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")

  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 })
  }

  const job = jobStore.get(jobId)
  if (!job) {
    return NextResponse.json({ error: "Job not found or expired" }, { status: 404 })
  }

  return NextResponse.json({
    status: job.status,        // "running" | "done" | "error"
    progress: job.progress,    // 0-100
    step: job.step,            // 0-5
    stepLabel: job.stepLabel,
    error: job.error || null,
    result: job.status === "done" ? job.result : null,
  })
}
