import fs from "fs"
import path from "path"

const GALLERY_FILE = path.join(process.cwd(), "data", "gallery.json")

export function readGallery() {
  try {
    if (!fs.existsSync(GALLERY_FILE)) return []
    const raw = fs.readFileSync(GALLERY_FILE, "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeGallery(entries) {
  const dir = path.dirname(GALLERY_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(GALLERY_FILE, JSON.stringify(entries, null, 2), "utf-8")
}
