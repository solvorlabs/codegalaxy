"use client"
import { useEffect, useRef, useState, useMemo, forwardRef, useImperativeHandle } from "react"
import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass }     from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { ShaderPass }     from "three/examples/jsm/postprocessing/ShaderPass.js"

// ── File-type helpers ─────────────────────────────────────────────────────────
const EXT_HUE = { js: 10, jsx: 10, ts: -10, tsx: -10, css: 30, scss: 30, sass: 30 }
const TEST_RE  = /\.(test|spec)\./
function fileHueShift(id) {
  if (TEST_RE.test(id)) return 40
  const ext = id.split(".").pop().toLowerCase()
  return EXT_HUE[ext] ?? 0
}
function isDataFile(id) {
  return ["json", "md", "mdx", "txt"].includes(id.split(".").pop().toLowerCase())
}
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// ── Post-processing shaders ───────────────────────────────────────────────────
const VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`
const ChromaticAberrationShader = {
  uniforms: { tDiffuse: { value: null }, aberration: { value: 0.0008 } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float aberration; varying vec2 vUv;
    void main(){
      vec2 dir=normalize(vUv-vec2(0.5)); float dist=length(vUv-vec2(0.5));
      vec2 offs=dir*aberration*dist*20.0;
      float r=texture2D(tDiffuse,vUv+offs).r;
      float g=texture2D(tDiffuse,vUv).g;
      float b=texture2D(tDiffuse,vUv-offs).b;
      gl_FragColor=vec4(r,g,b,1.0);
    }`,
}
const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, darkness: { value: 0.45 } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float darkness; varying vec2 vUv;
    void main(){
      vec4 c=texture2D(tDiffuse,vUv);
      float d=length(vUv-vec2(0.5))*1.9;
      float v=1.0-clamp(d*darkness,0.0,1.0);
      gl_FragColor=vec4(c.rgb*v,c.a);
    }`,
}
const HueSaturationShader = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 0.35 } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float saturation; varying vec2 vUv;
    void main(){
      vec4 c=texture2D(tDiffuse,vUv);
      float gray=dot(c.rgb,vec3(0.299,0.587,0.114));
      gl_FragColor=vec4(mix(vec3(gray),c.rgb,1.0+saturation),c.a);
    }`,
}

