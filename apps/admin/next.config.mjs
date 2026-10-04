/** @type {import('next').NextConfig} */
export default {
  transpilePackages: [
    '@learning-loop/config',
    '@learning-loop/shared',
    '@learning-loop/validation',
    '@learning-loop/content-engine',
  ],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.supabase.co http://127.0.0.1:54321; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};
