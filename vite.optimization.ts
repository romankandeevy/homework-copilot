export const reactCompatAliases = [
  { find: /^react-dom\/test-utils$/, replacement: 'preact/test-utils' },
  { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
  { find: /^react-dom$/, replacement: 'preact/compat' },
  { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
  { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-runtime' },
  { find: /^react$/, replacement: 'preact/compat' },
]

export function splitInitialChunks(id: string) {
  const iconName = id.match(/\/node_modules\/@phosphor-icons\/react\/dist\/defs\/([^/]+)\.es\.js$/)?.[1]
  if (iconName) return `icons-${iconName.charCodeAt(0) % 4}`
  if (id.includes('/node_modules/@phosphor-icons/')) return 'icons-core'
  if (id.includes('/src/notebook/')) return 'notebook'
  if (id.includes('/src/support/')) return 'support'
}
