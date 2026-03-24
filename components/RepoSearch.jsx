"use client"
import { useState } from "react"

export default function RepoSearch({ onSearch }) {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")

  const handleSubmit = (e) => {
    e.preventDefault()
    const parts = value.trim().split("/")
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setError('Enter a valid "owner/repo" format')
      return
    }
    setError("")
    onSearch(parts[0], parts[1])
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 items-start">
      <div className="flex-1 max-w-md">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError("")
          }}
          placeholder="owner/repository  e.g. vercel/next.js"
          className="w-full bg-gray-950 border border-gray-700 focus:border-blue-600 outline-none text-white placeholder-gray-600 px-4 py-2 rounded font-mono text-sm"
        />
        {error && <p className="text-red-500 text-xs mt-1 font-mono">{error}</p>}
      </div>
      <button
        type="submit"
        className="bg-blue-700 hover:bg-blue-600 active:bg-blue-800 text-white px-5 py-2 rounded text-sm font-mono transition-colors"
      >
        Visualize →
      </button>
    </form>
  )
}
