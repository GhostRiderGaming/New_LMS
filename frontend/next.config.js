/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '*.cloudflare.com' },
      { protocol: 'https', hostname: 'fal.media' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: '127.0.0.1' },
      { protocol: 'https', hostname: '*.amazonaws.com' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: '*.wikipedia.org' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Give pixi-live2d-display a stable chunk name so it doesn't break on hot reload
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...config.optimization.splitChunks?.cacheGroups,
          live2d: {
            test: /[\\/]node_modules[\\/](pixi-live2d-display|pixi\.js)[\\/]/,
            name: 'live2d-vendor',
            chunks: 'all',
            priority: 20,
          },
        },
      }
    }
    return config
  },
}

module.exports = nextConfig
