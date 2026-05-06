// ── SELECTION OUTLINE ──
// To disable: delete this file and remove <SelectionOutlinePass> from App.jsx
// ──────────────────────

import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { Fn, uv, vec2, vec3, vec4, abs, max, texture, uniform } from 'three/tsl'

const OUTLINE_COLOR = new THREE.Color(1.0, 0.55, 0.0) // orange

export default function SelectionOutlinePass({ selectedScene }) {
  const { gl: renderer, camera, size } = useThree()
  const s = useRef({ ready: false })

  // One-time pipeline setup
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return

    try {
      const maskScene = new THREE.Scene()
      maskScene.background = new THREE.Color(0x000000)

      const maskCamera = camera.clone()

      const maskTarget = new THREE.RenderTarget(size.width, size.height)

      const whiteMat = new THREE.MeshBasicNodeMaterial({ color: '#ffffff' })

      // Resolution uniform so edge detect stays correct after resize
      const resUniform = uniform(new THREE.Vector2(size.width, size.height))

      // Sobel edge detection material — renders additively on top of existing frame
      const maskTexNode = texture(maskTarget.texture)
      const edgeMat = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      edgeMat.colorNode = Fn(() => {
        const px = vec2(1.0).div(resUniform)
        const uvv = uv()
        const s = (ox, oy) => maskTexNode.uv(uvv.add(px.mul(vec2(ox, oy)))).r
        const gx = s(-1,-1).mul(-1).add(s(1,-1))
          .add(s(-1, 0).mul(-2)).add(s(1, 0).mul(2))
          .add(s(-1, 1).mul(-1)).add(s(1, 1))
        const gy = s(-1,-1).mul(-1).add(s(-1, 1))
          .add(s( 0,-1).mul(-2)).add(s(0,  1).mul(2))
          .add(s( 1,-1).mul(-1)).add(s(1,  1))
        const edge = max(abs(gx), abs(gy)).clamp(0, 1)
        const col = vec3(OUTLINE_COLOR.r, OUTLINE_COLOR.g, OUTLINE_COLOR.b)
        return vec4(col.mul(edge), edge)
      })()

      const quadMesh = new THREE.QuadMesh(edgeMat)

      Object.assign(s.current, {
        ready: true, maskScene, maskCamera, maskTarget,
        whiteMat, resUniform, quadMesh, maskMeshes: [],
      })
    } catch (e) {
      console.warn('[SelectionOutline] Setup failed:', e)
    }

    return () => {
      const { maskTarget, whiteMat, quadMesh } = s.current
      maskTarget?.dispose()
      whiteMat?.dispose()
      quadMesh?.material?.dispose()
      s.current.ready = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Resize
  useEffect(() => {
    if (s.current.maskTarget) s.current.maskTarget.setSize(size.width, size.height)
    if (s.current.resUniform) s.current.resUniform.value.set(size.width, size.height)
  }, [size])

  // Rebuild mask meshes when selected scene changes
  useEffect(() => {
    const { maskScene, whiteMat } = s.current
    if (!maskScene) return

    s.current.maskMeshes.forEach(m => maskScene.remove(m))
    s.current.maskMeshes = []

    if (!selectedScene) return

    const meshes = []
    selectedScene.traverse(child => {
      if (!child.isMesh || child.userData.isOutline) return
      const m = new THREE.Mesh(child.geometry, whiteMat)
      m.matrixAutoUpdate = false
      m.userData.source = child
      maskScene.add(m)
      meshes.push(m)
    })
    s.current.maskMeshes = meshes
  }, [selectedScene])

  useFrame(() => {
    const { ready, maskScene, maskCamera, maskTarget, quadMesh, maskMeshes } = s.current
    if (!ready || !selectedScene || !maskMeshes.length) return

    // Sync camera and world matrices from live scene
    maskCamera.copy(camera)
    maskMeshes.forEach(m => {
      const src = m.userData.source
      if (src) {
        src.updateWorldMatrix(true, false)
        m.matrixWorld.copy(src.matrixWorld)
      }
    })

    // 1. Render white silhouette to mask target
    renderer.setRenderTarget(maskTarget)
    renderer.render(maskScene, maskCamera)

    // 2. Composite edge overlay on top of existing frame
    renderer.setRenderTarget(null)
    quadMesh.render(renderer)
  }, 2)

  return null
}