// ── Texture generators ────────────────────────────────────────────────────────
function makeNebulaTexture(r, g, b) {
  const sz = 256, cvs = document.createElement("canvas")
  cvs.width = cvs.height = sz
  const ctx = cvs.getContext("2d")
  const grad = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2)
  grad.addColorStop(0,    `rgba(${r},${g},${b},0.20)`)
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.07)`)
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad; ctx.fillRect(0, 0, sz, sz)
  return new THREE.CanvasTexture(cvs)
}
function makeAccretionTexture() {
  const sz = 256, cvs = document.createElement("canvas")
  cvs.width = cvs.height = sz
  const ctx = cvs.getContext("2d")
  const grad = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2)
  grad.addColorStop(0,    "rgba(255,255,255,0.95)")
  grad.addColorStop(0.25, "rgba(255,200,80,0.85)")
  grad.addColorStop(0.55, "rgba(255,80,10,0.65)")
  grad.addColorStop(0.8,  "rgba(120,10,0,0.30)")
  grad.addColorStop(1,    "rgba(0,0,0,0)")
  ctx.fillStyle = grad; ctx.fillRect(0, 0, sz, sz)
  return new THREE.CanvasTexture(cvs)
}

// ── Web Audio helpers ─────────────────────────────────────────────────────────
function createAudioSystem() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination)

    // Drone: 40 Hz
    const drone = ctx.createOscillator()
    const droneGain = ctx.createGain(); droneGain.gain.value = 0.02
    drone.frequency.value = 40; drone.type = "sine"
    drone.connect(droneGain); droneGain.connect(master); drone.start()

    // Shimmer: 528 Hz with LFO on gain
    const shimmer = ctx.createOscillator()
    const shimGain = ctx.createGain(); shimGain.gain.value = 0.005
    shimmer.frequency.value = 528; shimmer.type = "sine"
    const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain()
    lfo.frequency.value = 0.1; lfoGain.gain.value = 0.003
    lfo.connect(lfoGain); lfoGain.connect(shimGain.gain)
    lfo.start(); shimmer.connect(shimGain); shimGain.connect(master); shimmer.start()

    return { ctx, master, drone, shimmer, lfo }
  } catch { return null }
}
function playChime(audioSys) {
  if (!audioSys?.ctx || audioSys.ctx.state === "suspended") return
  try {
    const { ctx } = audioSys
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.frequency.value = 880; osc.type = "sine"
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.connect(gain); gain.connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + 0.32)
  } catch {}
}

// ── Easter egg: multi-note chime sequence ─────────────────────────────────────
function playKonami(audioSys) {
  if (!audioSys?.ctx) return
  const { ctx } = audioSys
  const freqs = [523, 659, 784, 1047, 784, 1047]
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator(); const g = ctx.createGain()
    osc.frequency.value = f; osc.type = "sine"
    g.gain.setValueAtTime(0, ctx.currentTime + i * 0.12)
    g.gain.linearRampToValueAtTime(0.1, ctx.currentTime + i * 0.12 + 0.05)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.25)
    osc.connect(g); g.connect(ctx.destination)
    osc.start(ctx.currentTime + i * 0.12)
    osc.stop(ctx.currentTime + i * 0.12 + 0.28)
  })
}

// ── Complexity badge helper ────────────────────────────────────────────────────
function complexityBadge(lines) {
  if (!lines && lines !== 0) return null
  if (lines < 100) return { label: "Simple",    color: "#4ade80",  bg: "rgba(74,222,128,0.13)" }
  if (lines < 300) return { label: "Moderate",  color: "#facc15",  bg: "rgba(250,204,21,0.13)" }
  if (lines < 700) return { label: "Complex",   color: "#fb923c",  bg: "rgba(249,115,22,0.13)" }
  return                   { label: "God File",  color: "#f87171",  bg: "rgba(239,68,68,0.13)"  }
}

// ── Component ─────────────────────────────────────────────────────────────────
const GalaxyCanvas = forwardRef(function GalaxyCanvas(
  { nodes, edges, owner, repo,
    hoveredFolder = null, pinnedFolders = [], fileTypeFilter = null, hideUI = false,
    healthMode = false, activityData = null, searchQuery = "", onSearchResults = null,
    showMinimap = true, onEasterEggToast = null,
    timeMachineVisible = null,
    timeMachineSpawn   = null,
    timeMachineModify  = null,
    timeMachineRemove  = null,
    timeMachineAuthorColors = null,
    musicMode = false,
    musicMeta  = null,
    playlistPositions  = null,  // { nodeId: {x,y,z} } — playlist arm positions, null = genre mode
    crossPlaylistLinks = null,  // [{sourceId, targetId}] — gold lines between cross-playlist tracks
  },
  ref
) {
  const mountRef    = useRef(null)
  const minimapRef  = useRef(null)

  // Three.js scene refs (set in main effect)
  const rendererRef       = useRef(null)
  const composerRef       = useRef(null)
  const sceneRef          = useRef(null)
  const cameraRef         = useRef(null)
  const galaxyGroupRef    = useRef(null)
  const coreMeshRef       = useRef(null)
  const coreLightRef      = useRef(null)
  const diskRef           = useRef(null)
  const planetMeshesRef   = useRef([])
  const planetByIdRef     = useRef({})
  const edgeObjectsRef    = useRef([])
  const coreNodeIdRef     = useRef(null)
  const resetFocusRef     = useRef(null)
  const focusNodeRef      = useRef(null)

  // Position / color data for constellation lines
  const positionsRef      = useRef({})
  const constellDataRef   = useRef({}) // folder -> sorted [Vector3]
  const constellGroupRef  = useRef(null)

  // Curve data for synaptic pulses
  const pulseDataRef      = useRef([]) // [{ curve, orb, t, speed, delay, color }]

  // Jet particle arrays
  const jetRef            = useRef(null)

  // Camera / interaction state
  const sphRef            = useRef({ theta: 0, phi: 1.1, r: 280 })
  const skipIntroRef      = useRef(false)
  const isIdleDriftRef    = useRef(true)

  // Zoom-to-node state
  const zoomStateRef      = useRef({
    animating: false, zoomedIn: false,
    progress: 0, fromPos: null, toPos: null, lookTarget: null,
    zoomedNodeMesh: null,
  })

  // Audio
  const audioSysRef  = useRef(null)
  const soundOnRef   = useRef(false)

  // Galaxy feature refs
  const armCentroidsRef  = useRef([])     // [Vector3] centroid per arm
  const healthScoresRef  = useRef({})     // nodeId -> 0-100
  const pausedRef        = useRef(false)  // rotation pause toggle
  const reapplyModeRef   = useRef(null)   // fn() to reapply current color mode after focus reset

  // ── Atmosphere + easter egg refs ─────────────────────────────────────────
  const nebulaMeshesRef    = useRef([])
  const nebulaVelsRef      = useRef([])
  const twinkleStarsGeoRef = useRef(null)
  const twinkleDataRef     = useRef([])
  const shootingStarRef    = useRef(null)
  const shootingTimerRef   = useRef(4 + Math.random() * 4)
  const rotationMultRef    = useRef(1)
  const recordingModeRef   = useRef(false)
  const rainbowModeRef     = useRef({ active: false, endTime: 0 })
  const konamiSeqRef       = useRef([])
  const coreClickCountRef  = useRef(0)
  const architectModeRef   = useRef(false)
  const reducedMotionRef   = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )

  // ── Time Machine animation refs ───────────────────────────────────────────
  const tmSpawnAnimsRef    = useRef({})   // { nodeId: { progress, origPos } }
  const tmImplodeAnimsRef  = useRef({})   // { nodeId: { progress } }
  const tmPulseAnimsRef    = useRef({})   // { nodeId: { progress } }
  const tmFlashMeshesRef   = useRef([])   // [{ mesh, progress }]
  const tmRingMeshesRef    = useRef([])   // [{ mesh, progress }]

  // ── Mood Journey refs (musicMode only) ────────────────────────────────────
  const moodTargetRef = useRef(null)   // { energy, valence } when active
  const moodActiveRef = useRef(false)
  const bloomPassRef  = useRef(null)

  // ── Playlist mode refs (musicMode only) ───────────────────────────────────
  const playlistPositionsRef  = useRef(null)   // { nodeId: THREE.Vector3 } computed from prop
  const playlistModeActiveRef = useRef(false)  // mirror of (playlistPositions !== null)
  const crossLinksGroupRef    = useRef(null)   // THREE.Group for gold cross-playlist lines
  const tmVisibilityRef       = useRef(null)   // null = show all; Set<string> = visible nodeIds

  // Component state
  const [tooltip,        setTooltip]       = useState(null)
  const [sidebar,        setSidebar]       = useState(null)
  const [showSkipBtn,    setShowSkipBtn]   = useState(true)
  const [isZoomed,       setIsZoomed]      = useState(false)
  const [soundOn,        setSoundOn]       = useState(false)
  const [lodNotice,      setLodNotice]     = useState(null)
  const [copiedPath,     setCopiedPath]    = useState(false)
  const [architectActive,setArchitectActive] = useState(false)
  const miniGraphRef = useRef(null)

  // Similar files to the currently selected node (for sidebar)
  const similarFiles = useMemo(() => {
    if (!sidebar || !nodes) return []
    const { id, folder, lines = 0, imports = [] } = sidebar
    const impSet = new Set(imports)
    return nodes
      .filter(n => n.id !== id && (
        n.folder === folder ||
        Math.abs((n.lines || 0) - lines) / Math.max(lines, 1) < 0.2 ||
        (n.imports || []).some(i => impSet.has(i))
      ))
      .slice(0, 3)
  }, [sidebar, nodes])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    captureScreenshot: () => {
      if (!rendererRef.current || !composerRef.current) return null
      composerRef.current.render()
      return rendererRef.current.domElement.toDataURL("image/png")
    },
    flyToDefault: () => {
      const cam = cameraRef.current; if (!cam) return
      zoomStateRef.current = {
        animating: true, zoomedIn: false, progress: 0, lockAfterAnim: false,
        fromPos: cam.position.clone(),
        toPos: new THREE.Vector3(0, 120, 280),
        lookTarget: new THREE.Vector3(0, 0, 0),
        zoomedNodeMesh: null,
      }
      sphRef.current = { theta: 0, phi: 1.1, r: 280 }
      setIsZoomed(false)
    },
    toggleRotation: () => {
      pausedRef.current = !pausedRef.current
    },
    startRecording: (durationSeconds = 8, quality = "720p") => {
      const renderer = rendererRef.current
      if (!renderer) return
      try {
        if (quality === "1080p") renderer.setPixelRatio(Math.max(renderer.getPixelRatio(), 2))
        const stream = renderer.domElement.captureStream(30)
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm"
        const mediaRecorder = new MediaRecorder(stream, { mimeType })
        const chunks = []
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
        mediaRecorder.onstop = () => {
          if (quality === "1080p") renderer.setPixelRatio(window.devicePixelRatio)
          const blob = new Blob(chunks, { type: "video/webm" })
          const url = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = url
          a.download = "my-music-galaxy.webm"
          document.body.appendChild(a); a.click(); document.body.removeChild(a)
          URL.revokeObjectURL(url)
          recordingModeRef.current = false
        }
        recordingModeRef.current = true
        mediaRecorder.start()
        setTimeout(() => { mediaRecorder.stop() }, durationSeconds * 1000)
      } catch (err) {
        console.error("[startRecording]", err)
        recordingModeRef.current = false
      }
    },
    flyToArm: (n) => {
      const centroids = armCentroidsRef.current
      const cam = cameraRef.current
      if (!centroids.length || !cam) return
      const idx = Math.max(0, Math.min(n - 1, centroids.length - 1))
      const centroid = centroids[idx]
      if (!centroid) return
      const camDist = centroid.length() + 90
      const toPos = centroid.clone().normalize().multiplyScalar(camDist)
      toPos.y += 25
      zoomStateRef.current = {
        animating: true, zoomedIn: false, progress: 0, lockAfterAnim: false,
        fromPos: cam.position.clone(),
        toPos,
        lookTarget: new THREE.Vector3(0, 0, 0),
        zoomedNodeMesh: null,
      }
      const r2 = Math.sqrt(toPos.x * toPos.x + toPos.z * toPos.z)
      Object.assign(sphRef.current, {
        r: toPos.length(),
        theta: Math.atan2(toPos.x, toPos.z),
        phi: Math.atan2(r2, toPos.y),
      })
      setIsZoomed(false)
    },
    // ── Mood Journey controls ─────────────────────────────────────────────
    setMoodTarget: (energy, valence) => {
      moodTargetRef.current = { energy, valence }
    },
    setMoodActive: (active) => {
      moodActiveRef.current = active
      if (!active) {
        // Reset all nodes back to base visual state
        planetMeshesRef.current.forEach(mesh => {
          mesh.material.opacity           = mesh.userData._baseOpacity  ?? 1.0
          mesh.material.emissiveIntensity = mesh.userData._baseEmissive ?? 0.6
          mesh.scale.setScalar(1.0)
          if (mesh.userData._origPos) mesh.position.y = mesh.userData._origPos.y
        })
      }
    },
    // ── Playlist mode controls ────────────────────────────────────────────
    setPlaylistPositions: (posMap) => {
      if (posMap && typeof posMap === "object") {
        const v3Map = {}
        Object.entries(posMap).forEach(([id, p]) => {
          v3Map[id] = new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0)
        })
        playlistPositionsRef.current  = v3Map
        playlistModeActiveRef.current = true
      } else {
        playlistPositionsRef.current  = null
        playlistModeActiveRef.current = false
      }
    },
    // Set which node IDs are visible in Time Machine playback (null = show all)
    setTmVisibleIds: (ids) => {
      tmVisibilityRef.current = ids  // null or Set<string>
    },
  }))

  // Auto-hide skip button
  useEffect(() => {
    const t = setTimeout(() => setShowSkipBtn(false), 4000)
    return () => clearTimeout(t)
  }, [])

  // ── Main Three.js effect ───────────────────────────────────────────────────
  useEffect(() => {
    if (!nodes?.length || !mountRef.current) return
    const container = mountRef.current
    nebulaMeshesRef.current = []
    nebulaVelsRef.current   = []
    // Skip cinematic intro for users who prefer reduced motion
    if (reducedMotionRef.current) skipIntroRef.current = true

    // LOD tier
    const nc = nodes.length
    const LOD       = nc > 400 ? "low" : nc > 150 ? "mid" : "high"
    const SEG       = LOD === "low" ? 6 : LOD === "mid" ? 10 : 14
    const NEBULA_N  = LOD === "low" ? 20 : LOD === "mid" ? 40 : 80
    const CORONA    = LOD !== "low"
    const SPIKES    = LOD === "high"
    const PLIMIT    = LOD === "low" ? 0 : LOD === "mid" ? 20 : 40
    if (LOD !== "high") setLodNotice(LOD === "low"
      ? "Performance mode active (large repo)"
      : "Reduced quality mode (medium repo)")

    // ── Scene / Renderer ────────────────────────────────────────────────────
    const W = container.clientWidth  || window.innerWidth
    const H = container.clientHeight || window.innerHeight

    const scene    = new THREE.Scene()
    scene.background = new THREE.Color(0x00010a)
    const camera   = new THREE.PerspectiveCamera(55, W / H, 0.1, 4000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    container.appendChild(renderer.domElement)

    rendererRef.current  = renderer
    sceneRef.current     = scene
    cameraRef.current    = camera

    // ── Post-processing ──────────────────────────────────────────────────────
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(W, H), 1.8, 0.4, 0.25)
    composer.addPass(bloomPass)
    bloomPassRef.current = bloomPass
    composer.addPass(new ShaderPass(ChromaticAberrationShader))
    composer.addPass(new ShaderPass(HueSaturationShader))
    const vigPass = new ShaderPass(VignetteShader); vigPass.renderToScreen = true
    composer.addPass(vigPass)
    composerRef.current = composer

    // ── Stars ───────────────────────────────────────────────────────────────
    ;[
      { count: 10000, size: 0.22, color: 0xffffff, opacity: 0.55 },
      { count:  4000, size: 0.50, color: 0xccddff, opacity: 0.75 },
      { count:  1000, size: 0.95, color: 0xaaddff, opacity: 0.85 },
    ].forEach(({ count, size, color, opacity }) => {
      const pos = new Float32Array(count * 3)
      for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * 3200
      const geo = new THREE.BufferGeometry()
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
      scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity })))
    })
    const bPos = new Float32Array(200 * 3)
    const bCol = new Float32Array(200 * 3)
    const twinkleData = []
    for (let i = 0; i < 200; i++) {
      bPos[i*3]   = (Math.random() - 0.5) * 700
      bPos[i*3+1] = (Math.random() - 0.5) * 700
      bPos[i*3+2] = (Math.random() - 0.5) * 700
      bCol[i*3] = bCol[i*3+1] = bCol[i*3+2] = 1.0
      twinkleData.push({ freq: 0.3 + Math.random() * 0.9, phase: Math.random() * Math.PI * 2 })
    }
    const bGeo = new THREE.BufferGeometry()
    bGeo.setAttribute("position", new THREE.BufferAttribute(bPos, 3))
    bGeo.setAttribute("color",    new THREE.BufferAttribute(bCol, 3))
    twinkleStarsGeoRef.current = bGeo
    twinkleDataRef.current     = twinkleData
    scene.add(new THREE.Points(bGeo, new THREE.PointsMaterial({ vertexColors: true, size: 2.0, sizeAttenuation: true })))

    // ── Galaxy group ──────────────────────────────────────────────────────────
    const galaxyGroup = new THREE.Group()
    scene.add(galaxyGroup)
    galaxyGroupRef.current = galaxyGroup

    // ── Lighting ─────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x0a1535, musicMode ? 1.5 : 3.0))
    if (musicMode) scene.add(new THREE.AmbientLight(0x223355, 1.5)) // floor brightness for dim tier-3/4 nodes
    const coreLight = new THREE.PointLight(0x4488ff, 3.25, 350)
    coreLight.position.set(0, 0, 0)
    galaxyGroup.add(coreLight)
    coreLightRef.current = coreLight

    // ── Graph layout ─────────────────────────────────────────────────────────
    const inDeg = {}
    edges.forEach(({ target }) => { inDeg[target] = (inDeg[target] || 0) + 1 })
    const sortedByDeg = [...nodes].sort((a, b) => (inDeg[b.id] || 0) - (inDeg[a.id] || 0))
    const coreNode    = musicMode ? (nodes.find(n => n.isCore) || sortedByDeg[0]) : sortedByDeg[0]
    const nearCoreSet = new Set(sortedByDeg.slice(1, 6).map(n => n.id))
    coreNodeIdRef.current = coreNode.id

    const topFolderOf = n => n.folder.split("/")[0] || n.folder
    const topFolders  = [...new Set(nodes.map(topFolderOf))]
    const totalArms   = Math.max(2, Math.min(6, topFolders.length))
    const folderArm   = {}
    topFolders.forEach((f, i) => { folderArm[f] = i % totalArms })

    const arms = Array.from({ length: totalArms }, () => [])
    nodes.forEach(n => {
      if (n.id === coreNode.id || nearCoreSet.has(n.id)) return
      arms[folderArm[topFolderOf(n)] ?? 0].push(n)
    })

    const positions = {}
    positions[coreNode.id] = new THREE.Vector3(0, 0, 0)
    const nearCoreArr = [...nearCoreSet]
    nearCoreArr.forEach((id, i) => {
      const a = (i / nearCoreArr.length) * Math.PI * 2
      const r = 9 + Math.random() * 6
      positions[id] = new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 4, Math.sin(a) * r)
    })
    arms.forEach((armNodes, armIdx) => {
      const armOffset = (armIdx / totalArms) * Math.PI * 2
      armNodes.forEach((node, ni) => {
        const t = armNodes.length > 1 ? ni / (armNodes.length - 1) : 0
        const r = 14 + t * 120; const θ = t * Math.PI * 2.5 + armOffset
        positions[node.id] = new THREE.Vector3(
          r * Math.cos(θ) + (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * r * 0.15 + (Math.random() - 0.5) * 3,
          r * Math.sin(θ) + (Math.random() - 0.5) * 8
        )
      })
    })
    positionsRef.current = positions

    // musicMode: override with pre-computed positions from musicGraphBuilder (x,y,z on each node)
    // This ensures the tier-based spiral layout from the builder is used, not GalaxyCanvas's layout
    if (musicMode) {
      nodes.forEach(n => {
        positions[n.id] = new THREE.Vector3(n.x || 0, n.y || 0, n.z || 0)
      })
    }

    // Compute arm centroids for keyboard shortcuts / flyToArm
    armCentroidsRef.current = arms.map(armNodes => {
      if (!armNodes.length) return new THREE.Vector3(0, 0, 0)
      const c = new THREE.Vector3()
      armNodes.forEach(n => { if (positions[n.id]) c.add(positions[n.id]) })
      return c.divideScalar(armNodes.length)
    })

    // ── Nebula ────────────────────────────────────────────────────────────────
    const nebColors = [[30,50,120],[20,80,150],[60,20,100],[10,40,80],[80,40,160],[20,60,140],[100,30,80],[40,80,120]]
    for (let i = 0; i < NEBULA_N; i++) {
      const [r, g, b] = nebColors[i % nebColors.length]
      const arm = i % totalArms, armOff = (arm / totalArms) * Math.PI * 2
      const t = Math.random(), nr = 14 + t * 110, nθ = t * Math.PI * 2.5 + armOff + (Math.random() - 0.5) * 0.5
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(55 + Math.random() * 30, 55 + Math.random() * 30),
        new THREE.MeshBasicMaterial({ map: makeNebulaTexture(r, g, b), transparent: true,
          opacity: 0.04 + Math.random() * 0.05, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending })
      )
      plane.position.set(nr*Math.cos(nθ)+(Math.random()-0.5)*22, (Math.random()-0.5)*12, nr*Math.sin(nθ)+(Math.random()-0.5)*22)
      plane.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI)
      galaxyGroup.add(plane)
      nebulaMeshesRef.current.push(plane)
      nebulaVelsRef.current.push({ vx: (Math.random()-0.5)*0.004, vz: (Math.random()-0.5)*0.004 })
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r = 30 + Math.random() * 65
      const lane = new THREE.Mesh(
        new THREE.PlaneGeometry(85 + Math.random()*40, 12 + Math.random()*8),
        new THREE.MeshBasicMaterial({ color: 0x000008, transparent: true, opacity: 0.28+Math.random()*0.14, depthWrite: false, side: THREE.DoubleSide })
      )
      lane.position.set(Math.cos(a)*r, (Math.random()-0.5)*4, Math.sin(a)*r)
      lane.rotation.y = a + Math.PI/2; lane.rotation.z = (Math.random()-0.5)*0.3
      galaxyGroup.add(lane)
    }

    // ── Planets ───────────────────────────────────────────────────────────────
    const planetMeshes = [], planetById = {}
    const folders = [...new Set(nodes.map(n => n.folder))]

    nodes.forEach(node => {
      const pos = positions[node.id]; if (!pos) return
      const folderIdx = folders.indexOf(node.folder)
      const baseHue   = folders.length > 1 ? folderIdx / folders.length : 0.6
      const shift = fileHueShift(node.id)
      const finalHue  = ((baseHue * 360 + shift) / 360 + 1) % 1
      const data      = isDataFile(node.id)
      const deg       = inDeg[node.id] || 0
      const isCore    = node.id === coreNode.id

      // musicMode: use pre-computed values from node; GitHub mode: derive from graph topology
      const color = musicMode
        ? new THREE.Color(node.color || '#4488ff')
        : new THREE.Color().setHSL(finalHue, 0.85, 0.58)
      const rSize = musicMode
        ? Math.max(0.5, node.radius || Math.max(0.5, (node.size || 1) * 0.5))
        : (isCore ? 4.5 : Math.max(0.38, Math.min(2.8, node.size * (data ? 0.14 : 0.24))))
      const TIER_EMISSIVE = { 1: 0.9, 2: 0.65, 3: 0.5, 4: 0.35, 5: 0.22 }
      const baseEmissive = musicMode
        ? (TIER_EMISSIVE[node.tier || 1] ?? 0.5)
        : (isCore ? 1.1 : 0.6 + deg * 0.08)
      const nodeOpacity     = musicMode ? (node.opacity ?? 1.0) : (data ? 0.65 : 1.0)
      const nodeTransparent = musicMode ? true : data

      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: Math.min(baseEmissive, 1.5),
        roughness: 0.3, metalness: musicMode ? 0.2 : 0.4,
        transparent: nodeTransparent, opacity: nodeOpacity,
      })
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(rSize, SEG, SEG), mat)
      mesh.position.copy(pos)
      mesh.userData = {
        ...node,
        _color:        `#${color.getHexString()}`,
        _isData:       data,
        _inDeg:        deg,
        _rSize:        rSize,
        _baseEmissive: baseEmissive,
        _baseOpacity:  nodeOpacity,
        _origPos:      pos.clone(),
      }
      galaxyGroup.add(mesh); planetMeshes.push(mesh); planetById[node.id] = mesh

      if (isCore) coreMeshRef.current = mesh

      if (CORONA) {
        mesh.add(new THREE.Mesh(
          new THREE.SphereGeometry(rSize * (isCore ? 2.6 : 1.9), Math.max(4, SEG-4), Math.max(4, SEG-4)),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isCore ? 0.18 : 0.09,
            side: THREE.BackSide, depthWrite: false })
        ))
      }
      if (SPIKES && (isCore || node.size >= 4)) {
        const len = isCore ? 16 : rSize * 4
        const spikeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true,
          opacity: isCore ? 0.55 : 0.32, depthWrite: false })
        mesh.add(new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), spikeMat))
        mesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.06), spikeMat))
      }
    })
    planetMeshesRef.current = planetMeshes
    planetByIdRef.current   = planetById

    // Compute health scores per node
    const hScores = {}
    nodes.forEach(node => {
      let score = 50
      const lines = node.lines || 0
      if (lines > 1000) score -= 40
      else if (lines > 500) score -= 20
      if (!node.imports || node.imports.length === 0) score -= 15
      if (/\.(test|spec)\./i.test(node.id)) score += 25
      if (/\bindex\./i.test(node.label)) score += 10
      if (/utils|helpers/i.test(node.folder)) score += 10
      if ((inDeg[node.id] || 0) >= 3) score += 15
      hScores[node.id] = Math.max(0, Math.min(100, score))
    })
    healthScoresRef.current = hScores

    // ── Accretion disk around core ────────────────────────────────────────────
    const disk = new THREE.Mesh(
      new THREE.TorusGeometry(8, 2, 4, 64),
      new THREE.MeshBasicMaterial({
        map: makeAccretionTexture(), transparent: true, opacity: 0.9,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      })
    )
    galaxyGroup.add(disk)
    diskRef.current = disk

    // ── Core particle jets ────────────────────────────────────────────────────
    const JET_N = 300
    const makeJet = (dirSign) => {
      const posArr = new Float32Array(JET_N * 3)
      const phases = new Float32Array(JET_N)
      const maxTs  = new Float32Array(JET_N)
      const vels   = new Float32Array(JET_N * 3)
      for (let i = 0; i < JET_N; i++) {
        const angle = Math.random() * Math.PI * 2
        const spread = Math.random() * 0.18
        vels[i*3]   = Math.cos(angle) * spread
        vels[i*3+1] = dirSign * (0.85 + Math.random() * 0.15)
        vels[i*3+2] = Math.sin(angle) * spread
        phases[i]   = Math.random() * 2.0
        maxTs[i]    = 1.5 + Math.random() * 0.5
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3))
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, sizeAttenuation: true, transparent: true, opacity: 0.7 }))
      galaxyGroup.add(pts)
      return { geo, phases, maxTs, vels }
    }
    const upJet   = makeJet( 1)
    const downJet = makeJet(-1)
    jetRef.current = { upJet, downJet }

    // ── Dependency edges ──────────────────────────────────────────────────────
    const edgeObjects = []
    const edgeCurves  = []
    edges.forEach(({ source, target }) => {
      const a = planetById[source], b = planetById[target]
      if (!a || !b) return
      if (a.position.distanceTo(b.position) > 100) return
      const mid = new THREE.Vector3().addVectors(a.position, b.position).multiplyScalar(0.5)
      mid.sub(mid.clone().multiplyScalar(0.28))
      mid.y += (Math.random() - 0.5) * a.position.distanceTo(b.position) * 0.15
      const isCoreDep = source === coreNode.id || target === coreNode.id
      const curve     = new THREE.CatmullRomCurve3([a.position.clone(), mid, b.position.clone()])
      const mat = new THREE.MeshBasicMaterial({
        color: isCoreDep ? 0x55aaff : 0x2255dd, transparent: true,
        opacity: isCoreDep ? 0.48 : 0.22, depthWrite: false,
      })
      galaxyGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.06, 4, false), mat))
      edgeObjects.push({ mat, source, target, _baseOpacity: isCoreDep ? 0.48 : 0.22 })
      edgeCurves.push({ curve, source, target, srcColor: a.userData._color || "#4466ff" })
    })
    edgeObjectsRef.current = edgeObjects

    // ── Synaptic pulse orbs (top PLIMIT edges by combined in-degree) ──────────
    const pulseData = []
    if (PLIMIT > 0) {
      const scored = edgeCurves.map(ec => ({
        ...ec, score: (inDeg[ec.source] || 0) + (inDeg[ec.target] || 0)
      })).sort((a, b) => b.score - a.score).slice(0, PLIMIT)

      scored.forEach((ec, idx) => {
        const col = new THREE.Color(ec.srcColor)
        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(0.3, 6, 6),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9 })
        )
        orb.visible = false
        galaxyGroup.add(orb)

        const travelTime = 1.5 + Math.random() * 1.5
        const initDelay  = idx * (0.5 + Math.random() * 0.3)
        pulseData.push({ curve: ec.curve, orb, t: 0, speed: 1 / travelTime, delay: initDelay, active: false })
      })
    }
    pulseDataRef.current = pulseData

    // ── Constellation lines group ──────────────────────────────────────────────
    const constellGroup = new THREE.Group()
    galaxyGroup.add(constellGroup)
    constellGroupRef.current = constellGroup

    // ── Cross-playlist links group (gold lines, musicMode playlist mode)
    const crossLinksGroup = new THREE.Group()
    galaxyGroup.add(crossLinksGroup)
    crossLinksGroupRef.current = crossLinksGroup

    // Build per-folder sorted position arrays
    const folderNodes = {}
    nodes.forEach(n => {
      if (!folderNodes[n.folder]) folderNodes[n.folder] = []
      folderNodes[n.folder].push(n.id)
    })
    const constellData = {}
    Object.entries(folderNodes).forEach(([folder, ids]) => {
      const sorted = ids
        .filter(id => positions[id])
        .sort((a, b) => positions[a].length() - positions[b].length())
      if (sorted.length >= 2) constellData[folder] = sorted.map(id => positions[id].clone())
    })
    constellDataRef.current = constellData

    // ── Focus / reset ─────────────────────────────────────────────────────────
    const focusNode = nodeId => {
      const conn = new Set([nodeId])
      edgeObjects.forEach(({ mat, source, target }) => {
        if (source === nodeId || target === nodeId) {
          conn.add(source); conn.add(target)
          mat.color.setHex(0x44ccff); mat.opacity = 0.9
        } else { mat.opacity = 0.02 }
      })
      planetMeshes.forEach(m => {
        const c = conn.has(m.userData.id)
        m.material.transparent = !c; m.material.opacity = c ? 1 : 0.07; m.material.needsUpdate = true
        if (m.children[0]) { m.children[0].material.opacity = c ? 0.14 : 0.01; m.children[0].material.needsUpdate = true }
      })
    }
    const resetFocus = () => {
      edgeObjects.forEach(({ mat, source, target }) => {
        const isCoreDep = source === coreNode.id || target === coreNode.id
        mat.color.setHex(isCoreDep ? 0x55aaff : 0x2255dd)
        mat.opacity = isCoreDep ? 0.48 : 0.22
      })
      planetMeshes.forEach(m => {
        // Restore base color from userData
        const col = new THREE.Color(m.userData._color || "#4466ff")
        m.material.color.set(col); m.material.emissive.set(col)
        m.material.emissiveIntensity = 0.6 + (m.userData._inDeg || 0) * 0.08
        m.material.transparent = m.userData._isData; m.material.opacity = m.userData._isData ? 0.65 : 1
        m.material.needsUpdate = true
        m.scale.setScalar(1)
        if (m.children[0]) { m.children[0].material.opacity = 0.09; m.children[0].material.needsUpdate = true }
      })
      // Reapply mode overlay if active (health or activity)
      reapplyModeRef.current?.()
    }
    resetFocusRef.current = resetFocus
    focusNodeRef.current  = focusNode

    // ── Cinematic intro ───────────────────────────────────────────────────────
    const introStart = performance.now()
    const INTRO_MS   = 3000
    const startPos   = new THREE.Vector3(0, 400, 600)
    const endPos     = new THREE.Vector3(0, 120, 280)
    camera.position.copy(startPos); camera.lookAt(0, 0, 0)

    const sph = sphRef.current
    const applyCamera = () => {
      camera.position.set(
        sph.r * Math.sin(sph.phi) * Math.sin(sph.theta),
        sph.r * Math.cos(sph.phi),
        sph.r * Math.sin(sph.phi) * Math.cos(sph.theta)
      )
      camera.lookAt(0, 0, 0)
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    let dragging = false, wasDrag = false, prev = { x: 0, y: 0 }
    let idleTimer = null

    const toNDC = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect()
      return new THREE.Vector2(
        ((clientX - rect.left) / rect.width)  * 2 - 1,
       -((clientY - rect.top)  / rect.height) * 2 + 1
      )
    }

    const onMouseDown = e => {
      dragging = true; wasDrag = false; prev = { x: e.clientX, y: e.clientY }
      isIdleDriftRef.current = false
      if (idleTimer) clearTimeout(idleTimer)
    }
    const onMouseUp = () => {
      dragging = false
      idleTimer = setTimeout(() => { isIdleDriftRef.current = true }, 2000)
    }
    const onMouseMove = e => {
      if (dragging) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y
        if (Math.abs(dx) + Math.abs(dy) > 2) wasDrag = true
        if (!zoomStateRef.current.zoomedIn) {
          sph.theta -= dx * 0.006
          sph.phi = Math.max(0.12, Math.min(Math.PI - 0.12, sph.phi - dy * 0.006))
        }
        prev = { x: e.clientX, y: e.clientY }
        setTooltip(null); return
      }
      const m2 = toNDC(e.clientX, e.clientY)
      const ray = new THREE.Raycaster(); ray.setFromCamera(m2, camera)
      const hits = ray.intersectObjects(planetMeshes)
      if (hits.length > 0) {
        const d = hits[0].object.userData
        setTooltip({ x: e.clientX, y: e.clientY, name: d.label, lines: d.lines, deg: d._inDeg })
        renderer.domElement.style.cursor = "crosshair"
      } else {
        setTooltip(null); renderer.domElement.style.cursor = "default"
      }
    }
    const onWheel = e => { sph.r = Math.max(10, Math.min(600, sph.r + e.deltaY * 0.22)) }

    const onClick = e => {
      if (wasDrag) return
      const m2 = toNDC(e.clientX, e.clientY)
      const ray = new THREE.Raycaster(); ray.setFromCamera(m2, camera)
      const hits = ray.intersectObjects(planetMeshes)
      if (hits.length > 0) {
        const nd = hits[0].object.userData
        setSidebar({ ...nd, reverseDeps: edges.filter(ev => ev.target === nd.id).map(ev => ev.source) })
        focusNode(nd.id)
        // Architect mode: 5 clicks on core
        if (nd.id === coreNodeIdRef.current && !architectModeRef.current) {
          coreClickCountRef.current += 1
          if (coreClickCountRef.current >= 5) {
            coreClickCountRef.current = 0
            architectModeRef.current = true
            setArchitectActive(true)
            edgeObjectsRef.current.forEach(({ mat }) => { mat.color?.setHex(0xffd700); mat.opacity = 0.75 })
            planetMeshesRef.current.forEach(m => {
              m.scale.setScalar(2)
              m.material.color.setHex(0xffd700)
              m.material.emissive.setHex(0xffd700)
              m.material.emissiveIntensity = 0.7
            })
            onEasterEggToast?.("👑 You unlocked the architect's view")
          }
        }
        playChime(audioSysRef.current)
      } else { setSidebar(null); resetFocus() }
    }

    const onDblClick = e => {
      if (zoomStateRef.current.animating) return
      const m2 = toNDC(e.clientX, e.clientY)
      const ray = new THREE.Raycaster(); ray.setFromCamera(m2, camera)
      const hits = ray.intersectObjects(planetMeshes)
      if (hits.length === 0) return
      const mesh = hits[0].object
      const nd   = mesh.userData
      // Compute target camera position: 20 units in front of node (relative to camera direction)
      const nodeWorldPos = new THREE.Vector3()
      mesh.getWorldPosition(nodeWorldPos)
      const toCam = camera.position.clone().sub(nodeWorldPos).normalize()
      const toPos = nodeWorldPos.clone().addScaledVector(toCam, 20)
      zoomStateRef.current = {
        animating: true, zoomedIn: false, progress: 0, lockAfterAnim: true,
        fromPos: camera.position.clone(),
        toPos,
        lookTarget: nodeWorldPos.clone(),
        zoomedNodeMesh: mesh,
      }
      setSidebar({ ...nd, reverseDeps: edges.filter(ev => ev.target === nd.id).map(ev => ev.source) })
      focusNode(nd.id)
    }

    const cvs = renderer.domElement
    cvs.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mouseup", onMouseUp)
    cvs.addEventListener("mousemove", onMouseMove)
    cvs.addEventListener("wheel", onWheel, { passive: true })
    cvs.addEventListener("click", onClick)
    cvs.addEventListener("dblclick", onDblClick)

    const onResize = () => {
      const nW = container.clientWidth  || window.innerWidth
      const nH = container.clientHeight || window.innerHeight
      camera.aspect = nW / nH
      camera.updateProjectionMatrix()
      renderer.setSize(nW, nH)
      composer.setSize(nW, nH)
      bloomPass.resolution.set(nW, nH)
    }
    window.addEventListener("resize", onResize)

    // ── Minimap helpers ───────────────────────────────────────────────────────
    const nodeMinimapData = planetMeshes.map(m => ({
      x: m.position.x, z: m.position.z, color: m.userData._color || "#4466ff"
    }))

    const drawMinimap = () => {
      const mc = minimapRef.current; if (!mc) return
      const ctx2 = mc.getContext("2d"); if (!ctx2) return
      const W = mc.width, H = mc.height
      ctx2.clearRect(0, 0, W, H)
      ctx2.fillStyle = "rgba(2,8,20,0.92)"; ctx2.fillRect(0, 0, W, H)
      // World bounds
      const worldR = 150
      const toMm = (wx, wz) => ({
        x: (wx / worldR) * (W/2) + W/2,
        y: (wz / worldR) * (H/2) + H/2,
      })
      // Draw nodes
      nodeMinimapData.forEach(({ x, z, color }) => {
        const { x: mx, y: my } = toMm(x, z)
        ctx2.fillStyle = color
        ctx2.beginPath(); ctx2.arc(mx, my, 1.5, 0, Math.PI * 2); ctx2.fill()
      })
      // Draw camera position indicator
      const camX = camera.position.x, camZ = camera.position.z
      const { x: cx, y: cy } = toMm(camX, camZ)
      ctx2.strokeStyle = "rgba(255,255,255,0.7)"
      ctx2.lineWidth = 1
      const sz2 = 8
      ctx2.strokeRect(cx - sz2/2, cy - sz2/2, sz2, sz2)
    }

    // ── Animation clock + loop ────────────────────────────────────────────────
    let lastTime = performance.now()
    const rafClock = { elapsed: 0 }

    let rafId
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const now = performance.now()
      const dt  = Math.min((now - lastTime) / 1000, 0.05)
      lastTime  = now
      rafClock.elapsed += dt

      const elapsed  = now - introStart
      const introDone = skipIntroRef.current || elapsed >= INTRO_MS

      // ── Core pulse ──────────────────────────────────────────────────────
      const pulse = Math.sin(rafClock.elapsed * 1.2)
      if (coreMeshRef.current) coreMeshRef.current.material.emissiveIntensity = Math.min(1.2, 0.8 + (pulse + 1) * 0.2)
      if (coreLightRef.current) coreLightRef.current.intensity = 2.0 + (pulse + 1) * 0.5

      // ── Accretion disk rotation ──────────────────────────────────────────
      if (diskRef.current) diskRef.current.rotation.y += 0.008

      // ── Particle jets ────────────────────────────────────────────────────
      if (jetRef.current) {
        ;[jetRef.current.upJet, jetRef.current.downJet].forEach(({ geo, phases, maxTs, vels }) => {
          const arr = geo.attributes.position.array
          for (let i = 0; i < JET_N; i++) {
            phases[i] += dt
            if (phases[i] > maxTs[i]) phases[i] = 0
            const t = phases[i] / maxTs[i]
            const dist = t * 55
            arr[i*3]   = vels[i*3]   * dist
            arr[i*3+1] = vels[i*3+1] * dist
            arr[i*3+2] = vels[i*3+2] * dist
          }
          geo.attributes.position.needsUpdate = true
        })
      }

      // ── Synaptic pulses ──────────────────────────────────────────────────
      pulseData.forEach(p => {
        if (p.delay > 0) { p.delay -= dt; p.orb.visible = false; return }
        p.orb.visible = true
        p.t += dt * p.speed
        if (p.t >= 1) {
          p.t = 0; p.orb.visible = false
          p.delay = 0.5 + Math.random() * 3.5
        } else {
          const pos3 = p.curve.getPointAt(Math.min(p.t, 0.9999))
          p.orb.position.copy(pos3)
        }
      })

      // ── Zoom-to-node animation ────────────────────────────────────────────
      const zs = zoomStateRef.current
      if (zs.animating) {
        zs.progress = Math.min(1, zs.progress + dt / 1.5)
        const e = easeInOutCubic(zs.progress)
        camera.position.lerpVectors(zs.fromPos, zs.toPos, e)
        camera.lookAt(zs.lookTarget)
        if (zs.progress >= 1) {
          zs.animating = false
          if (zs.lockAfterAnim !== false) {
            zs.zoomedIn = true
            setIsZoomed(true)
          } else {
            zs.zoomedIn = false
            // Sync spherical coords so orbit continues smoothly
            const p = zs.toPos
            if (p) {
              const r2 = Math.sqrt(p.x * p.x + p.z * p.z)
              sph.r = Math.max(10, p.length())
              sph.theta = Math.atan2(p.x, p.z)
              sph.phi = Math.atan2(r2, p.y)
            }
          }
        }
      } else if (zs.zoomedIn) {
        // Lock camera, pulse zoomed node corona
        camera.lookAt(zs.lookTarget)
        if (zs.zoomedNodeMesh?.children[0]) {
          const scale = 1.0 + 0.15 * Math.sin(rafClock.elapsed * 3)
          zs.zoomedNodeMesh.children[0].scale.setScalar(scale)
        }
      } else {
        if (!introDone) {
          const t = Math.min(1, elapsed / INTRO_MS)
          const ease = 1 - Math.pow(1 - t, 3)
          camera.position.lerpVectors(startPos, endPos, ease)
          camera.lookAt(0, 0, 0)
        } else {
          if (isIdleDriftRef.current && !pausedRef.current) sph.theta += 0.00015
          applyCamera()
          if (!pausedRef.current) galaxyGroup.rotation.y += (recordingModeRef.current ? 0.003 : 0.00008) * rotationMultRef.current
        }
      }

      // Planet self-rotation (skip core which has separate animations)
      planetMeshes.forEach(m => { m.rotation.y += 0.003 })

      // Minimap
      drawMinimap()

      // ── Atmosphere: nebula drift ─────────────────────────────────────────
      if (!reducedMotionRef.current) {
        nebulaMeshesRef.current.forEach((plane, i) => {
          const vel = nebulaVelsRef.current[i]; if (!vel) return
          plane.position.x += vel.vx
          plane.position.z += vel.vz
          const d2 = plane.position.x*plane.position.x + plane.position.z*plane.position.z
          if (d2 > 150*150) { plane.position.x *= -0.9; plane.position.z *= -0.9 }
        })
      }
      // ── Atmosphere: star twinkle ──────────────────────────────────────────
      if (!reducedMotionRef.current && twinkleStarsGeoRef.current) {
        const ca = twinkleStarsGeoRef.current.attributes.color
        const td = twinkleDataRef.current
        for (let i = 0; i < td.length; i++) {
          const b = 0.4 + 0.6 * Math.abs(Math.sin(rafClock.elapsed * td[i].freq + td[i].phase))
          ca.array[i*3] = ca.array[i*3+1] = ca.array[i*3+2] = b
        }
        ca.needsUpdate = true
      }
      // ── Atmosphere: shooting stars ────────────────────────────────────────
      if (!reducedMotionRef.current) {
        shootingTimerRef.current -= dt
        if (shootingTimerRef.current <= 0 && !shootingStarRef.current) {
          shootingTimerRef.current = 4 + Math.random() * 4
          const ang  = Math.random() * Math.PI * 2
          const dist = 380 + Math.random() * 80
          const sv = new THREE.Vector3(Math.cos(ang)*dist, (Math.random()-0.5)*150, Math.sin(ang)*dist)
          const ev = new THREE.Vector3(
            Math.cos(ang+Math.PI+(Math.random()-0.5)*0.5)*180+(Math.random()-0.5)*80,
            sv.y + (Math.random()-0.5)*70,
            Math.sin(ang+Math.PI+(Math.random()-0.5)*0.5)*180+(Math.random()-0.5)*80
          )
          const ssPos = new Float32Array([sv.x,sv.y,sv.z, sv.x,sv.y,sv.z])
          const ssGeo = new THREE.BufferGeometry()
          ssGeo.setAttribute("position", new THREE.BufferAttribute(ssPos, 3))
          const ssMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
          const ssLine = new THREE.Line(ssGeo, ssMat)
          scene.add(ssLine)
          shootingStarRef.current = { line: ssLine, geo: ssGeo, mat: ssMat, start: sv, end: ev, progress: 0, duration: 0.6 }
        }
        const ss = shootingStarRef.current
        if (ss) {
          ss.progress += dt / ss.duration
          if (ss.progress >= 1) {
            scene.remove(ss.line); ss.mat.dispose(); ss.geo.dispose(); shootingStarRef.current = null
          } else {
            const pa = ss.geo.attributes.position
            if (ss.progress < 0.5) {
              const t = ss.progress * 2
              pa.setXYZ(0, ss.start.x, ss.start.y, ss.start.z)
              pa.setXYZ(1, ss.start.x+(ss.end.x-ss.start.x)*t, ss.start.y+(ss.end.y-ss.start.y)*t, ss.start.z+(ss.end.z-ss.start.z)*t)
            } else {
              const t = (ss.progress-0.5)*2
              pa.setXYZ(0, ss.start.x+(ss.end.x-ss.start.x)*t, ss.start.y+(ss.end.y-ss.start.y)*t, ss.start.z+(ss.end.z-ss.start.z)*t)
              pa.setXYZ(1, ss.end.x, ss.end.y, ss.end.z)
            }
            pa.needsUpdate = true
            ss.mat.opacity = Math.max(0, 1.0 - ss.progress*ss.progress*0.9)
          }
        }
      }
      // ── Easter egg: rainbow mode timer ────────────────────────────────────
      const rm = rainbowModeRef.current
      if (rm.active) {
        rotationMultRef.current = 10
        if (Date.now() >= rm.endTime) {
          rm.active = false; rotationMultRef.current = 1
          planetMeshesRef.current.forEach(m => {
            const col = new THREE.Color(m.userData._color || "#4466ff")
            m.material.color.set(col); m.material.emissive.set(col)
          })
        }
      }

      // ── Time Machine animations ────────────────────────────────────────────
      const TM_SPAWN_DUR   = 0.8
      const TM_FLASH_DUR   = 0.4
      const TM_RING_DUR    = 0.5
      const TM_IMPLODE_DUR = 0.4
      const TM_PULSE_DUR   = 0.6

      // Spawn: scale 0→1, position center→origPos over 0.8s
      Object.entries(tmSpawnAnimsRef.current).forEach(([nodeId, anim]) => {
        anim.progress = Math.min(1, anim.progress + dt / TM_SPAWN_DUR)
        const mesh = planetByIdRef.current[nodeId]; if (!mesh) return
        const t = anim.progress
        // ease-out cubic
        const e = 1 - Math.pow(1 - t, 3)
        mesh.scale.setScalar(e)
        if (anim.origPos) mesh.position.lerpVectors(new THREE.Vector3(0, 0, 0), anim.origPos, e)
        if (anim.progress >= 1) {
          mesh.scale.set(1, 1, 1)
          if (anim.origPos) mesh.position.copy(anim.origPos)
          delete tmSpawnAnimsRef.current[nodeId]
        }
      })

      // Flash: scale 0.1→3→0 over 0.4s, fade out
      const remainFlashes = []
      for (const anim of tmFlashMeshesRef.current) {
        anim.progress = Math.min(1, anim.progress + dt / TM_FLASH_DUR)
        const t = anim.progress < 0.5 ? anim.progress * 2 : (1 - anim.progress) * 2
        anim.mesh.scale.setScalar(Math.max(0.01, t * 3))
        anim.mesh.material.opacity = Math.max(0, 0.9 * (1 - anim.progress))
        anim.mesh.material.needsUpdate = true
        if (anim.progress >= 1) {
          galaxyGroupRef.current?.remove(anim.mesh)
          anim.mesh.geometry.dispose(); anim.mesh.material.dispose()
        } else { remainFlashes.push(anim) }
      }
      tmFlashMeshesRef.current = remainFlashes

      // Implode: scale 1→0 over 0.4s, then hide
      Object.entries(tmImplodeAnimsRef.current).forEach(([nodeId, anim]) => {
        anim.progress = Math.min(1, anim.progress + dt / TM_IMPLODE_DUR)
        const mesh = planetByIdRef.current[nodeId]; if (!mesh) return
        const s = Math.max(0, 1 - anim.progress)
        mesh.scale.setScalar(s)
        if (anim.progress >= 1) {
          mesh.visible = false; mesh.scale.set(0, 0, 0)
          delete tmImplodeAnimsRef.current[nodeId]
        }
      })

      // Pulse: emissiveIntensity spike 0.6→2.0→baseline over 0.6s
      Object.entries(tmPulseAnimsRef.current).forEach(([nodeId, anim]) => {
        anim.progress = Math.min(1, anim.progress + dt / TM_PULSE_DUR)
        const mesh = planetByIdRef.current[nodeId]; if (!mesh) return
        const t = anim.progress
        const base = mesh.userData._baseEmissive ?? 0.6
        const peak = 2.0
        const intensity = t < 0.3 ? base + (peak - base) * (t / 0.3) : base + (peak - base) * (1 - (t - 0.3) / 0.7)
        mesh.material.emissiveIntensity = intensity
        mesh.material.needsUpdate = true
        if (anim.progress >= 1) {
          mesh.material.emissiveIntensity = base
          mesh.material.needsUpdate = true
          delete tmPulseAnimsRef.current[nodeId]
        }
      })

      // Ring: scale 1→4, opacity 1→0 over 0.5s
      const remainRings = []
      for (const anim of tmRingMeshesRef.current) {
        anim.progress = Math.min(1, anim.progress + dt / TM_RING_DUR)
        anim.mesh.scale.setScalar(1 + anim.progress * 3)
        anim.mesh.material.opacity = Math.max(0, 0.85 * (1 - anim.progress))
        anim.mesh.material.needsUpdate = true
        if (anim.progress >= 1) {
          galaxyGroupRef.current?.remove(anim.mesh)
          anim.mesh.geometry.dispose(); anim.mesh.material.dispose()
        } else { remainRings.push(anim) }
      }
      tmRingMeshesRef.current = remainRings

      // ── Mood Journey visual response (musicMode only) ─────────────────────
      if (musicMode && moodActiveRef.current && moodTargetRef.current) {
        const { energy: te, valence: tv } = moodTargetRef.current
        const LERP = 0.06
        planetMeshesRef.current.forEach(mesh => {
          const { energy = 0.5, valence = 0.5,
                  _baseEmissive = 0.6, _baseOpacity = 1, _origPos } = mesh.userData
          const dist  = Math.sqrt((energy - te) ** 2 + (valence - tv) ** 2)
          const match = Math.max(0, 1 - dist / 0.6)
          const tOpacity  = match > 0.5
            ? 0.6 + match * 0.4
            : Math.max(0.07, 0.1 + match * 0.3)
          const tEmissive = Math.max(0.07, match > 0.5
            ? _baseEmissive * (1 + match * 0.5)
            : _baseEmissive * 0.2)
          const tScale = match > 0.8 ? 1.25 : match > 0.5 ? 1.0 : 0.82
          mesh.material.opacity           += (tOpacity  - mesh.material.opacity)           * LERP
          mesh.material.emissiveIntensity += (tEmissive - mesh.material.emissiveIntensity) * LERP
          const curS = mesh.scale.x
          mesh.scale.setScalar(curS + (tScale - curS) * 0.05)
          if (_origPos) {
            const tY = _origPos.y + (match > 0.8 ? 3 : match < 0.5 ? -2 : 0)
            mesh.position.y += (tY - mesh.position.y) * 0.04
          }
          mesh.material.needsUpdate = true
        })
      }

      // ── Playlist mode: lerp node positions toward playlist/genre arm ──────
      if (musicMode) {
        const pMap    = playlistPositionsRef.current   // node positions for playlist arms (or null)
        const PLLERP  = 0.035
        planetMeshesRef.current.forEach(mesh => {
          const target = pMap
            ? (pMap[mesh.userData.id] ?? mesh.userData._origPos)
            : mesh.userData._origPos
          if (target) {
            mesh.position.x += (target.x - mesh.position.x) * PLLERP
            mesh.position.z += (target.z - mesh.position.z) * PLLERP
            // y lerped by mood section already; here use gentle push if not in mood mode
            if (!moodActiveRef.current) {
              mesh.position.y += (target.y - mesh.position.y) * PLLERP
            }
          }
        })
      }

      // ── Time Machine visibility: fade nodes in/out based on visible set ────
      if (musicMode && tmVisibilityRef.current !== null) {
        const vis = tmVisibilityRef.current
        planetMeshesRef.current.forEach(mesh => {
          const show   = vis.has(mesh.userData.id)
          const target = show ? (mesh.userData._baseOpacity ?? 1.0) : 0.02
          if (Math.abs(mesh.material.opacity - target) > 0.004) {
            mesh.material.opacity    += (target - mesh.material.opacity) * 0.12
            mesh.material.needsUpdate = true
          }
          mesh.visible = mesh.material.opacity > 0.01
        })
      }

      composer.render()
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("mouseup", onMouseUp)
      cvs.removeEventListener("mousedown", onMouseDown)
      cvs.removeEventListener("mousemove", onMouseMove)
      cvs.removeEventListener("wheel", onWheel)
      cvs.removeEventListener("click", onClick)
      cvs.removeEventListener("dblclick", onDblClick)
      if (idleTimer) clearTimeout(idleTimer)
      // Clean up shooting star if active
      if (shootingStarRef.current) {
        scene.remove(shootingStarRef.current.line)
        shootingStarRef.current.mat.dispose()
        shootingStarRef.current.geo.dispose()
        shootingStarRef.current = null
      }
      twinkleStarsGeoRef.current = null; twinkleDataRef.current = []
      nebulaMeshesRef.current    = []; nebulaVelsRef.current = []
      resetFocusRef.current = null
      focusNodeRef.current  = null
      // Clean up TM animation meshes
      tmSpawnAnimsRef.current = {}; tmImplodeAnimsRef.current = {}; tmPulseAnimsRef.current = {}
      tmFlashMeshesRef.current = []; tmRingMeshesRef.current = []
      coreMeshRef.current = null; coreLightRef.current = null
      diskRef.current = null; jetRef.current = null
      planetMeshesRef.current = []; planetByIdRef.current = {}
      edgeObjectsRef.current = []; pulseDataRef.current = []
      crossLinksGroupRef.current = null
      playlistPositionsRef.current = null; playlistModeActiveRef.current = false
      tmVisibilityRef.current = null
      renderer.dispose()
      if (container.contains(cvs)) container.removeChild(cvs)
    }
  }, [nodes, edges])

  // ── Constellation lines (re-runs when hover/pin props change) ──────────────
  useEffect(() => {
    const group = constellGroupRef.current; if (!group) return
    while (group.children.length) {
      const child = group.children[0]
      if (child.geometry) child.geometry.dispose()
      if (child.material) child.material.dispose()
      group.remove(child)
    }
    const show = new Set(pinnedFolders)
    if (hoveredFolder) show.add(hoveredFolder)
    const data = constellDataRef.current
    show.forEach(folder => {
      const pts = data[folder]; if (!pts || pts.length < 2) return
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 })
      group.add(new THREE.Line(geo, mat))
    })
  }, [hoveredFolder, pinnedFolders])

  // ── Cross-playlist links (gold lines between tracks in 2+ playlists) ────────
  useEffect(() => {
    const group = crossLinksGroupRef.current; if (!group) return
    while (group.children.length) {
      const c = group.children[0]
      c.geometry?.dispose(); c.material?.dispose(); group.remove(c)
    }
    if (!crossPlaylistLinks?.length || !playlistModeActiveRef.current) return
    const pMap = playlistPositionsRef.current
    const posMap = pMap || positionsRef.current
    if (!posMap) return
    crossPlaylistLinks.slice(0, 150).forEach(({ sourceId, targetId }) => {
      const p1 = posMap[sourceId]; const p2 = posMap[targetId]
      if (!p1 || !p2) return
      const geo = new THREE.BufferGeometry().setFromPoints([
        p1 instanceof THREE.Vector3 ? p1 : new THREE.Vector3(p1.x, p1.y, p1.z),
        p2 instanceof THREE.Vector3 ? p2 : new THREE.Vector3(p2.x, p2.y, p2.z),
      ])
      group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.38 })))
    })
  }, [crossPlaylistLinks, playlistPositions])

  // ── Update playlistPositionsRef when prop changes ────────────────────────────
  useEffect(() => {
    if (playlistPositions && typeof playlistPositions === "object") {
      const v3Map = {}
      Object.entries(playlistPositions).forEach(([id, p]) => {
        v3Map[id] = new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0)
      })
      playlistPositionsRef.current  = v3Map
      playlistModeActiveRef.current = true
    } else {
      playlistPositionsRef.current  = null
      playlistModeActiveRef.current = false
    }
  }, [playlistPositions])

  // ── File type filter ────────────────────────────────────────────────────────
  useEffect(() => {
    const meshes = planetMeshesRef.current; if (!meshes.length) return
    if (!fileTypeFilter) {
      resetFocusRef.current?.()
    } else {
      meshes.forEach(m => {
        const ext = m.userData.id?.split(".").pop().toLowerCase()
        const match = ext === fileTypeFilter
        m.material.transparent = true
        m.material.opacity = match ? 1 : 0.06
        m.material.needsUpdate = true
        if (m.children[0]) {
          m.children[0].material.opacity = match ? 0.14 : 0.005
          m.children[0].material.needsUpdate = true
        }
      })
      edgeObjectsRef.current.forEach(({ mat }) => { mat.opacity = 0.04 })
    }
  }, [fileTypeFilter])

  // ── Sound system ────────────────────────────────────────────────────────────
  useEffect(() => {
    soundOnRef.current = soundOn
    if (soundOn) {
      if (!audioSysRef.current) audioSysRef.current = createAudioSystem()
      const sys = audioSysRef.current; if (!sys) return
      if (sys.ctx.state === "suspended") sys.ctx.resume()
      const { master, ctx } = sys
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
      master.gain.linearRampToValueAtTime(1, ctx.currentTime + 3)
    } else {
      const sys = audioSysRef.current; if (!sys) return
      const { master, ctx } = sys
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1)
      setTimeout(() => { if (!soundOnRef.current && sys.ctx.state !== "closed") sys.ctx.suspend().catch(() => {}) }, 1500)
    }
  }, [soundOn])

  // ── Helper: convert health score to THREE.Color ─────────────────────────
  function healthScoreColor(score) {
    if (score >= 90) return new THREE.Color(0x22c55e)
    if (score >= 70) return new THREE.Color(0x84cc16)
    if (score >= 50) return new THREE.Color(0xeab308)
    if (score >= 30) return new THREE.Color(0xf97316)
    return new THREE.Color(0xef4444)
  }

  // ── Health mode ─────────────────────────────────────────────────────────
  useEffect(() => {
    const meshes = planetMeshesRef.current; if (!meshes.length) return
    if (healthMode) {
      const scores = healthScoresRef.current
      const applyFn = () => {
        meshes.forEach(m => {
          const score = scores[m.userData.id] ?? 50
          const col = healthScoreColor(score)
          m.material.color.set(col); m.material.emissive.set(col)
          m.material.emissiveIntensity = 0.4 + (score / 100) * 0.9
          m.material.transparent = false; m.material.opacity = 1
          m.material.needsUpdate = true
          if (m.children[0]) { m.children[0].material.color.set(col); m.children[0].material.needsUpdate = true }
        })
      }
      applyFn()
      reapplyModeRef.current = applyFn
    } else {
      reapplyModeRef.current = null
      // Restore original colors
      meshes.forEach(m => {
        const col = new THREE.Color(m.userData._color || "#4466ff")
        m.material.color.set(col); m.material.emissive.set(col)
        m.material.emissiveIntensity = 0.6 + (m.userData._inDeg || 0) * 0.08
        m.material.transparent = m.userData._isData; m.material.opacity = m.userData._isData ? 0.65 : 1
        m.material.needsUpdate = true
        if (m.children[0]) { m.children[0].material.color.set(col); m.children[0].material.needsUpdate = true }
      })
    }
  }, [healthMode])

  // ── Activity data ────────────────────────────────────────────────────────
  useEffect(() => {
    const meshes = planetMeshesRef.current; if (!meshes.length) return
    function actCol(count) {
      if (count === 0)  return { color: new THREE.Color(0x444466), opacity: 0.3 }
      if (count <= 2)   return { color: new THREE.Color(0x3b82f6), opacity: 0.8 }
      if (count <= 5)   return { color: new THREE.Color(0x8b5cf6), opacity: 0.9 }
      if (count <= 10)  return { color: new THREE.Color(0xf97316), opacity: 1.0 }
      return { color: new THREE.Color(0xffffff), opacity: 1.0 }
    }
    if (activityData && Object.keys(activityData).length) {
      const applyFn = () => {
        meshes.forEach(m => {
          const count = activityData[m.userData.id]
          if (count === undefined) return
          const { color, opacity } = actCol(count)
          m.material.color.set(color); m.material.emissive.set(color)
          m.material.transparent = opacity < 1; m.material.opacity = opacity
          m.material.emissiveIntensity = 0.3 + Math.min(count, 10) * 0.07
          m.material.needsUpdate = true
          m.scale.setScalar(1 + Math.min(count, 10) * 0.05)
        })
      }
      applyFn()
      reapplyModeRef.current = applyFn
    } else {
      reapplyModeRef.current = null
      meshes.forEach(m => {
        const col = new THREE.Color(m.userData._color || "#4466ff")
        m.material.color.set(col); m.material.emissive.set(col)
        m.material.emissiveIntensity = 0.6 + (m.userData._inDeg || 0) * 0.08
        m.material.transparent = m.userData._isData; m.material.opacity = m.userData._isData ? 0.65 : 1
        m.material.needsUpdate = true
        m.scale.setScalar(1)
      })
    }
  }, [activityData])

  // ── Search ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const meshes = planetMeshesRef.current; if (!meshes.length) return
    const q = searchQuery.trim().toLowerCase()
    if (!q) {
      onSearchResults?.(null)
      resetFocusRef.current?.()
      return
    }
    const matching = meshes.filter(m =>
      m.userData.label?.toLowerCase().includes(q) ||
      m.userData.folder?.toLowerCase().includes(q) ||
      m.userData.id?.toLowerCase().includes(q)
    )
    onSearchResults?.(matching.length)
    const matchSet = new Set(matching)
    meshes.forEach(m => {
      const hit = matchSet.has(m)
      m.material.transparent = true
      m.material.opacity = hit ? 1 : 0.06
      m.material.needsUpdate = true
      if (m.children[0]) {
        m.children[0].material.opacity = hit ? 0.14 : 0.004
        m.children[0].material.needsUpdate = true
      }
    })
    edgeObjectsRef.current.forEach(({ mat }) => { mat.opacity = 0.03 })
    // Fly camera toward the centroid of matches
    if (matching.length && cameraRef.current) {
      const centroid = new THREE.Vector3()
      matching.forEach(m => centroid.add(m.position))
      centroid.divideScalar(matching.length)
      const camDist = centroid.length() + 80
      const toPos = centroid.clone().normalize().multiplyScalar(camDist)
      toPos.y = Math.max(toPos.y, 20)
      zoomStateRef.current = {
        animating: true, zoomedIn: false, progress: 0, lockAfterAnim: false,
        fromPos: cameraRef.current.position.clone(),
        toPos,
        lookTarget: new THREE.Vector3(0, 0, 0),
        zoomedNodeMesh: null,
      }
      const r2 = Math.sqrt(toPos.x * toPos.x + toPos.z * toPos.z)
      Object.assign(sphRef.current, {
        r: toPos.length(), theta: Math.atan2(toPos.x, toPos.z), phi: Math.atan2(r2, toPos.y),
      })
    }
  }, [searchQuery])

  // ── Time Machine: node visibility ────────────────────────────────────────
  useEffect(() => {
    if (!planetMeshesRef.current.length) return
    // null = exit TM mode, show everything
    if (timeMachineVisible === null) {
      planetMeshesRef.current.forEach(m => {
        m.visible = true
        m.scale.set(1, 1, 1)
        m.material.transparent = m.userData._isData
        m.material.opacity     = m.userData._isData ? 0.65 : 1
        m.material.needsUpdate = true
      })
      edgeObjectsRef.current.forEach(e => {
        e.mat.opacity     = e._baseOpacity ?? 0.22
        e.mat.needsUpdate = true
      })
      // Clear all active animations
      tmSpawnAnimsRef.current   = {}
      tmImplodeAnimsRef.current = {}
      tmPulseAnimsRef.current   = {}
      return
    }
    // Show only nodes in the visible set
    planetMeshesRef.current.forEach(m => {
      const inSet = timeMachineVisible.has(m.userData.id)
      const alreadySpawning = !!tmSpawnAnimsRef.current[m.userData.id]
      const alreadyImploding = !!tmImplodeAnimsRef.current[m.userData.id]
      if (!inSet && !alreadyImploding) {
        m.visible = false
        m.scale.set(0, 0, 0)
      } else if (inSet && !m.visible && !alreadySpawning) {
        // Node is visible but not yet shown (e.g. jumping to later commit)
        m.visible = true
        m.scale.set(1, 1, 1)
      }
    })
    edgeObjectsRef.current.forEach(e => {
      const srcVis = timeMachineVisible.has(e.source)
      const tgtVis = timeMachineVisible.has(e.target)
      e.mat.opacity     = (srcVis && tgtVis) ? (e._baseOpacity ?? 0.22) : 0
      e.mat.needsUpdate = true
    })
  }, [timeMachineVisible])

  // ── Time Machine: spawn newly added nodes ─────────────────────────────────
  useEffect(() => {
    if (!timeMachineSpawn?.length || !galaxyGroupRef.current) return
    timeMachineSpawn.forEach(nodeId => {
      const mesh = planetByIdRef.current?.[nodeId]
      if (!mesh) return
      const origPos = mesh.userData._origPos ?? mesh.position.clone()
      // Move to center and scale to 0 for spawn animation
      mesh.position.set(0, 0, 0)
      mesh.scale.set(0.01, 0.01, 0.01)
      mesh.visible = true
      tmSpawnAnimsRef.current[nodeId] = { progress: 0, origPos }

      // Bright flash sphere at destination
      const r = mesh.userData._rSize ?? 1
      const flashGeo = new THREE.SphereGeometry(r * 2.5, 8, 8)
      const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false,
      })
      const flashMesh = new THREE.Mesh(flashGeo, flashMat)
      flashMesh.position.copy(origPos)
      flashMesh.scale.set(0.1, 0.1, 0.1)
      galaxyGroupRef.current.add(flashMesh)
      tmFlashMeshesRef.current.push({ mesh: flashMesh, progress: 0 })
    })
  }, [timeMachineSpawn])

  // ── Time Machine: pulse modified nodes ────────────────────────────────────
  useEffect(() => {
    if (!timeMachineModify?.length || !galaxyGroupRef.current) return
    timeMachineModify.forEach(nodeId => {
      const mesh = planetByIdRef.current?.[nodeId]
      if (!mesh || !mesh.visible) return
      tmPulseAnimsRef.current[nodeId] = { progress: 0 }

      // Expanding ring at node position
      const r = mesh.userData._rSize ?? 1
      const ringGeo = new THREE.RingGeometry(r, r * 1.4, 32)
      const ringMat = new THREE.MeshBasicMaterial({
        color: mesh.material.color ?? 0x4488ff,
        transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
      })
      const ringMesh = new THREE.Mesh(ringGeo, ringMat)
      ringMesh.position.copy(mesh.position)
      // Orient ring to face camera approximately
      ringMesh.rotation.x = Math.PI / 2
      galaxyGroupRef.current.add(ringMesh)
      tmRingMeshesRef.current.push({ mesh: ringMesh, progress: 0 })
    })
  }, [timeMachineModify])

  // ── Time Machine: implode removed nodes ───────────────────────────────────
  useEffect(() => {
    if (!timeMachineRemove?.length) return
    timeMachineRemove.forEach(nodeId => {
      const mesh = planetByIdRef.current?.[nodeId]
      if (!mesh || !mesh.visible) return
      tmImplodeAnimsRef.current[nodeId] = { progress: 0 }
    })
  }, [timeMachineRemove])

  // ── Time Machine: author colors ───────────────────────────────────────────
  useEffect(() => {
    if (!planetMeshesRef.current.length) return
    if (!timeMachineAuthorColors) {
      // Revert to original folder-based colors
      planetMeshesRef.current.forEach(m => {
        const origColor = m.userData._color
        if (origColor) {
          m.material.color.set(origColor)
          m.material.emissive.set(origColor)
          m.material.needsUpdate = true
        }
      })
      return
    }
    planetMeshesRef.current.forEach(m => {
      const hex = timeMachineAuthorColors[m.userData.id]
      if (hex) {
        m.material.color.set(hex)
        m.material.emissive.set(hex)
        m.material.emissiveIntensity = m.userData._baseEmissive ?? 0.6
        m.material.needsUpdate = true
      }
    })
  }, [timeMachineAuthorColors])

  // ── Mini dependency graph canvas ──────────────────────────────────────────
  useEffect(() => {
    const canvas = miniGraphRef.current; if (!canvas || !sidebar) return
    const ctx2 = canvas.getContext("2d"); if (!ctx2) return
    const W = canvas.width, H = canvas.height
    ctx2.clearRect(0, 0, W, H)
    const imps    = sidebar.imports || []
    const revDeps = sidebar.reverseDeps || []
    const neighbors = [...new Set([...imps, ...revDeps])].slice(0, 14)
    if (neighbors.length === 0) return
    const cx = W / 2, cy = H / 2 - 4
    const r  = Math.min(cx - 18, cy - 10)
    // Edges
    ctx2.strokeStyle = "rgba(99,140,255,0.25)"; ctx2.lineWidth = 0.8
    neighbors.forEach((_, i) => {
      const angle = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2
      ctx2.beginPath(); ctx2.moveTo(cx, cy)
      ctx2.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
      ctx2.stroke()
    })
    // Neighbor nodes
    neighbors.forEach((nId, i) => {
      const angle = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2
      const nx = cx + Math.cos(angle) * r, ny = cy + Math.sin(angle) * r
      ctx2.beginPath(); ctx2.arc(nx, ny, 3.5, 0, Math.PI * 2)
      ctx2.fillStyle = imps.includes(nId) ? "rgba(74,222,128,0.85)" : "rgba(192,132,252,0.85)"
      ctx2.fill()
    })
    // Centre node
    ctx2.beginPath(); ctx2.arc(cx, cy, 6, 0, Math.PI * 2)
    ctx2.fillStyle = sidebar._color || "#4466ff"
    ctx2.shadowColor = sidebar._color || "#4466ff"; ctx2.shadowBlur = 6
    ctx2.fill(); ctx2.shadowBlur = 0
  }, [sidebar])

  // ── Konami code easter egg ────────────────────────────────────────────────
  useEffect(() => {
    const KONAMI = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"]
    const handler = (e) => {
      const seq = konamiSeqRef.current
      seq.push(e.key)
      if (seq.length > KONAMI.length) seq.splice(0, seq.length - KONAMI.length)
      if (seq.length === KONAMI.length && seq.every((k, i) => k === KONAMI[i])) {
        konamiSeqRef.current = []
        // Rainbow all planets
        const rm = rainbowModeRef.current
        rm.active = true; rm.endTime = Date.now() + 3000
        planetMeshesRef.current.forEach(m => {
          const h = Math.random(); const col = new THREE.Color().setHSL(h, 1, 0.55)
          m.material.color.set(col); m.material.emissive.set(col)
        })
        playKonami(audioSysRef.current)
        onEasterEggToast?.("🌈 HYPER GALAXY ACTIVATED")
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onEasterEggToast])

  // ── Repo name easter eggs ─────────────────────────────────────────────────
  useEffect(() => {
    if (!planetMeshesRef.current.length) return
    const r = (repo || "").toLowerCase()
    let msg = null
    if (r.includes("linux") || r.includes("kernel")) {
      const core = coreMeshRef.current
      if (core) { core.material.color.setHex(0xffd700); core.material.emissive.setHex(0xffd700) }
      msg = "⚡ A legendary codebase. Respect."
    } else if (r.includes("react")) {
      // Slightly speed up self-rotation (handled via flag — standard rotation is already per-frame)
      msg = "⚛️ React detected. Everything is a component now."
    } else if (r.includes("next")) {
      msg = "▲ Vercel vibes detected."
    }
    if (!msg && nodes?.length > 1000) msg = "🏔️ Monorepo detected. This galaxy needs a telescope."
    else if (!msg && nodes?.length < 10) msg = "🌱 A baby galaxy. Every star began this small."
    if (msg) {
      const t = setTimeout(() => onEasterEggToast?.(msg), 2200)
      return () => clearTimeout(t)
    }
  }, [repo, nodes, onEasterEggToast])

  // ── Architect mode title badge ────────────────────────────────────────────

  const handleZoomOut = () => {
    const zs = zoomStateRef.current
    if (!zs.zoomedIn) return
    // Reset zoomed node corona scale
    if (zs.zoomedNodeMesh?.children[0]) zs.zoomedNodeMesh.children[0].scale.setScalar(1)
    // Animate back
    zoomStateRef.current = {
      animating: true, zoomedIn: false, progress: 0, lockAfterAnim: false,
      fromPos: cameraRef.current?.position.clone() || new THREE.Vector3(0, 120, 280),
      toPos: new THREE.Vector3(0, 120, 280),
      lookTarget: new THREE.Vector3(0, 0, 0),
      zoomedNodeMesh: null,
    }
    sphRef.current = { theta: 0, phi: 1.1, r: 280 }
    setIsZoomed(false)
    setSidebar(null)
    resetFocusRef.current?.()
  }

  return (
    <div ref={mountRef} className="absolute inset-0 w-full h-full">

      {/* Architect mode badge */}
      {architectActive && !hideUI && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 font-mono text-xs px-3 py-1.5 rounded-lg pointer-events-none"
             style={{ background: "rgba(20,15,4,0.9)", border: "1px solid rgba(255,215,0,0.5)", color: "#ffd700", boxShadow: "0 0 12px rgba(255,215,0,0.2)" }}>
          👑 Architect Mode
        </div>
      )}

      {/* Skip intro */}
      {showSkipBtn && (
        <button
          onClick={() => { skipIntroRef.current = true; setShowSkipBtn(false) }}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-30 text-xs text-gray-600
                     hover:text-gray-300 border border-gray-800 hover:border-gray-600
                     px-4 py-1.5 rounded-lg transition-colors bg-black/60 backdrop-blur font-mono"
        >
          Skip intro ↓
        </button>
      )}

      {/* Sound toggle */}
      {!hideUI && (
        <button
          onClick={() => setSoundOn(s => !s)}
          title={soundOn ? "Mute ambient sound" : "Enable ambient sound"}
          aria-label={soundOn ? "Mute ambient sound" : "Enable ambient sound"}
          className="absolute top-4 z-30 font-mono text-sm px-3 py-1.5 rounded-lg transition-colors
                     border bg-black/60 backdrop-blur"
          style={{
            right: "220px",
            borderColor: soundOn ? "rgba(80,140,255,0.5)" : "rgba(80,80,80,0.4)",
            color: soundOn ? "#7eb8ff" : "#555",
          }}
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
      )}

      {/* Zoom-out button */}
      {isZoomed && !hideUI && (
        <button
          onClick={handleZoomOut}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 font-mono text-xs
                     text-blue-300 hover:text-white px-5 py-2 rounded-lg transition-colors
                     border border-blue-700/50 hover:border-blue-500 bg-black/70 backdrop-blur"
        >
          ← Back to galaxy
        </button>
      )}

      {/* LOD notice */}
      {lodNotice && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 font-mono text-xs
                        text-yellow-700 bg-black/60 backdrop-blur px-4 py-1.5 rounded-lg
                        border border-yellow-900/40 pointer-events-none">
          {lodNotice}
        </div>
      )}

      {/* Targeting-reticle tooltip */}
      {tooltip && !hideUI && (
        <div className="fixed z-20 pointer-events-none select-none"
             style={{ left: tooltip.x + 18, top: tooltip.y - 24 }}>
          <div className="relative">
            <div className="absolute -left-3 -top-3 w-3 h-3 border-l border-t border-blue-500/70" />
            <div className="absolute -right-3 -top-3 w-3 h-3 border-r border-t border-blue-500/70" />
            <div className="absolute -left-3 -bottom-3 w-3 h-3 border-l border-b border-blue-500/70" />
            <div className="absolute -right-3 -bottom-3 w-3 h-3 border-r border-b border-blue-500/70" />
            <div className="rounded px-3 py-2 font-mono text-xs backdrop-blur-sm"
                 style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(40,100,220,0.45)",
                          boxShadow: "0 0 14px rgba(30,80,200,0.30)" }}>
              <div className="text-white font-semibold">{tooltip.name}</div>
              <div className="text-blue-400 mt-0.5">~{tooltip.lines} lines · {tooltip.deg} inbound</div>
            </div>
          </div>
        </div>
      )}

      {/* Node detail sidebar */}
      {sidebar && !hideUI && (
        <div className="fixed right-0 top-0 h-full w-72 z-20 font-mono overflow-y-auto"
             style={{ background: "rgba(2,8,20,0.88)", borderLeft: "1px solid rgba(40,80,200,0.35)",
                      boxShadow: "-4px 0 32px rgba(20,60,180,0.18)" }}>
          <div className="p-5">
            <button onClick={() => { setSidebar(null); if (!zoomStateRef.current.zoomedIn) resetFocusRef.current?.() }}
                    className="text-gray-600 hover:text-gray-300 text-xs mb-5 block transition-colors"
                    aria-label="Close sidebar">
              ✕ close
            </button>

            {/* Folder path */}
            <div className="flex items-center gap-2 mb-2">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: sidebar._color || "#4466ff" }} />
              <span className="text-gray-500 text-xs truncate">{sidebar.folder}</span>
            </div>

            {/* Filename + complexity badge */}
            <div className="flex items-start gap-2 mb-1">
              <div className="text-white text-base font-bold break-all leading-snug flex-1">{sidebar.label}</div>
              {(() => { const b = complexityBadge(sidebar.lines); return b ? (
                <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-md mt-0.5"
                      style={{ background: b.bg, color: b.color, border: `1px solid ${b.color}44` }}>
                  {b.label}
                </span>
              ) : null })()}
            </div>

            {/* File path + copy button */}
            <div className="flex items-center gap-2 mb-5">
              <span className="text-gray-600 text-xs break-all flex-1 leading-relaxed">{sidebar.id}</span>
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(sidebar.id); setCopiedPath(true); setTimeout(() => setCopiedPath(false), 1500) } catch {}
                }}
                aria-label="Copy file path"
                title="Copy path"
                className="flex-shrink-0 text-xs transition-colors"
                style={{ color: copiedPath ? "#4ade80" : "#4b5563" }}
              >
                {copiedPath ? "✓" : "⎘"}
              </button>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {[{ label: "Est. lines", value: sidebar.lines }, { label: "Imports", value: sidebar.imports?.length ?? 0 }]
                .map(({ label, value }) => (
                  <div key={label} className="rounded-lg p-3"
                       style={{ background: "rgba(10,25,60,0.6)", border: "1px solid rgba(40,80,200,0.22)" }}>
                    <div className="text-gray-600 text-xs mb-1">{label}</div>
                    <div className="text-blue-300 text-lg font-bold">{value}</div>
                  </div>
              ))}
            </div>

            {/* Mini dependency graph */}
            {((sidebar.imports?.length || 0) + (sidebar.reverseDeps?.length || 0)) > 0 && (
              <div className="mb-5">
                <div className="text-gray-600 text-xs uppercase tracking-widest mb-2">Connections</div>
                <canvas
                  ref={miniGraphRef}
                  width={220}
                  height={120}
                  className="rounded-lg w-full"
                  style={{ background: "rgba(4,12,36,0.8)", border: "1px solid rgba(40,80,200,0.2)" }}
                />
                <div className="flex gap-3 mt-1.5">
                  <span className="flex items-center gap-1 text-xs" style={{ color: "rgba(74,222,128,0.7)" }}>
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: "rgba(74,222,128,0.8)" }} />imports
                  </span>
                  <span className="flex items-center gap-1 text-xs" style={{ color: "rgba(192,132,252,0.7)" }}>
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: "rgba(192,132,252,0.8)" }} />imported by
                  </span>
                </div>
              </div>
            )}

            {/* Imports list */}
            {sidebar.imports?.length > 0 && (
              <div className="mb-5">
                <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Imports ({sidebar.imports.length})</div>
                <ul className="space-y-1.5">{sidebar.imports.map((imp, i) => (
                  <li key={i} className="text-green-400 text-xs break-all leading-relaxed">{imp}</li>
                ))}</ul>
              </div>
            )}

            {/* Reverse deps */}
            {sidebar.reverseDeps?.length > 0 && (
              <div className="mb-5">
                <div className="text-gray-600 text-xs uppercase tracking-widest mb-3">Imported by ({sidebar.reverseDeps.length})</div>
                <ul className="space-y-1.5">{sidebar.reverseDeps.map((src, i) => (
                  <li key={i} className="text-purple-400 text-xs break-all leading-relaxed">{src}</li>
                ))}</ul>
              </div>
            )}

            {/* Similar files */}
            {similarFiles.length > 0 && (
              <div className="mb-5">
                <div className="text-gray-600 text-xs uppercase tracking-widest mb-2.5">Similar files</div>
                <div className="flex flex-wrap gap-2">
                  {similarFiles.map(n => (
                    <button
                      key={n.id}
                      onClick={() => {
                        const mesh = planetByIdRef.current?.[n.id]; if (!mesh) return
                        setSidebar({ ...mesh.userData, reverseDeps: edges.filter(ev => ev.target === n.id).map(ev => ev.source) })
                        focusNodeRef.current?.(n.id)
                      }}
                      className="text-xs px-2 py-1 rounded-md transition-colors truncate max-w-[130px]"
                      style={{ background: "rgba(10,25,60,0.6)", border: "1px solid rgba(40,80,200,0.25)", color: "#93c5fd" }}
                      title={n.id}
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* GitHub link */}
            {owner && repo && (
              <a href={`https://github.com/${owner}/${repo}/blob/HEAD/${sidebar.id}`}
                 target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-2 text-xs text-blue-500 hover:text-blue-400 rounded-lg px-3 py-2 transition-colors"
                 style={{ border: "1px solid rgba(40,80,200,0.4)" }}>
                <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                View on GitHub ↗
              </a>
            )}
          </div>
        </div>
      )}

      {/* Minimap */}
      {!hideUI && showMinimap && (
        <canvas
          ref={minimapRef}
          width={160}
          height={160}
          onClick={e => {
            const mc = minimapRef.current; if (!mc || !cameraRef.current) return
            const rect = mc.getBoundingClientRect()
            const nx = (e.clientX - rect.left) / rect.width   // 0-1
            const ny = (e.clientY - rect.top)  / rect.height   // 0-1
            const worldR = 150
            const wx = (nx - 0.5) * 2 * worldR
            const wz = (ny - 0.5) * 2 * worldR
            sphRef.current.theta = Math.atan2(wx, wz)
            sphRef.current.phi   = 1.1
          }}
          className="absolute top-20 left-4 z-20 cursor-pointer rounded-lg"
          style={{
            border: "1px solid rgba(40,100,255,0.4)",
            boxShadow: "0 0 16px rgba(20,60,200,0.3), inset 0 0 8px rgba(0,0,30,0.5)",
          }}
        />
      )}
    </div>
  )
})

export default GalaxyCanvas
