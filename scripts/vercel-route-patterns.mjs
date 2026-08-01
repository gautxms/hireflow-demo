export function vercelSourceMatchesPath(source, pathname) {
  return new RegExp(`^${source}$`).test(pathname)
}

export function getNoindexHeaderSources(config) {
  return (config.headers || [])
    .filter(({ headers }) => headers?.some(({ key, value }) => key.toLowerCase() === 'x-robots-tag' && value.toLowerCase() === 'noindex, follow'))
    .map(({ source }) => source)
}

export function hasNoindexHeader(config, pathname) {
  return getNoindexHeaderSources(config).some((source) => vercelSourceMatchesPath(source, pathname))
}
