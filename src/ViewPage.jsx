import { useState, useEffect, useRef, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { Canvas, useThree, useFrame, extend } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import {
  add,
  colorToDirection,
  diffuseColor,
  directionToColor,
  float,
  mix as tslMix,
  mrt,
  normalView,
  output,
  pass,
  sample,
  uniform,
  vec4,
} from 'three/tsl'
import { ssgi } from 'three/examples/jsm/tsl/display/SSGINode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import { Scene } from './App.jsx'

extend(THREE)

function SSGIPostProcessing() {
  const { gl: renderer, scene, camera } = useThree()
  const ppRef = useRef(null)
  const failedRef = useRef(false)

  useEffect(() => {
    if (failedRef.current) return

    // WebGPU required — SSGI, denoise, and PostProcessing are WebGPU-only
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
    if (!hasWebGPU) {
      console.warn('[viewer] WebGPU unavailable — rendering without SSGI.')
      failedRef.current = true
      return
    }

    let disposed = false

    try {
      const scenePass = pass(scene, camera)

      // MRT: output color, diffuse (for GI), and normal encoded as RGB color
      scenePass.setMRT(mrt({
        output,
        diffuseColor,
        normal: directionToColor(normalView),
      }))

      const scenePassColor = scenePass.getTextureNode('output')
      const scenePassDiffuse = scenePass.getTextureNode('diffuseColor')
      const scenePassDepth = scenePass.getTextureNode('depth')
      const scenePassNormal = scenePass.getTextureNode('normal')

      // Decode color-encoded normal back to direction vector using UV-based sampling
      const sceneNormal = sample((uv) => colorToDirection(scenePassNormal.sample(uv)))

      const giPass = ssgi(scenePassColor, scenePassDepth, sceneNormal, camera)
      giPass.sliceCount.value = 1
      giPass.stepCount.value = 4
      giPass.radius.value = 1
      giPass.expFactor.value = 1.5
      giPass.thickness.value = 0.5
      giPass.backfaceLighting.value = 0.5
      giPass.aoIntensity.value = 1.5
      giPass.giIntensity.value = 0
      giPass.useScreenSpaceSampling.value = true
      giPass.useTemporalFiltering = false

      // SSGI packs AO into the alpha channel of its output texture
      const giTexture = giPass.getTextureNode()
      const aoAsRgb = vec4(giTexture.a, giTexture.a, giTexture.a, float(1))

      // Denoise expects RGB — AO is repacked into RGB before denoising
      const denoisePass = denoise(aoAsRgb, scenePassDepth, sceneNormal, camera)
      denoisePass.index.value = 0
      denoisePass.radius.value = 4

      const gi = giPass.rgb
      const ao = denoisePass.r

      // Geometry mask: renderer.setClearAlpha(0) makes empty pixels alpha=0,
      // geometry pixels write alpha=1 via the output MRT attachment
      const hasGeometry = scenePassColor.a

      // Composite: lit scene * AO + diffuse * GI
      const sceneColor = vec4(
        add(scenePassColor.rgb.mul(ao), scenePassDiffuse.rgb.mul(gi)),
        hasGeometry,
      )

      // Blend composited scene over background color for empty pixels
      const bgColor = uniform(new THREE.Color('#e0e0e0'))
      const finalOutput = vec4(
        tslMix(bgColor, sceneColor.rgb, hasGeometry),
        float(1),
      )

      const pp = new THREE.PostProcessing(renderer)
      pp.outputNode = finalOutput.renderOutput()

      if (disposed) { pp.dispose(); return }
      ppRef.current = pp
    } catch (e) {
      console.warn('[viewer] SSGI pipeline setup failed, falling back to default render:', e)
      failedRef.current = true
    }

    return () => {
      disposed = true
      if (ppRef.current) { ppRef.current.dispose(); ppRef.current = null }
    }
  }, [renderer, scene, camera])

  useFrame(() => {
    if (failedRef.current || !ppRef.current) {
      // Fallback: direct render without post-processing
      renderer.render(scene, camera)
      return
    }
    try {
      // Clear alpha=0 so empty pixels are distinguishable from geometry pixels
      renderer.setClearAlpha?.(0)
      ppRef.current.render()
    } catch (e) {
      console.warn('[viewer] SSGI render error, disabling pipeline:', e)
      failedRef.current = true
      if (ppRef.current) { ppRef.current.dispose(); ppRef.current = null }
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
        dpr={[1, 1.5]}
        style={{ width: '100%', height: '100%', background: '#e0e0e0' }}
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer({ canvas: props.canvas })
          renderer.toneMapping = THREE.ACESFilmicToneMapping
          renderer.toneMappingExposure = 0.9
          await renderer.init()
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
