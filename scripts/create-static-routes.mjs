import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve('dist')

for (const route of ['privacy', 'terms']) {
  const routeDirectory = resolve(outputDirectory, route)
  await mkdir(routeDirectory, { recursive: true })
  await copyFile(resolve(outputDirectory, 'index.html'), resolve(routeDirectory, 'index.html'))
}
