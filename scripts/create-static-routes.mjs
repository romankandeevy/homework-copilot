import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve('dist')
const numberedSolutionRoutes = {
  geometry: 1431,
  physics: 180,
  chemistry: 180,
}
const routes = ['main', 'solutions', 'cdz', 'base', 'tasks', 'textbooks', 'schedule', 'support', 'privacy', 'terms', 'admin']

for (const [textbookId, taskCount] of Object.entries(numberedSolutionRoutes)) {
  for (let task = 1; task <= taskCount; task += 1) routes.push(`solutions/${textbookId}/${task}`)
}

for (const route of routes) {
  const routeDirectory = resolve(outputDirectory, route)
  await mkdir(routeDirectory, { recursive: true })
  await copyFile(resolve(outputDirectory, 'index.html'), resolve(routeDirectory, 'index.html'))
}

await copyFile(resolve(outputDirectory, 'index.html'), resolve(outputDirectory, '404.html'))
