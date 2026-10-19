// Does this browser give out WebGL (2 or 1)? Small and free of three.js, so a page can ask before it loads the 3D scene.

/** True when a WebGL context can be made right now. */
export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}
