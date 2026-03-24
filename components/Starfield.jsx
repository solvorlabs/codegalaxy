"use client"
import { useEffect, useRef } from "react"
import * as THREE from "three"

/**
 * Lightweight full-screen Three.js starfield.
 * No interaction — purely decorative background.
 */
export default function Starfield() {
  const mountRef = useRef(null)

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    const W = window.innerWidth
    const H = window.innerHeight

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x000005)

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 2000)
    camera.position.z = 1

    const renderer = new THREE.WebGLRenderer({ antialias: false })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    // 8 000 random stars
    const pos = new Float32Array(8000 * 3)
    for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * 2000
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    scene.add(
      new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true })
      )
    )

    let rafId
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener("resize", onResize)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener("resize", onResize)
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  return <div ref={mountRef} className="absolute inset-0 pointer-events-none" />
}
