const withNextIntl = require('next-intl/plugin')('./src/i18n/request.ts')

if (process.env.NODE_ENV === 'production' && process.env.MC_DISABLE_HSTS === '1') {
  console.warn('[security] MC_DISABLE_HSTS=1 is set in production — HSTS is disabled. Users are vulnerable to SSL stripping attacks.')
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    '/*': ['./.data/**/*'],
  },
  turbopack: {},
  devIndicators: false,
  // Transpile ESM-only packages so they resolve correctly in all environments
  transpilePackages: ['react-markdown', 'remark-gfm'],
  
  // Security headers
  // Content-Security-Policy is set in src/proxy.ts with a per-request nonce.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(process.env.NODE_ENV === 'production' && process.env.MC_DISABLE_HSTS !== '1' || process.env.MC_ENABLE_HSTS === '1' ? [
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
          ] : []),
        ],
      },
    ];
  },
  
};

module.exports = withNextIntl(nextConfig);
