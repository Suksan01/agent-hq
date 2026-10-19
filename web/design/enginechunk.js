// The showcase's lazily loaded 3D engine: built on its own as a classic script (engine.chunk.js) that spaceengine.js injects the first
// time the Space view is shown. It puts the engine's exports where spaceengine.js looks for them.
import * as engine from '../starsystem.js'

globalThis.__hqEngine = engine
