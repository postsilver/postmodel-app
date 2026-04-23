import { useState, useEffect, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { Canvas, extend } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { Scene } from './App.jsx'
import SSGIPostProcessing from './components/SSGIPostProcessing.jsx'

extend(THREE)

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
        shadows={{ type: THREE.PCFSoftShadowMap }}
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
