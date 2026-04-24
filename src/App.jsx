import { useRef, useState, useMemo, Suspense, useEffect, memo } from 'react'
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber'
import { OrbitControls, PointerLockControls, useGLTF, Environment } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useDrag } from '@use-gesture/react'
import * as THREE from 'three/webgpu'
import { upload } from '@vercel/blob/client'
import { useAuth, useUser, SignIn, UserButton } from '@clerk/clerk-react'
import ProjectDashboard from './components/ProjectDashboard.jsx'
import SSGIPostProcessing from './components/SSGIPostProcessing.jsx'

extend(THREE)

const StableEnvironment = memo(function StableEnvironment({ intensity }) {
  return <Environment preset="studio" background={false} environmentIntensity={intensity} />
})

const DEFAULT_MATERIAL = { color: '#cccccc', roughness: 0.5, metalness: 0, textureUrl: null, textureScale: 1 }

function nullBlobTextureUrls(mat) {
  if (!mat || typeof mat !== 'object') return mat
  const result = { ...mat }
  if (result.textureUrl?.startsWith('blob:')) result.textureUrl = null
  if (result.meshMaterials) {
    const mm = {}
    for (const [k, v] of Object.entries(result.meshMaterials)) {
      mm[k] = nullBlobTextureUrls(v)
    }
    result.meshMaterials = mm
  }
  return result
}

function encodeScene(placedFurniture) {
  const serializable = placedFurniture.map(item => ({
    ...item,
    material: nullBlobTextureUrls(item.material),
  }))
  try {
    return btoa(encodeURIComponent(JSON.stringify(serializable)))
  } catch {
    return null
  }
}

function decodeScene(encoded) {
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)))
  } catch {
    return null
  }
}


function YArrow({ onDrag, orbitRef, baseY, onDragCommit }) {
  const isDragging = useRef(false)
  const lastY = useRef(0)

  const handleDown = (e) => {
    e.stopPropagation()
    e.target.setPointerCapture(e.pointerId)
    isDragging.current = true
    lastY.current = e.clientY
    if (orbitRef?.current) orbitRef.current.enabled = false
    onDragCommit?.()
  }
  const handleMove = (e) => {
    if (!isDragging.current) return
    e.stopPropagation()
    const delta = (lastY.current - e.clientY) * 0.01
    onDrag(delta)
    lastY.current = e.clientY
  }
  const handleUp = (e) => {
    e.target.releasePointerCapture(e.pointerId)
    isDragging.current = false
    if (orbitRef?.current) orbitRef.current.enabled = true
  }

  return (
    <group position={[0, baseY, 0]}>
      {/* Shaft */}
      <mesh position={[0, 1, 0]}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        <cylinderGeometry args={[0.02, 0.02, 2, 8]} />
        <meshStandardMaterial color="#51cf66" depthTest={false} />
      </mesh>
      {/* Arrowhead */}
      <mesh position={[0, 2.15, 0]}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        <coneGeometry args={[0.07, 0.3, 8]} />
        <meshStandardMaterial color="#51cf66" depthTest={false} />
      </mesh>
    </group>
  )
}

