import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve('dist')

for (const route of ['main', 'solutions', 'solutions/geometry/2', 'cdz', 'base', 'tasks', 'textbooks', 'schedule', 'privacy', 'terms']) {
  const routeDirectory = resolve(outputDirectory, route)
  await mkdir(routeDirectory, { recursive: true })
  await copyFile(resolve(outputDirectory, 'index.html'), resolve(routeDirectory, 'index.html'))
}

await copyFile(resolve(outputDirectory, 'index.html'), resolve(outputDirectory, '404.html'))
