import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
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

export default function SSGIPostProcessing({ mode = 'rendered' }) {
  const { gl: renderer, scene, camera } = useThree()
  const ppRef = useRef(null)
  const failedRef = useRef(false)

  useEffect(() => {
    if (failedRef.current) return

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

      // Geometry mask: setClearAlpha(0) makes empty pixels alpha=0,
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
      console.warn('[renderer] SSGI pipeline setup failed, falling back to default render:', e)
      failedRef.current = true
    }

    return () => {
      disposed = true
      if (ppRef.current) { ppRef.current.dispose(); ppRef.current = null }
    }
  }, [renderer, scene, camera])

  useFrame(() => {
    if (mode !== 'rendered' || failedRef.current || !ppRef.current) {
      renderer.render(scene, camera)
      return
    }
    try {
      // Exclude gizmos (layer 1) from the SSGI MRT pass so they aren't dimmed by AO
      camera.layers.set(0)
      renderer.setClearAlpha?.(0)
      ppRef.current.render()
      // Overlay gizmos on top of the SSGI composite without clearing the framebuffer
      camera.layers.set(1)
      renderer.autoClear = false
      renderer.render(scene, camera)
      renderer.autoClear = true
      camera.layers.enableAll()
    } catch (e) {
      console.warn('[renderer] SSGI render error, disabling pipeline:', e)
      failedRef.current = true
      if (ppRef.current) { ppRef.current.dispose(); ppRef.current = null }
      camera.layers.enableAll()
    }
  }, 1)

  return null
}