function RotationRing({ groupRef, ringRadius, ringY, orbitRef, onRotate, onRotateEnd, onDragCommit, axis = 'y', color = '#ff9500' }) {
  const { camera, gl } = useThree()
  const isDragging = useRef(false)
  const lastAngle = useRef(0)
  const lastClientY = useRef(0)

  const getAngle = (clientX, clientY) => {
    const rect = gl.domElement.getBoundingClientRect()
    const center = new THREE.Vector3()
    groupRef.current.getWorldPosition(center)
    center.project(camera)
    const cx = (center.x + 1) / 2 * rect.width
    const cy = (-center.y + 1) / 2 * rect.height
    return Math.atan2((clientY - rect.top) - cy, (clientX - rect.left) - cx)
  }

  const handleDown = (e) => {
    e.stopPropagation()
    e.target.setPointerCapture(e.pointerId)
    isDragging.current = true
    if (axis === 'y') lastAngle.current = getAngle(e.clientX, e.clientY)
    else lastClientY.current = e.clientY
    if (orbitRef?.current) orbitRef.current.enabled = false
    onDragCommit?.()
  }

  const handleMove = (e) => {
    if (!isDragging.current) return
    e.stopPropagation()
    if (axis === 'y') {
      const angle = getAngle(e.clientX, e.clientY)
      let delta = angle - lastAngle.current
      if (delta > Math.PI) delta -= 2 * Math.PI
      if (delta < -Math.PI) delta += 2 * Math.PI
      onRotate(-delta)
      lastAngle.current = angle
    } else {
      const delta = (e.clientY - lastClientY.current) * 0.01
      onRotate(delta)
      lastClientY.current = e.clientY
    }
  }

  const handleUp = (e) => {
    if (!isDragging.current) return
    isDragging.current = false
    e.target.releasePointerCapture(e.pointerId)
    if (orbitRef?.current) orbitRef.current.enabled = true
    onRotateEnd?.()
  }

  // axis='y' → horizontal ring in XZ plane; axis='x' → vertical ring in YZ plane
  const meshRotation = axis === 'y' ? [-Math.PI / 2, 0, 0] : [0, Math.PI / 2, 0]

  return (
    <group position={[0, ringY, 0]}>
      <mesh rotation={meshRotation}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        <torusGeometry args={[ringRadius, 0.04, 8, 64]} />
        <meshBasicNodeMaterial color={color} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function DraggableMeshBase({ clonedScene, position, scale, rotation, floorPlane, onDragStart, onDragEnd, onSelect, materialSettings, onMeshListUpdate, onPositionChange, onRotationChange, onDragCommit, isEmbed, isSelected, zMoveActive, rMoveActive, orbitRef }) {
  const groupRef = useRef()
  const pos = useRef(position)
  const rot = useRef({ x: rotation?.x ?? 0, y: rotation?.y ?? 0 })
  const offset = useRef([0, 0])

  const [arrowBase, setArrowBase] = useState(0)
  const [ringRadius, setRingRadius] = useState(1)
  const [ringY, setRingY] = useState(0)

  useEffect(() => {
    if (groupRef.current) {
      const box = new THREE.Box3().setFromObject(groupRef.current)
      const bSize = new THREE.Vector3()
      const bCenter = new THREE.Vector3()
      box.getSize(bSize)
      box.getCenter(bCenter)
      setArrowBase(box.min.y - groupRef.current.position.y)
      setRingRadius(Math.max(bSize.x, bSize.z) / 2 + 0.35)
      setRingY(bCenter.y - groupRef.current.position.y)
    }
  }, [clonedScene])

  // Sync rotation from prop (on mount and when updated from drag-end state flush)
  useEffect(() => {
    if (!groupRef.current) return
    const x = rotation?.x ?? 0
    const y = rotation?.y ?? 0
    groupRef.current.rotation.x = x
    groupRef.current.rotation.y = y
    rot.current = { x, y }
  }, [rotation?.x, rotation?.y])

  useEffect(() => {
    if (groupRef.current && scale) {
      groupRef.current.scale.set(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1)
    }
  }, [scale, clonedScene])

  useEffect(() => {
    if (clonedScene && onMeshListUpdate) {
      const meshes = []
      clonedScene.traverse((child) => {
        if (child.isMesh) {
          meshes.push({ name: child.name || `Mesh ${meshes.length + 1}`, uuid: child.uuid })
        }
      })
      onMeshListUpdate(meshes)
    }
  }, [clonedScene, onMeshListUpdate])

  useEffect(() => {
    if (clonedScene && materialSettings) {
      let meshIndex = 0
      clonedScene.traverse((child) => {
        if (child.isMesh) {
          const meshMaterials = materialSettings.meshMaterials || {}
          const settings = meshMaterials[meshIndex] || materialSettings
          let texture = null
          if (settings.textureUrl) {
            const loader = new THREE.TextureLoader()
            texture = loader.load(settings.textureUrl)
            texture.colorSpace = THREE.SRGBColorSpace
            texture.wrapS = THREE.RepeatWrapping
            texture.wrapT = THREE.RepeatWrapping
            texture.repeat.set(settings.textureScale || 1, settings.textureScale || 1)
          }
          if (child.material) {
            if (child.material.map) child.material.map.dispose()
            child.material.dispose()
          }
          child.material = new THREE.MeshStandardNodeMaterial({
            color: texture ? '#ffffff' : (settings.color || '#cccccc'),
            roughness: settings.roughness !== undefined ? settings.roughness : 0.5,
            metalness: settings.metalness !== undefined ? settings.metalness : 0,
            map: texture,
          })
          meshIndex++
        }
      })
    }
  }, [clonedScene, JSON.stringify(materialSettings)]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const group = groupRef.current
    if (!group || !isSelected || !clonedScene) return
    group.updateWorldMatrix(true, true)
    const invGroup = new THREE.Matrix4().copy(group.matrixWorld).invert()
    const geos = []
    clonedScene.traverse(child => {
      if (!child.isMesh || !child.geometry) return
      const geo = child.geometry.clone()
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invGroup, child.matrixWorld))
      geos.push(geo)
    })
    if (!geos.length) return
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
    if (geos.length > 1) geos.forEach(g => g.dispose())
    if (!merged) return

    // Outline: BackSide hull expanded along normals. The furniture mesh writes
    // depth naturally so no separate pre-pass is needed — colorWrite:false on
    // MeshBasicNodeMaterial is not honoured by WebGPU and caused white artifacts.
    const expandedGeo = merged.clone()
    const pos = expandedGeo.getAttribute('position')
    const nor = expandedGeo.getAttribute('normal')
    if (pos && nor) {
      const thickness = 0.0175
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i,
          pos.getX(i) + nor.getX(i) * thickness,
          pos.getY(i) + nor.getY(i) * thickness,
          pos.getZ(i) + nor.getZ(i) * thickness
        )
      }
      pos.needsUpdate = true
    }
    const outlineMat = new THREE.MeshBasicNodeMaterial({
      color: new THREE.Color('#89c4ff'),
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
    })
    const outlineMesh = new THREE.Mesh(expandedGeo, outlineMat)
    outlineMesh.renderOrder = 1
    outlineMesh.castShadow = false
    outlineMesh.receiveShadow = false
    group.add(outlineMesh)

    return () => {
      outlineMat.dispose()
      merged.dispose()
      expandedGeo.dispose()
      group.remove(outlineMesh)
    }
  }, [isSelected, clonedScene])

  const bind = useDrag(({ active, first, last, event }) => {
    if (first) {
      onDragStart()
      onSelect()
      if (event.ray) {
        const intersect = new THREE.Vector3()
        event.ray.intersectPlane(floorPlane, intersect)
        offset.current = [
          groupRef.current.position.x - intersect.x,
          groupRef.current.position.z - intersect.z,
        ]
      }
    }
    if (last) {
      onDragCommit?.()
      onDragEnd()
      if (onPositionChange) onPositionChange([...pos.current])
    }
    if (active && event.ray) {
      const intersect = new THREE.Vector3()
      event.ray.intersectPlane(floorPlane, intersect)
      pos.current = [
        intersect.x + offset.current[0],
        position[1],
        intersect.z + offset.current[1],
      ]
      groupRef.current.position.set(...pos.current)
    }
  }, { pointerEvents: true })

  if (!clonedScene) return null

  return (
    <group ref={groupRef} position={position} {...(isEmbed || ((zMoveActive || rMoveActive) && isSelected) ? {} : bind())}>
      <primitive object={clonedScene} />
      {zMoveActive && isSelected && !isEmbed && (
        <YArrow orbitRef={orbitRef} baseY={arrowBase} onDragCommit={onDragCommit} onDrag={(delta) => {
          const newY = groupRef.current.position.y + delta
          groupRef.current.position.y = newY
          pos.current = [pos.current[0], newY, pos.current[2]]
          if (onPositionChange) onPositionChange([...pos.current])
        }} />
      )}
      {rMoveActive && isSelected && !isEmbed && (
        <>
          <RotationRing
            groupRef={groupRef} ringRadius={ringRadius} ringY={ringY}
            orbitRef={orbitRef} onDragCommit={onDragCommit}
            axis="y" color="#ff9500"
            onRotate={(delta) => {
              rot.current.y += delta
              groupRef.current.rotation.y = rot.current.y
            }}
            onRotateEnd={() => {
              if (onRotationChange) onRotationChange({ x: rot.current.x, y: rot.current.y })
            }}
          />
          <RotationRing
            groupRef={groupRef} ringRadius={ringRadius} ringY={ringY}
            orbitRef={orbitRef} onDragCommit={onDragCommit}
            axis="x" color="#51cf66"
            onRotate={(delta) => {
              rot.current.x += delta
              groupRef.current.rotation.x = rot.current.x
            }}
            onRotateEnd={() => {
              if (onRotationChange) onRotationChange({ x: rot.current.x, y: rot.current.y })
            }}
          />
        </>
      )}
    </group>
  )
}

