import { useState, useEffect, useRef, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { Canvas, useThree, useFrame, extend } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass, mrt, output } from 'three/tsl'
import { normalView, mix as tslMix, color as tslColor } from 'three/tsl'
import { ssgi } from 'three/examples/jsm/tsl/display/SSGINode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import { Scene } from './App.jsx'

extend(THREE)

function SSGIPostProcessing() {
  const { gl: renderer, scene, camera } = useThree()
  const ppRef = useRef(null)
  const readyRef = useRef(false)
  const failedRef = useRef(false)

  useEffect(() => {
    if (failedRef.current) return
    let disposed = false

    async function init() {
      try {
        await renderer.init()
        if (disposed) return

        // Scene pass with MRT for color, normal, depth
        const scenePass = pass(scene, camera)
        scenePass.setMRT(mrt({
          output: output,
          normal: normalView,
        }))

        const scenePassColor = scenePass.getTextureNode('output')
        const scenePassNormal = scenePass.getTextureNode('normal')
        const scenePassDepth = scenePass.getTextureNode('depth')

        // SSGI with Pascal Editor parameters
        const ssgiEffect = ssgi(scenePassColor, scenePassDepth, scenePassNormal, camera)
        ssgiEffect.sliceCount.value = 1
        ssgiEffect.stepCount.value = 4
        ssgiEffect.radius.value = 1
        ssgiEffect.expFactor.value = 1.5
        ssgiEffect.thickness.value = 0.5
        ssgiEffect.backfaceLighting.value = 0.5
        ssgiEffect.aoIntensity.value = 1.5
        ssgiEffect.giIntensity.value = 0
        ssgiEffect.useScreenSpaceSampling.value = true
        ssgiEffect.useTemporalFiltering = false

        // Denoise the raw SSGI
        const denoised = denoise(ssgiEffect, scenePassDepth, scenePassNormal, camera)

        // Composite: AO modulates scene color, blend with white bg via geometry alpha mask
        const bgColor = tslColor(0xffffff)
        const aoApplied = scenePassColor.mul(denoised)
        const composited = tslMix(bgColor, aoApplied, scenePassColor.a)

        // THREE.PostProcessing manages the full-screen quad + render output
        const pp = new THREE.PostProcessing(renderer)
        pp.outputNode = composited.renderOutput()

        if (disposed) { pp.dispose(); return }
        ppRef.current = pp
        readyRef.current = true
      } catch (e) {
        console.warn('SSGI pipeline failed, falling back to default rendering:', e)
        failedRef.current = true
      }
    }

    init()

    return () => {
      disposed = true
      readyRef.current = false
      if (ppRef.current) { ppRef.current.dispose(); ppRef.current = null }
    }
  }, [renderer, scene, camera])

  useFrame(() => {
    if (!readyRef.current || !ppRef.current) return
    try {
      ppRef.current.render()
    } catch (e) {
      console.warn('SSGI render error, disabling pipeline:', e)
      failedRef.current = true
      if (ppRef.current) { ppRef.current.dispose(); ppRef.current = null }
      readyRef.current = false
    }
  }, 1)

  return null
}

export default function ViewPage() {
  const { id } = useParams()
  const [placedFurniture, setPlacedFurniture] = useState(null)
  const [envIntensity, setEnvIntensity] = useState(0.09)
  const [pointLightIntensity, setPointLightIntensity] = useState(1.0)
  const [error, setError] = useState(null)
  const [navMode, setNavMode] = useState('orbit')
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  useEffect(() => {
    fetch(`/api/scene/${id}`)
      .then(res => {
        if (!res.ok) throw new Error('not found')
        return res.json()
      })
      .then(data => {
        const raw = data.scene
        if (Array.isArray(raw)) {
          setPlacedFurniture(raw)
        } else {
          setPlacedFurniture(raw.furniture ?? [])
          if (raw.lighting) {
            if (raw.lighting.envIntensity != null) setEnvIntensity(raw.lighting.envIntensity)
            if (raw.lighting.pointLightIntensity != null) setPointLightIntensity(raw.lighting.pointLightIntensity)
          }
        }
      })
      .catch(() => setError(true))
  }, [id])

  const centerStyle = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '12px',
    background: '#1a1a1a',
    color: '#888',
    fontFamily: 'Arial, sans-serif',
  }

  if (error) return (
    <div style={centerStyle}>
      <div style={{ fontSize: '48px', color: '#444' }}>404</div>
      <div>Scene not found or link has expired</div>
    </div>
  )

  if (!placedFurniture) return (
    <div style={centerStyle}>
      <div>Loading scene...</div>
    </div>
  )

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Canvas
        shadows
        camera={{ position: [5, 5, 5], fov: 50 }}
        style={{ width: '100%', height: '100%' }}
        gl={(props) => {
          const renderer = new THREE.WebGPURenderer({ canvas: props.canvas })
          renderer.toneMapping = THREE.ACESFilmicToneMapping
          renderer.toneMappingExposure = 0.9
          return renderer
        }}
      >
        <Suspense fallback={null}>
          <Scene
            placedFurniture={placedFurniture}
            selectedId={null}
            setSelectedId={() => {}}
            isDragging={false}
            setIsDragging={() => {}}
            onMeshListUpdate={() => {}}
            onUpdatePosition={() => {}}
            isEmbed={true}
            navMode={navMode}
            onPointerLockChange={setIsPointerLocked}
            envIntensity={envIntensity}
            pointLightIntensity={pointLightIntensity}
          />
        </Suspense>
        <SSGIPostProcessing />
      </Canvas>

      {/* Nav toggle button */}
      <button
        onClick={() => {
          setNavMode(prev => prev === 'orbit' ? 'fps' : 'orbit')
          setIsPointerLocked(false)
        }}
        style={{
          position: 'absolute',
          bottom: '20px',
          right: '20px',
          padding: '8px 14px',
          background: 'rgba(30, 30, 30, 0.85)',
          border: '1px solid #444',
          borderRadius: '6px',
          color: 'white',
          cursor: 'pointer',
          fontSize: '13px',
          fontFamily: 'Arial, sans-serif',
          zIndex: 100,
          userSelect: 'none',
        }}
      >
        {navMode === 'orbit' ? '🚶 Walk' : '🔄 Orbit'}
      </button>

      {/* FPS click-to-lock prompt */}
      {navMode === 'fps' && !isPointerLocked && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 200,
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '20px 30px',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '14px',
          fontFamily: 'Arial, sans-serif',
          lineHeight: '1.6',
          pointerEvents: 'none',
        }}>
          Click to look around · WASD to move · ESC to exit
        </div>
      )}
    </div>
  )
}