function DraggableFurniture({ path, ...rest }) {
  const { scene } = useGLTF(path)
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true)
    const box = new THREE.Box3().setFromObject(clone)
    const center = new THREE.Vector3()
    box.getCenter(center)
    clone.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.geometry = child.geometry.clone()
        child.geometry.translate(-center.x, -box.min.y, -center.z)
      }
    })
    return clone
  }, [scene])
  return <DraggableMeshBase clonedScene={clonedScene} {...rest} />
}

function floorSnap(obj3d) {
  const box = new THREE.Box3().setFromObject(obj3d)
  const center = new THREE.Vector3()
  box.getCenter(center)
  obj3d.traverse((child) => {
    if (child.isMesh && child.geometry) {
      child.geometry = child.geometry.clone()
      child.geometry.translate(-center.x, -box.min.y, -center.z)
    }
  })
}

async function loadMesh(sourceUrl, fileFormat) {
  const ext = fileFormat?.toLowerCase()
  let obj3d = null

  if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
    obj3d = await new Promise((resolve, reject) =>
      new OBJLoader().load(sourceUrl, resolve, undefined, reject)
    )
  } else if (ext === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    const geom = await new Promise((resolve, reject) =>
      new STLLoader().load(sourceUrl, resolve, undefined, reject)
    )
    geom.computeVertexNormals()
    const group = new THREE.Group()
    group.add(new THREE.Mesh(geom, new THREE.MeshStandardNodeMaterial()))
    obj3d = group
  } else if (ext === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
    obj3d = await new Promise((resolve, reject) =>
      new FBXLoader().load(sourceUrl, resolve, undefined, reject)
    )
  } else if (ext === 'stp' || ext === 'step') {
    const { default: initOpenCascade } = await import('occt-import-js')
    const occt = await initOpenCascade({
      locateFile: (path) =>
        new URL(`/node_modules/occt-import-js/dist/${path}`, import.meta.url).href,
    })
    const buffer = await fetch(sourceUrl).then((r) => r.arrayBuffer())
    const result = occt.ReadStepFile(new Uint8Array(buffer), null)
    if (!result.success) throw new Error('STEP parse failed')
    const group = new THREE.Group()
    for (const mesh of result.meshes) {
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.attributes.position.array), 3))
      if (mesh.attributes.normal) {
        geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(mesh.attributes.normal.array), 3))
      }
      if (mesh.index) {
        geom.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.index.array), 1))
      } else {
        geom.computeVertexNormals()
      }
      group.add(new THREE.Mesh(geom, new THREE.MeshStandardNodeMaterial({ color: '#cccccc', side: THREE.DoubleSide })))
    }
    obj3d = group
  }

  if (!obj3d) return null
  floorSnap(obj3d)
  return obj3d
}

function DraggableUploadedMesh({ sourceUrl, fileFormat, ...rest }) {
  const [clonedScene, setClonedScene] = useState(null)
  useEffect(() => {
    if (!sourceUrl) return
    loadMesh(sourceUrl, fileFormat)
      .then((obj3d) => { if (obj3d) setClonedScene(obj3d) })
      .catch((err) => console.error('Mesh load error:', err))
  }, [sourceUrl, fileFormat])
  return <DraggableMeshBase clonedScene={clonedScene} {...rest} />
}

function FPSControls({ onLockChange }) {
  const keys = useRef({})
  const controlsRef = useRef()

  useEffect(() => {
    const onKeyDown = (e) => { keys.current[e.code] = true }
    const onKeyUp = (e) => { keys.current[e.code] = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useFrame(({ camera }) => {
    if (!controlsRef.current?.isLocked) return
    const speed = 0.05
    const forward = new THREE.Vector3()
    const right = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const move = new THREE.Vector3()
    if (keys.current['KeyW'] || keys.current['ArrowUp']) move.add(forward)
    if (keys.current['KeyS'] || keys.current['ArrowDown']) move.sub(forward)
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) move.sub(right)
    if (keys.current['KeyD'] || keys.current['ArrowRight']) move.add(right)
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed)
    camera.position.addScaledVector(move, 1)
    camera.position.y = 1.7
  })

  return (
    <PointerLockControls
      ref={controlsRef}
      onLock={() => onLockChange(true)}
      onUnlock={() => onLockChange(false)}
    />
  )
}

export function Scene({ placedFurniture, selectedId, setSelectedId, isDragging, setIsDragging, onMeshListUpdate, onUpdatePosition, onUpdateRotation, isEmbed, navMode, onPointerLockChange, zMoveActive, rMoveActive, onDragCommit, envIntensity, pointLightIntensity }) {
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const isFps = navMode === 'fps'
  const orbitRef = useRef()
  return (
    <>
      <StableEnvironment intensity={envIntensity ?? 0.5} />

      <ambientLight intensity={0.3} color="#ffffff" />

      <directionalLight position={[5, 8, 5]} intensity={1.8} castShadow
        shadow-bias={-0.002}
        shadow-normalBias={0.3}
        shadow-radius={3}
        shadow-mapSize={[1024, 1024]}
      >
        <orthographicCamera attach="shadow-camera" left={-15} right={15} top={15} bottom={-15} near={0.5} far={50} />
      </directionalLight>

      <directionalLight position={[-4, 5, -3]} intensity={0.7} />
      <directionalLight position={[0, 3, -8]} intensity={0.35} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardNodeMaterial color="#ffffff" roughness={0.1} metalness={0.1} side={THREE.DoubleSide} />
      </mesh>

      {placedFurniture.map((item) => {
        const fmt = item.fileFormat?.toLowerCase()
        const isGltf = !fmt || fmt === 'glb' || fmt === 'gltf'
        const sharedProps = {
          position: item.position,
          scale: item.scale ?? { x: 1, y: 1, z: 1 },
          floorPlane,
          onDragStart: () => setIsDragging(true),
          onDragEnd: () => setIsDragging(false),
          onSelect: () => setSelectedId(item.instanceId),
          materialSettings: item.material,
          onMeshListUpdate: (meshes) => onMeshListUpdate(item.instanceId, meshes),
          rotation: item.rotation,
          onPositionChange: (newPos) => onUpdatePosition(item.instanceId, newPos),
          onRotationChange: (newRot) => onUpdateRotation(item.instanceId, newRot),
          onDragCommit,
          isEmbed: isEmbed || isFps,
          isSelected: selectedId === item.instanceId,
          zMoveActive,
          rMoveActive,
          orbitRef,
        }
        return (
          <Suspense key={item.instanceId} fallback={null}>
            {isGltf
              ? <DraggableFurniture path={item.file || item.sourceUrl} {...sharedProps} />
              : <DraggableUploadedMesh sourceUrl={item.sourceUrl} fileFormat={fmt} {...sharedProps} />
            }
          </Suspense>
        )
      })}

      {isFps
        ? <FPSControls onLockChange={onPointerLockChange} />
        : <OrbitControls makeDefault enabled={!isDragging} ref={orbitRef} />
      }

    </>
  )
}

export function ViewportMode({ mode, placedFurniture }) {
  const { scene } = useThree()
  const cleanupRef = useRef([])

  useEffect(() => {
    cleanupRef.current.forEach(fn => fn())
    cleanupRef.current = []

    if (mode !== 'mesh') return

    scene.traverse(obj => {
      if (!obj.isMesh) return
      const origMaterial = obj.material
      const clayMat = new THREE.MeshStandardNodeMaterial({ color: 0x999999, roughness: 0.85, metalness: 0 })
      obj.material = clayMat
      cleanupRef.current.push(() => {
        obj.material = origMaterial
        clayMat.dispose()
      })
    })
  }, [mode, scene, placedFurniture?.length])

  return null
}

function Sidebar({ furnitureCatalog, onAddFurniture, onDeleteSelected, selectedId, placedFurniture, onUpdateMaterial, meshLists, envIntensity, setEnvIntensity, pointLightIntensity, setPointLightIntensity }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedPart, setSelectedPart] = useState('all')
  const [showEmbed, setShowEmbed] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [embedWidth, setEmbedWidth] = useState(800)
  const [embedHeight, setEmbedHeight] = useState(600)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setBaseUrl(window.location.origin + window.location.pathname)
  }, [])

  const getIframeCode = () => {
    const encoded = encodeScene(placedFurniture)
    if (!encoded) return '// Scene could not be encoded'
    const src = `${baseUrl.replace(/\/$/, '')}?embed=1#scene=${encoded}`
    return `<iframe\n  src="${src}"\n  width="${embedWidth}"\n  height="${embedHeight}"\n  frameborder="0"\n  allow="fullscreen"\n></iframe>`
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(getIframeCode()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const [sharing, setSharing] = useState(false)
  const [shareMsg, setShareMsg] = useState(null)

  const handleShareLink = async () => {
    setSharing(true)
    setShareMsg(null)
    try {
      const furniture = placedFurniture.map(item => {
        const mat = nullBlobTextureUrls(item.material)
        return { ...item, material: mat }
      })
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: JSON.stringify({ furniture, lighting: { envIntensity, pointLightIntensity } }) }),
      })
      if (!res.ok) throw new Error('Server error')
      const { id } = await res.json()
      const url = `https://room-demo-nu.vercel.app/view/${id}`
      await navigator.clipboard.writeText(url)
      setShareMsg('Link copied!')
    } catch {
      setShareMsg('Failed — try again')
    } finally {
      setSharing(false)
      setTimeout(() => setShareMsg(null), 3000)
    }
  }
  
  const selectedItem = placedFurniture.find(item => item.instanceId === selectedId)
  const meshList = selectedId ? meshLists[selectedId] || [] : []
  
  // Reset selected part when switching objects
  useEffect(() => {
    setSelectedPart('all')
  }, [selectedId])
  
  // Get current material settings for the selected part
  const getCurrentSettings = () => {
    if (!selectedItem?.material) return DEFAULT_MATERIAL
    
    if (selectedPart === 'all') {
      return selectedItem.material
    } else {
      const meshMaterials = selectedItem.material.meshMaterials || {}
      return meshMaterials[selectedPart] || selectedItem.material
    }
  }
  
  const currentSettings = getCurrentSettings()
  
  // Update material for specific part or all
  const handleMaterialUpdate = (newProps) => {
    if (selectedPart === 'all') {
      onUpdateMaterial(selectedId, {
        ...selectedItem.material,
        ...newProps,
        selectedPart: 'all'
      })
    } else {
      const meshMaterials = { ...(selectedItem.material.meshMaterials || {}) }
      // Fallback to global material but strip structural keys so per-mesh entries stay flat
      const { meshMaterials: _mm, selectedPart: _sp, ...flatGlobal } = selectedItem.material
      meshMaterials[selectedPart] = {
        ...(meshMaterials[selectedPart] || flatGlobal),
        ...newProps
      }
      onUpdateMaterial(selectedId, {
        ...selectedItem.material,
        meshMaterials,
        selectedPart
      })
    }
  }
  
  return (
    <div style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width: '240px',
      height: '100vh',
      background: '#1a1a1a',
      padding: '20px',
      boxSizing: 'border-box',
      color: 'white',
      fontFamily: 'Arial, sans-serif',
      overflowY: 'auto',
      zIndex: 100,
    }}>
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '12px',
          background: '#333',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '4px',
        }}
      >
        <span style={{ fontWeight: 'bold' }}>📦 Furniture</span>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </div>
      
      {isExpanded && (
        <div style={{
          background: '#252525',
          borderRadius: '6px',
          padding: '4px',
          marginBottom: '20px',
        }}>
          {furnitureCatalog.length === 0 ? (
            <div style={{ padding: '12px', color: '#666', fontSize: '13px' }}>
              No furniture found.
            </div>
          ) : (
            furnitureCatalog.map((item) => (
              <div
                key={item.id}
                onClick={() => onAddFurniture(item)}
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#333'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {item.name}
              </div>
            ))
          )}
        </div>
      )}
      
      {placedFurniture.length > 0 && (
        <>
          <div style={{ 
            fontSize: '12px', 
            color: '#888', 
            marginBottom: '8px',
            marginTop: '20px' 
          }}>
            IN SCENE ({placedFurniture.length})
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {placedFurniture.map((item, index) => (
              <div
                key={item.instanceId}
                style={{
                  padding: '10px 12px',
                  background: selectedId === item.instanceId ? '#2a4a6a' : '#252525',
                  borderRadius: '4px',
                  fontSize: '13px',
                }}
              >
                {item.name} #{index + 1}
              </div>
            ))}
          </div>
          
          {selectedId && (
            <button
              onClick={onDeleteSelected}
              style={{
                marginTop: '16px',
                padding: '10px',
                background: '#8B0000',
                border: 'none',
                borderRadius: '6px',
                color: 'white',
                cursor: 'pointer',
                width: '100%',
                fontSize: '13px',
              }}
            >
              🗑️ Delete Selected
            </button>
          )}
        </>
      )}
      
      {/* Lighting */}
      <div style={{ marginTop: '24px', borderTop: '1px solid #333', paddingTop: '16px' }}>
        <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>LIGHTING</div>
        <label style={{ fontSize: '12px', color: '#888' }}>
          Intensity: {envIntensity.toFixed(2)}
        </label>
        <input
          type="range"
          min="0"
          max="3"
          step="0.01"
          value={envIntensity}
          onChange={(e) => setEnvIntensity(parseFloat(e.target.value))}
          style={{ width: '100%', marginTop: '4px' }}
        />
      </div>

      {/* Embed / iframe generator */}
      <div style={{ marginTop: '24px', borderTop: '1px solid #333', paddingTop: '20px' }}>
        <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>EMBED</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => setShowEmbed(!showEmbed)}
            style={{
              flex: 1,
              padding: '10px',
              background: '#1a3a5c',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            {showEmbed ? 'Hide iframe' : 'iframe code'}
          </button>
          <button
            onClick={handleShareLink}
            disabled={sharing}
            style={{
              flex: 1,
              padding: '10px',
              background: shareMsg === 'Link copied!' ? '#1a5c2a' : shareMsg ? '#5c1a1a' : '#1a3a5c',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: sharing ? 'default' : 'pointer',
              fontSize: '13px',
              opacity: sharing ? 0.7 : 1,
            }}
          >
            {shareMsg ?? (sharing ? 'Sharing…' : 'Share link')}
          </button>
        </div>

        {showEmbed && (
          <div style={{ marginTop: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                marginTop: '4px',
                background: '#333',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#888' }}>Width</label>
                <input
                  type="number"
                  value={embedWidth}
                  onChange={(e) => setEmbedWidth(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '6px',
                    marginTop: '4px',
                    background: '#333',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#888' }}>Height</label>
                <input
                  type="number"
                  value={embedHeight}
                  onChange={(e) => setEmbedHeight(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '6px',
                    marginTop: '4px',
                    background: '#333',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <textarea
              readOnly
              value={getIframeCode()}
              rows={6}
              style={{
                width: '100%',
                marginTop: '8px',
                padding: '8px',
                background: '#111',
                color: '#7ec8e3',
                border: '1px solid #333',
                borderRadius: '4px',
                fontSize: '11px',
                fontFamily: 'monospace',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />

            <button
              onClick={handleCopy}
              style={{
                marginTop: '6px',
                padding: '8px',
                background: copied ? '#1a5c2a' : '#333',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: 'pointer',
                width: '100%',
                fontSize: '12px',
              }}
            >
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
          </div>
        )}
      </div>

      {/* Material Editor */}
      {selectedItem && (
        <>
          <div style={{ 
            fontSize: '12px', 
            color: '#888', 
            marginBottom: '8px',
            marginTop: '30px' 
          }}>
            🎨 MATERIAL
          </div>
          
          {/* Part selector */}
          {meshList.length > 1 && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>Select Part</label>
              <select
                value={selectedPart}
                onChange={(e) => setSelectedPart(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginTop: '4px',
                  background: '#333',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                }}
              >
                <option value="all">All Parts</option>
                {meshList.map((mesh, index) => (
                  <option key={mesh.uuid} value={index.toString()}>
                    {mesh.name || `Part ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          {/* Color picker */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>Color</label>
            <input
              type="color"
              value={currentSettings.color || '#cccccc'}
              onChange={(e) => handleMaterialUpdate({ color: e.target.value })}
              style={{
                width: '100%',
                height: '30px',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                marginTop: '4px',
              }}
            />
          </div>
          
          {/* Roughness slider */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>
              Roughness: {(currentSettings.roughness || 0.5).toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentSettings.roughness || 0.5}
              onChange={(e) => handleMaterialUpdate({ roughness: parseFloat(e.target.value) })}
              style={{
                width: '100%',
                marginTop: '4px',
              }}
            />
          </div>
          
          {/* Metalness slider */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>
              Metalness: {(currentSettings.metalness || 0).toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentSettings.metalness || 0}
              onChange={(e) => handleMaterialUpdate({ metalness: parseFloat(e.target.value) })}
              style={{
                width: '100%',
                marginTop: '4px',
              }}
            />
          </div>
          
          {/* Texture upload */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>Texture</label>
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files[0]
                if (!file) return
                // Optimistically show a local preview while uploading
                const localUrl = URL.createObjectURL(file)
                handleMaterialUpdate({ textureUrl: localUrl })
                const uploadOpts = {
                  method: 'POST',
                  headers: {
                    'content-type': file.type || 'application/octet-stream',
                    'x-filename': file.name,
                  },
                  body: file,
                }
                try {
                  let res = await fetch('/api/upload-texture', uploadOpts)
                  if (!res.ok) {
                    // Retry once after 1 second (handles cold-start 500s)
                    await new Promise(r => setTimeout(r, 1000))
                    res = await fetch('/api/upload-texture', uploadOpts)
                  }
                  if (res.ok) {
                    const { url } = await res.json()
                    handleMaterialUpdate({ textureUrl: url })
                  }
                } catch {
                  // local blob url stays as fallback; won't survive share links
                }
              }}
              style={{
                width: '100%',
                marginTop: '4px',
                fontSize: '12px',
              }}
            />
            
            {currentSettings.textureUrl && (
              <>
                <button
                  onClick={() => handleMaterialUpdate({ textureUrl: null })}
                  style={{
                    marginTop: '8px',
                    padding: '6px 10px',
                    background: '#444',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '11px',
                    width: '100%',
                  }}
                >
                  Remove Texture
                </button>
                
                <label style={{ fontSize: '12px', color: '#888', marginTop: '12px', display: 'block' }}>
                  Texture Scale: {(currentSettings.textureScale || 1).toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={currentSettings.textureScale || 1}
                  onChange={(e) => handleMaterialUpdate({ textureScale: parseFloat(e.target.value) })}
                  style={{
                    width: '100%',
                    marginTop: '4px',
                  }}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function App() {
  const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1'
  const { isLoaded, isSignedIn, userId } = useAuth()
  const { user } = useUser()

  const [furnitureCatalog, setFurnitureCatalog] = useState([])
  const [placedFurniture, setPlacedFurniture] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [spawnOffset, setSpawnOffset] = useState(0)
  const [meshLists, setMeshLists] = useState({})
  const [navMode, setNavMode] = useState('orbit')
  const [isPointerLocked, setIsPointerLocked] = useState(false)
  const [showNPanel, setShowNPanel] = useState(false)
  const [zMoveActive, setZMoveActive] = useState(false)
  const [rMoveActive, setRMoveActive] = useState(false)
  const [envIntensity, setEnvIntensity] = useState(0.09)
  const [pointLightIntensity, setPointLightIntensity] = useState(1.0)
  const [renderMode, setRenderMode] = useState('rendered')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [scaleLocked, setScaleLocked] = useState(true)
  const [scaleInputs, setScaleInputs] = useState({ x: '1', y: '1', z: '1' })
  const [appScreen, setAppScreen] = useState('dashboard')
  const [currentProjectId, setCurrentProjectId] = useState(null)
  const [currentProjectName, setCurrentProjectName] = useState(null)
  const [saveToast, setSaveToast] = useState(null)
  const uploadInputRef = useRef()
  const history = useRef([])
  const canvasPointerDown = useRef(null)

  const saveHistory = (current) => {
    history.current = [...history.current.slice(-19), current]
  }

  useEffect(() => {
    if (isEmbed) return
    const onKeyDown = (e) => {
      if (e.key === 'n' || e.key === 'N') setShowNPanel(prev => !prev)
      if (!e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { setZMoveActive(prev => !prev); setRMoveActive(false) }
      if (!e.ctrlKey && (e.key === 'r' || e.key === 'R') && navMode !== 'fps') { setRMoveActive(prev => !prev); setZMoveActive(false) }
      if (e.ctrlKey && e.key === 'z') {
        if (history.current.length > 0) {
          setPlacedFurniture(history.current[history.current.length - 1])
          history.current = history.current.slice(0, -1)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isEmbed])

  // Restore scene from URL hash when loaded as an embed
  useEffect(() => {
    const match = window.location.hash.match(/#scene=(.+)/)
    if (match) {
      const decoded = decodeScene(match[1])
      if (decoded) setPlacedFurniture(decoded)
    }
  }, [])

  useEffect(() => {
    fetch('/furniture/manifest.json')
      .then(res => res.json())
      .then(data => {
        const catalog = data.map(item => ({
          ...item,
          file: `/furniture/${item.file}`
        }))
        setFurnitureCatalog(catalog)
      })
      .catch(err => {
        console.log('Could not load furniture manifest:', err)
        setFurnitureCatalog([])
      })
  }, [])
  
  const addFurniture = (catalogItem) => {
    const newItem = {
      ...catalogItem,
      instanceId: `${catalogItem.id}-${Date.now()}`,
      position: [spawnOffset * 0.5, 0, spawnOffset * 0.5],
      rotation: { x: 0, y: 0 },
      scale: { x: 1, y: 1, z: 1 },
      material: { ...DEFAULT_MATERIAL, meshMaterials: {} },
    }
    saveHistory(placedFurniture)
    setPlacedFurniture([...placedFurniture, newItem])
    setSpawnOffset((spawnOffset + 1) % 10)
  }

  const deleteSelected = () => {
    saveHistory(placedFurniture)
    setPlacedFurniture(placedFurniture.filter(item => item.instanceId !== selectedId))
    setSelectedId(null)
  }

  const updateMaterial = (instanceId, newMaterial) => {
    saveHistory(placedFurniture)
    setPlacedFurniture(placedFurniture.map(item =>
      item.instanceId === instanceId
        ? { ...item, material: newMaterial }
        : item
    ))
  }

  const handleMeshListUpdate = (instanceId, meshes) => {
    setMeshLists(prev => ({
      ...prev,
      [instanceId]: meshes
    }))
  }

  // Sync scale inputs when selection changes
  useEffect(() => {
    const item = placedFurniture.find(i => i.instanceId === selectedId)
    if (item) {
      const s = item.scale ?? { x: 1, y: 1, z: 1 }
      setScaleInputs({ x: String(s.x), y: String(s.y), z: String(s.z) })
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleScaleChange = (axis, rawVal) => {
    const newNum = parseFloat(rawVal)
    if (scaleLocked) {
      setScaleInputs({ x: rawVal, y: rawVal, z: rawVal })
      if (isFinite(newNum) && newNum > 0) {
        updateScale(selectedId, { x: newNum, y: newNum, z: newNum })
      }
    } else {
      setScaleInputs(prev => ({ ...prev, [axis]: rawVal }))
      if (isFinite(newNum) && newNum > 0) {
        const current = placedFurniture.find(i => i.instanceId === selectedId)?.scale ?? { x: 1, y: 1, z: 1 }
        updateScale(selectedId, { ...current, [axis]: newNum })
      }
    }
  }

  const commitHistory = () => {
    history.current = [...history.current.slice(-9), JSON.parse(JSON.stringify(placedFurniture))]
  }

  const updatePosition = (instanceId, newPosition) => {
    setPlacedFurniture(prev => prev.map(item =>
      item.instanceId === instanceId ? { ...item, position: newPosition, material: item.material } : item
    ))
  }

  const updateRotation = (instanceId, newRotation) => {
    setPlacedFurniture(prev => prev.map(item =>
      item.instanceId === instanceId ? { ...item, rotation: newRotation, material: item.material } : item
    ))
  }

  const updateScale = (instanceId, newScale) => {
    setPlacedFurniture(prev => prev.map(item =>
      item.instanceId === instanceId ? { ...item, scale: newScale } : item
    ))
  }

  const handleMeshUpload = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase()
    const supported = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'stp', 'step']
    if (!supported.includes(ext)) {
      setUploadError(`Unsupported format: .${ext}`)
      setTimeout(() => setUploadError(null), 5000)
      return
    }
    const capturedOffset = spawnOffset
    setSpawnOffset(prev => (prev + 1) % 10)
    setIsUploading(true)
    setUploadError(null)
    try {
      // Pre-flight: check quota before handing off to Vercel Blob client
      const tokenCheck = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname: file.name, callbackUrl: '', multipart: false, clientPayload: JSON.stringify({ userId: userId || '', fileSize: file.size }) } }),
      })
      if (tokenCheck.status === 403) {
        const data = await tokenCheck.json()
        if (data.error === 'storage_limit_exceeded') {
          throw new Error('storage_limit_exceeded')
        }
      }

      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        clientPayload: JSON.stringify({ userId: userId || '', fileSize: file.size }),
      })
      const url = blob.url

      // Record blob + update storage quota
      fetch('/api/upload-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, blobUrl: url, filename: file.name, fileSize: file.size }),
      }).catch(() => {})

      const isGltf = ext === 'glb' || ext === 'gltf'
      const newItem = {
        id: `upload-${Date.now()}`,
        name: file.name,
        file: isGltf ? url : null,
        sourceUrl: url,
        fileFormat: ext,
        instanceId: `upload-${Date.now()}`,
        position: [capturedOffset * 0.5, 0, capturedOffset * 0.5],
        rotation: { x: 0, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        material: { ...DEFAULT_MATERIAL, meshMaterials: {} },
      }
      saveHistory(placedFurniture)
      setPlacedFurniture(prev => [...prev, newItem])
    } catch (err) {
      if (err.message?.includes('storage_limit_exceeded')) {
        setUploadError('Storage limit reached (100MB on free plan). Upgrade your plan to upload more.')
      } else {
        setUploadError(err.message || 'Upload failed')
      }
      setTimeout(() => setUploadError(null), 7000)
    } finally {
      setIsUploading(false)
    }
  }

  const handleNewProject = () => {
    setPlacedFurniture([])
    setSelectedId(null)
    setCurrentProjectId(null)
    setCurrentProjectName(null)
    setEnvIntensity(0.09)
    setPointLightIntensity(1.0)
    history.current = []
    setAppScreen('editor')
  }

  const handleOpenProject = (projectId, projectName, sceneJson) => {
    const { furniture, lighting } = sceneJson
    setPlacedFurniture(furniture ?? [])
    setSelectedId(null)
    if (lighting) {
      if (lighting.envIntensity != null) setEnvIntensity(lighting.envIntensity)
      if (lighting.pointLightIntensity != null) setPointLightIntensity(lighting.pointLightIntensity)
    }
    history.current = []
    setCurrentProjectId(projectId)
    setCurrentProjectName(projectName)
    setAppScreen('editor')
  }

  const handleSaveProject = async () => {
    let name = currentProjectName
    if (!name) {
      name = window.prompt('Project name:')
      if (!name?.trim()) return
      name = name.trim()
    }
    const sceneJson = {
      furniture: placedFurniture.map(item => ({ ...item, material: nullBlobTextureUrls(item.material) })),
      lighting: { envIntensity, pointLightIntensity },
    }
    try {
      const res = await fetch('/api/project/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, projectId: currentProjectId, name, sceneJson }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCurrentProjectId(data.projectId)
      setCurrentProjectName(name)
      setSaveToast('Project saved')
      setTimeout(() => setSaveToast(null), 3000)
    } catch (err) {
      setSaveToast(`Save failed: ${err.message}`)
      setTimeout(() => setSaveToast(null), 4000)
    }
  }

  // Auto-create user record on first sign-in
  useEffect(() => {
    if (!isSignedIn || !userId) return
    const email = user?.primaryEmailAddress?.emailAddress
    fetch('/api/ensure-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, email }),
    }).catch(() => {})
  }, [isSignedIn, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isEmbed && !isLoaded) return null
  if (!isEmbed && !isSignedIn) return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#111',
    }}>
      <SignIn />
    </div>
  )

  if (!isEmbed && appScreen === 'dashboard') return (
    <ProjectDashboard
      userId={userId}
      onNewProject={handleNewProject}
      onOpenProject={handleOpenProject}
    />
  )

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* Hidden file input for mesh upload */}
      <input
        type="file"
        accept=".glb,.gltf,.obj,.stl,.fbx,.stp,.step"
        style={{ display: 'none' }}
        ref={uploadInputRef}
        onChange={(e) => { const f = e.target.files[0]; if (f) handleMeshUpload(f); e.target.value = '' }}
      />
      {!isEmbed && (
        <Sidebar
          furnitureCatalog={furnitureCatalog}
          onAddFurniture={addFurniture}
          onDeleteSelected={deleteSelected}
          selectedId={selectedId}
          placedFurniture={placedFurniture}
          onUpdateMaterial={updateMaterial}
          meshLists={meshLists}
          envIntensity={envIntensity}
          setEnvIntensity={setEnvIntensity}
          pointLightIntensity={pointLightIntensity}
          setPointLightIntensity={setPointLightIntensity}
        />
      )}

      {!isEmbed && (
        <>
          {/* N panel */}
          {showNPanel && (
            <div style={{
              position: 'absolute',
              right: 0,
              top: 0,
              width: '200px',
              height: '100vh',
              background: '#1a1a1a',
              padding: '20px',
              boxSizing: 'border-box',
              color: 'white',
              fontFamily: 'Arial, sans-serif',
              overflowY: 'auto',
              zIndex: 100,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <button
                  onClick={() => setAppScreen('dashboard')}
                  style={{
                    background: 'none', border: 'none', color: '#888',
                    cursor: 'pointer', fontSize: '13px', padding: '4px 0',
                  }}
                >
                  ← Projects
                </button>
                <UserButton />
              </div>

              <button
                onClick={handleSaveProject}
                style={{
                  width: '100%', padding: '10px',
                  background: '#1a5c2a', border: 'none', borderRadius: '6px',
                  color: 'white', cursor: 'pointer', fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                {currentProjectName ? `💾 Save "${currentProjectName}"` : '💾 Save Project'}
              </button>

              <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>NAVIGATION</div>
              <button
                onClick={() => {
                  setNavMode(navMode === 'orbit' ? 'fps' : 'orbit')
                  setIsPointerLocked(false)
                }}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#333',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left',
                }}
              >
                {navMode === 'orbit' ? '🚶 Walk' : '🔄 Orbit'}
              </button>

              <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px', marginTop: '24px' }}>TRANSFORM</div>
              <button
                onClick={() => { setZMoveActive(prev => !prev); setRMoveActive(false) }}
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '4px',
                  background: zMoveActive ? '#1a5c2a' : '#333',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left',
                }}
              >
                ↕ Y Movement <span style={{ color: '#888', fontSize: '11px' }}>Z</span>
              </button>
              <button
                onClick={() => { setRMoveActive(prev => !prev); setZMoveActive(false) }}
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '4px',
                  background: rMoveActive ? '#5c3a1a' : '#333',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left',
                }}
              >
                ↻ Rotate <span style={{ color: '#888', fontSize: '11px' }}>R</span>
              </button>

              <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px', marginTop: '24px' }}>IMPORT</div>
              <button
                onClick={() => uploadInputRef.current?.click()}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#333',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left',
                }}
              >
                ↑ Upload Mesh
              </button>

              {selectedId && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '24px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#888' }}>SCALE</span>
                    <button
                      onClick={() => setScaleLocked(prev => !prev)}
                      title={scaleLocked ? 'Unlock axes' : 'Lock axes'}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: scaleLocked ? '#4a9eff' : '#888',
                        cursor: 'pointer',
                        fontSize: '14px',
                        padding: '0 2px',
                        lineHeight: 1,
                      }}
                    >
                      {scaleLocked ? '🔗' : '⛓'}
                    </button>
                  </div>
                  {['x', 'y', 'z'].map(axis => (
                    <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#888', width: '10px' }}>{axis.toUpperCase()}</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.001"
                        value={scaleInputs[axis]}
                        onChange={(e) => handleScaleChange(axis, e.target.value)}
                        style={{
                          flex: 1,
                          background: '#333',
                          border: 'none',
                          borderRadius: '4px',
                          color: 'white',
                          padding: '6px 8px',
                          fontSize: '12px',
                        }}
                      />
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* N tab */}
          <div
            onClick={() => setShowNPanel(prev => !prev)}
            style={{
              position: 'absolute',
              right: showNPanel ? '200px' : '0',
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 101,
              background: '#333',
              color: 'white',
              padding: '8px 4px',
              borderRadius: '4px 0 0 4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: 'Arial, sans-serif',
              writingMode: 'vertical-rl',
              userSelect: 'none',
            }}
          >
            N
          </div>
        </>
      )}

      {!isEmbed && navMode === 'fps' && !isPointerLocked && (
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
          lineHeight: '1.6',
          pointerEvents: 'none',
        }}>
          Click to look around · WASD to move · ESC to exit
        </div>
      )}

      {/* Viewport with drag-and-drop */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: isEmbed ? 0 : 240,
          right: 0,
          bottom: 0,
        }}
        onDragOver={(e) => { e.preventDefault(); if (!isEmbed) setIsDragOver(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false) }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          if (!isEmbed) { const f = e.dataTransfer.files[0]; if (f) handleMeshUpload(f) }
        }}
      >
        {isDragOver && !isEmbed && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 90,
            border: '3px dashed #4a9eff',
            background: 'rgba(74, 158, 255, 0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              color: '#4a9eff', fontSize: '18px', fontFamily: 'Arial, sans-serif',
              background: 'rgba(0,0,0,0.65)', padding: '14px 24px', borderRadius: '8px',
            }}>
              Drop mesh to upload
            </div>
          </div>
        )}

        {isUploading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 250,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              color: 'white', fontSize: '15px', fontFamily: 'Arial, sans-serif',
              background: 'rgba(0,0,0,0.75)', padding: '14px 24px', borderRadius: '8px',
            }}>
              Uploading...
            </div>
          </div>
        )}

        {uploadError && (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            zIndex: 250, background: '#c0392b', color: 'white',
            padding: '10px 20px', borderRadius: '6px',
            fontFamily: 'Arial, sans-serif', fontSize: '13px', whiteSpace: 'nowrap',
          }}>
            {uploadError}
          </div>
        )}

        {saveToast && (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            zIndex: 250,
            background: saveToast.startsWith('Save failed') ? '#c0392b' : '#1a5c2a',
            color: 'white', padding: '10px 20px', borderRadius: '6px',
            fontFamily: 'Arial, sans-serif', fontSize: '13px', whiteSpace: 'nowrap',
          }}>
            {saveToast}
          </div>
        )}

        {/* Viewport shading mode buttons (top-right, Blender-style) */}
        <div style={{
          position: 'absolute', top: '12px', right: '12px', zIndex: 100,
          display: 'flex', gap: '2px',
          background: 'rgba(28,28,28,0.8)', padding: '3px', borderRadius: '6px',
          backdropFilter: 'blur(8px)',
        }}>
          {[
            { id: 'mesh', title: 'Mesh', icon: (
              <svg viewBox="0 0 20 20" width="15" height="15">
                <path d="M10 2 L17 6 L17 14 L10 18 L3 14 L3 6 Z" fill="currentColor"/>
              </svg>
            )},
            { id: 'solid', title: 'Solid', icon: (
              <svg viewBox="0 0 20 20" width="15" height="15"><circle cx="10" cy="10" r="7.5" fill="currentColor"/></svg>
            )},
            { id: 'rendered', title: 'Rendered', icon: (
              <svg viewBox="0 0 20 20" width="15" height="15">
                <circle cx="10" cy="10" r="7.5" fill="currentColor"/>
                <circle cx="7.5" cy="7.5" r="2.5" fill="white" opacity="0.45"/>
              </svg>
            )},
          ].map(({ id, title, icon }) => (
            <button key={id} title={title} onClick={() => setRenderMode(id)} style={{
              width: '28px', height: '28px', padding: 0, cursor: 'pointer',
              border: renderMode === id ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
              borderRadius: '4px',
              background: renderMode === id ? 'rgba(100,100,100,0.9)' : 'transparent',
              color: renderMode === id ? 'white' : 'rgba(160,160,160,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{icon}</button>
          ))}
        </div>

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
          onPointerDown={e => { canvasPointerDown.current = { x: e.clientX, y: e.clientY } }}
          onPointerMissed={e => {
            const down = canvasPointerDown.current
            if (!down) return
            const dx = e.clientX - down.x
            const dy = e.clientY - down.y
            if (Math.sqrt(dx * dx + dy * dy) < 5) setSelectedId(null)
          }}
        >
          <SSGIPostProcessing mode={renderMode} />
          <ViewportMode mode={renderMode} placedFurniture={placedFurniture} />
          <Suspense fallback={null}>
            <Scene
              placedFurniture={placedFurniture}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              onMeshListUpdate={handleMeshListUpdate}
              onUpdatePosition={updatePosition}
              onUpdateRotation={updateRotation}
              isEmbed={isEmbed}
              navMode={navMode}
              onPointerLockChange={setIsPointerLocked}
              zMoveActive={zMoveActive}
              rMoveActive={rMoveActive}
              onDragCommit={commitHistory}
              envIntensity={envIntensity}
              pointLightIntensity={pointLightIntensity}
            />
          </Suspense>
        </Canvas>
      </div>
    </div>
  )
}

export default App